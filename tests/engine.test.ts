import { describe, expect, it } from 'vitest';
import {
  SCENARIOS,
  cidrContains,
  createTopology,
  defaultRequest,
  parseCIDR,
  parseIPv4,
  repairTopology,
  trace,
  validateTopology,
} from '../src/engine';
import type { FirewallRule, Topology, TraceRequest } from '../src/engine/types';

const node = (topology: Topology, id: string) => topology.nodes.find((item) => item.id === id)!;
const policy = (overrides: Partial<FirewallRule> = {}): FirewallRule => ({
  id: 'test-policy',
  label: 'Test policy',
  priority: 10,
  action: 'allow',
  sourceCidr: '0.0.0.0/0',
  destinationCidr: '0.0.0.0/0',
  protocol: 'ANY',
  port: 'any',
  enabled: true,
  ...overrides,
});

describe('Strict unsigned IPv4 and CIDR calculations', () => {
  it('handles both ends of the unsigned 32-bit address space', () => {
    expect(parseIPv4('0.0.0.0')).toBe(0);
    expect(parseIPv4('255.255.255.255')).toBe(4294967295);
    expect(parseIPv4('128.0.0.1')).toBe(2147483649);
  });
  it.each([
    '1.2.3',
    '1.2.3.4.5',
    '256.1.1.1',
    '-1.0.0.0',
    '01.2.3.4',
    '1.2.3.4 ',
    ' 1.2.3.4',
    '1.2.3.4\n',
    '1.2.3.1e2',
    '0x7f.0.0.1',
    '1..2.3',
    '::1',
  ])('rejects ambiguous or invalid IP %s', (value) => {
    expect(parseIPv4(value)).toBeNull();
  });
  it('computes /0, /31 and /32 without signed-mask errors', () => {
    expect(parseCIDR('255.255.255.255/0')).toEqual({
      address: 4294967295,
      network: 0,
      mask: 0,
      prefix: 0,
    });
    expect(parseCIDR('192.0.2.3/31')?.network).toBe(parseIPv4('192.0.2.2'));
    expect(parseCIDR('255.255.255.255/32')).toEqual({
      address: 4294967295,
      network: 4294967295,
      mask: 4294967295,
      prefix: 32,
    });
  });
  it.each([
    '10.1.1.1',
    '10.1.1.1/33',
    '10.1.1.1/-1',
    '10.1.1.1/024',
    '10.1.1.1/24/1',
    '10.1.1.1/24 ',
    '010.1.1.1/24',
    '10.1.1.1/1.5',
  ])('rejects invalid CIDR %s', (value) => {
    expect(parseCIDR(value)).toBeNull();
  });
  it('checks exact subnet boundaries and normalises interface host bits', () => {
    expect(cidrContains('10.20.1.42/24', '10.20.1.0')).toBe(true);
    expect(cidrContains('10.20.1.42/24', '10.20.1.255')).toBe(true);
    expect(cidrContains('10.20.1.42/24', '10.20.2.0')).toBe(false);
    expect(cidrContains('0.0.0.0/0', '255.255.255.255')).toBe(true);
    expect(cidrContains('192.0.2.4/32', '192.0.2.5')).toBe(false);
    expect(cidrContains('bad', '1.1.1.1')).toBe(false);
    expect(cidrContains('1.1.1.1/32', 'bad')).toBe(false);
  });
});

describe('Scenarios use the real forwarding engine', () => {
  const expected = {
    healthy: 'delivered',
    'blocked-https': 'explicit_deny',
    'missing-route': 'no_route',
    'wrong-subnet': 'subnet_mismatch',
    'link-down': 'link_down',
    'route-loop': 'ttl_exceeded',
    'return-route': 'no_route',
    'service-down': 'service_closed',
  };
  for (const scenario of SCENARIOS) {
    it(`${scenario.id}: computes the fault, then delivers after a bounded repair`, () => {
      const topology = createTopology(scenario.id);
      expect(validateTopology(topology).valid).toBe(true);
      const before = structuredClone(topology);
      const result = trace(topology, defaultRequest());
      expect(result.status === 'delivered' ? 'delivered' : result.faultCode).toBe(
        expected[scenario.id],
      );
      expect(topology).toEqual(before);
      const repaired = repairTopology(topology, scenario.id);
      const after = trace(repaired, defaultRequest());
      expect(after.delivered).toBe(true);
      expect(after.forwardPath).toEqual(['client', 'edge', 'firewall', 'core', 'api']);
      expect(after.returnPath).toEqual(['api', 'core', 'firewall', 'edge', 'client']);
      expect(topology).toEqual(before);
    });
  }
  it('creates isolated topology and request values on every call', () => {
    const first = createTopology();
    node(first, 'api').status = 'down';
    expect(node(createTopology(), 'api').status).toBe('up');
    const request = defaultRequest();
    request.port = 80;
    expect(defaultRequest().port).toBe(443);
  });
  it('keeps unrelated edits when repairing a particular scenario', () => {
    const topology = createTopology('blocked-https');
    node(topology, 'database').name = 'Edited data store';
    node(topology, 'ops').status = 'down';
    topology.links[0].latencyMs = 13;
    const repaired = repairTopology(topology, 'blocked-https');
    expect(node(repaired, 'database').name).toBe('Edited data store');
    expect(node(repaired, 'ops').status).toBe('down');
    expect(repaired.links[0].latencyMs).toBe(13);
    expect(node(topology, 'firewall').firewall[0].enabled).toBe(true);
    expect(node(repaired, 'firewall').firewall[0].enabled).toBe(false);
  });
  it('does not claim delivery when only the outbound direction succeeds', () => {
    const result = trace(createTopology('return-route'), defaultRequest());
    expect(result.forwardPath.at(-1)).toBe('api');
    expect(result.returnPath).toEqual(['api', 'core']);
    expect(result.steps.at(-1)).toMatchObject({
      phase: 'response',
      nodeId: 'core',
      kind: 'drop',
      decision: 'fail',
    });
    expect(result.delivered).toBe(false);
  });
  it('retains deterministic decisions, synthetic transit and trace identifiers', () => {
    const topology = createTopology();
    const first = trace(topology, defaultRequest());
    expect(first).toEqual(trace(topology, defaultRequest()));
    expect(first.modelledLatencyMs).toBe(12);
    expect(first.hopCount).toBe(8);
    expect(new Set(first.steps.map((step) => step.id)).size).toBe(first.steps.length);
    expect(first.steps.every((step, index) => step.index === index)).toBe(true);
    expect(first.steps.some((step) => step.ruleId === 'allow-client-api')).toBe(true);
    expect(first.steps.some((step) => step.ruleId === 'allow-api-response')).toBe(true);
    expect(first.steps.some((step) => step.routeId === 'route-edge-private')).toBe(true);
    expect(first.steps.some((step) => step.linkId === 'link-firewall-core')).toBe(true);
  });
});

describe('Routing, adjacency and bounded TTL', () => {
  it('prefers the longest prefix even when it has a higher metric', () => {
    const topology = createTopology();
    node(topology, 'edge').routes.push({
      id: 'specific-host',
      destination: '10.20.1.20/32',
      nextHop: '10.10.2.10',
      metric: 500,
      enabled: true,
    });
    const result = trace(topology, defaultRequest());
    expect(
      result.steps.find((step) => step.nodeId === 'edge' && step.kind === 'route')?.routeId,
    ).toBe('specific-host');
    expect(result.faultCode).toBe('non_forwarding_node');
    expect(result.forwardPath).toEqual(['client', 'edge', 'ops']);
  });
  it('uses a connected route in preference to a less-specific default', () => {
    const topology = createTopology();
    const request = { ...defaultRequest(), sourceId: 'api', destinationId: 'database', port: 5432 };
    const result = trace(topology, request);
    expect(result.delivered).toBe(true);
    expect(result.forwardPath).toEqual(['api', 'core', 'database']);
    expect(
      result.steps.find((step) => step.nodeId === 'core' && step.kind === 'route')?.routeId,
    ).toBe('connected-core-database');
  });
  it('prefers the lower metric among equal-length prefixes', () => {
    const topology = createTopology();
    node(topology, 'edge').routes.push({
      id: 'lower-metric',
      destination: '10.20.0.0/16',
      nextHop: '192.0.2.99',
      metric: 2,
      enabled: true,
    });
    const result = trace(topology, defaultRequest());
    expect(result.faultCode).toBe('next_hop_unreachable');
    expect(
      result.steps.find((step) => step.nodeId === 'edge' && step.kind === 'route')?.routeId,
    ).toBe('lower-metric');
  });
  it('uses stable route ID ordering when prefix and metric tie', () => {
    const topology = createTopology();
    node(topology, 'edge').routes.push(
      {
        id: 'zz-last',
        destination: '10.20.0.0/16',
        nextHop: '192.0.2.88',
        metric: 2,
        enabled: true,
      },
      {
        id: 'aa-first',
        destination: '10.20.0.0/16',
        nextHop: '192.0.2.99',
        metric: 2,
        enabled: true,
      },
    );
    const result = trace(topology, defaultRequest());
    expect(
      result.steps.find((step) => step.nodeId === 'edge' && step.kind === 'route')?.routeId,
    ).toBe('aa-first');
    node(topology, 'edge').routes.reverse();
    expect(trace(topology, defaultRequest())).toEqual(result);
  });
  it('does not invent a graph shortcut when the selected next hop is absent', () => {
    const topology = createTopology();
    node(topology, 'edge').routes[0].nextHop = '172.16.0.6';
    const result = trace(topology, defaultRequest());
    expect(result.faultCode).toBe('next_hop_unreachable');
    expect(result.forwardPath).toEqual(['client', 'edge']);
  });
  it('requires the peer subnet to contain the local address too', () => {
    const topology = createTopology();
    node(topology, 'firewall').interfaces[0].cidr = '172.16.0.2/32';
    expect(trace(topology, defaultRequest()).faultCode).toBe('subnet_mismatch');
  });
  it('expires TTL at a forwarding device, without decrementing at the receiving endpoint', () => {
    expect(trace(createTopology(), { ...defaultRequest(), ttl: 3 })).toMatchObject({
      status: 'ttl_exceeded',
      forwardPath: ['client', 'edge', 'firewall', 'core'],
    });
    expect(trace(createTopology(), { ...defaultRequest(), ttl: 4 }).delivered).toBe(true);
    const result = trace(createTopology(), { ...defaultRequest(), ttl: 1 });
    expect(result.steps.at(-1)).toMatchObject({ nodeId: 'edge', ttl: 0 });
  });
  it('exposes repeated hops and bounds the routing loop by TTL', () => {
    const result = trace(createTopology('route-loop'), { ...defaultRequest(), ttl: 64 });
    expect(result.status).toBe('ttl_exceeded');
    expect(result.forwardPath.filter((id) => id === 'edge').length).toBeGreaterThan(1);
    expect(result.hopCount).toBeLessThanOrEqual(64);
    expect(result.steps.length).toBeLessThan(300);
  });
  it('does not let the original client forward a packet routed back to it', () => {
    const topology = createTopology();
    node(topology, 'edge').routes[0].nextHop = '10.10.1.10';
    const result = trace(topology, defaultRequest());
    expect(result.faultCode).toBe('non_forwarding_node');
    expect(result.forwardPath).toEqual(['client', 'edge', 'client']);
    expect(result.steps.at(-1)?.nodeId).toBe('client');
  });
  it('decrements TTL when a looping packet revisits its original source router', () => {
    const result = trace(createTopology('route-loop'), {
      ...defaultRequest(),
      sourceId: 'edge',
      ttl: 4,
    });
    expect(result.faultCode).toBe('ttl_exceeded');
    expect(result.forwardPath).toEqual(['edge', 'firewall', 'edge', 'firewall', 'edge']);
    expect(result.steps.at(-1)).toMatchObject({ nodeId: 'edge', ttl: 0 });
  });
  it.each(['client', 'core', 'api'])('reports unavailable node %s at its actual position', (id) => {
    const topology = createTopology();
    node(topology, id).status = 'down';
    const result = trace(topology, defaultRequest());
    expect(result.faultCode).toBe('node_down');
    expect(result.steps.at(-1)?.nodeId).toBe(id);
    expect(result.delivered).toBe(false);
  });
});

describe('Explicit stateless firewall policy', () => {
  it('applies first matching priority, rather than globally favouring deny', () => {
    const topology = createTopology('blocked-https');
    node(topology, 'firewall').firewall.push(policy({ id: 'early-allow', priority: 1 }));
    expect(trace(topology, defaultRequest()).delivered).toBe(true);
  });
  it('orders tied priorities by rule ID, independent of array order', () => {
    const topology = createTopology();
    node(topology, 'firewall').firewall = [
      policy({ id: 'zz-allow' }),
      policy({ id: 'aa-deny', action: 'deny' }),
    ];
    const result = trace(topology, defaultRequest());
    expect(result.faultCode).toBe('explicit_deny');
    expect(result.steps.at(-1)?.ruleId).toBe('aa-deny');
    node(topology, 'firewall').firewall.reverse();
    expect(trace(topology, defaultRequest())).toEqual(result);
  });
  it('does not match a disabled deny or a rule for another protocol', () => {
    const topology = createTopology();
    node(topology, 'firewall').firewall.unshift(
      policy({ id: 'disabled-deny', action: 'deny', enabled: false }),
      policy({ id: 'udp-deny', action: 'deny', protocol: 'UDP' }),
    );
    expect(trace(topology, defaultRequest()).delivered).toBe(true);
  });
  it('denies a client-to-database request without a matching allow', () => {
    const result = trace(createTopology(), {
      ...defaultRequest(),
      destinationId: 'database',
      port: 5432,
    });
    expect(result.faultCode).toBe('implicit_deny');
    expect(result.forwardPath.at(-1)).toBe('firewall');
  });
  it('evaluates response policy independently of request policy', () => {
    const topology = createTopology();
    node(topology, 'firewall').firewall.find((item) => item.id === 'allow-api-response')!.enabled =
      false;
    const result = trace(topology, defaultRequest());
    expect(result.forwardPath.at(-1)).toBe('api');
    expect(result.faultCode).toBe('implicit_deny');
    expect(result.steps.at(-1)?.phase).toBe('response');
  });
  it('checks protocol-specific services after network and firewall success', () => {
    const topology = createTopology();
    node(topology, 'firewall').firewall = [policy()];
    expect(trace(topology, { ...defaultRequest(), protocol: 'UDP' }).faultCode).toBe(
      'service_closed',
    );
    node(topology, 'api').services.push({
      protocol: 'UDP',
      port: 443,
      name: 'UDP test service',
      enabled: true,
    });
    expect(trace(topology, { ...defaultRequest(), protocol: 'UDP' }).delivered).toBe(true);
  });
  it('handles the operations client using the actual distinct route and rule', () => {
    const result = trace(createTopology(), { ...defaultRequest(), sourceId: 'ops' });
    expect(result.delivered).toBe(true);
    expect(result.forwardPath[0]).toBe('ops');
    expect(result.returnPath.at(-1)).toBe('ops');
    expect(result.steps.some((step) => step.ruleId === 'allow-ops-api')).toBe(true);
  });
});

describe('Hostile, malformed and bounded inputs', () => {
  it.each([null, [], 'topology', 42, {}])(
    'rejects malformed topology values without throwing',
    (value) => {
      expect(validateTopology(value).valid).toBe(false);
      expect(trace(value as Topology, defaultRequest()).status).toBe('invalid');
    },
  );
  it('rejects prototype pollution keys at any depth', () => {
    const topology = createTopology();
    const malicious = JSON.parse(
      JSON.stringify(topology).replace('"metric":10', '"metric":10,"__proto__":{"polluted":true}'),
    );
    expect(validateTopology(malicious).valid).toBe(false);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
  it('rejects cycles, unsupported fields and non-JSON objects', () => {
    const circular = createTopology() as Topology & { cycle?: unknown };
    circular.cycle = circular;
    expect(validateTopology(circular).valid).toBe(false);
    expect(validateTopology({ ...createTopology(), secret: 'unsupported' }).valid).toBe(false);
    expect(validateTopology(new Date()).valid).toBe(false);
  });
  it('does not coerce hostile JSON objects into string enum or endpoint fields', () => {
    const hostile = () => JSON.parse('{"toString":"not-callable"}');
    const values = [
      () => {
        const model = createTopology();
        (node(model, 'api') as unknown as Record<string, unknown>).kind = hostile();
        return model;
      },
      () => {
        const model = createTopology();
        (node(model, 'api').services[0] as unknown as Record<string, unknown>).protocol = hostile();
        return model;
      },
      () => {
        const model = createTopology();
        (node(model, 'firewall').firewall[0] as unknown as Record<string, unknown>).protocol =
          hostile();
        return model;
      },
      () => {
        const model = createTopology();
        (model.links[0].a as unknown as Record<string, unknown>).nodeId = hostile();
        return model;
      },
    ];
    for (const make of values) expect(validateTopology(make()).valid).toBe(false);
    expect(trace(createTopology(), { ...defaultRequest(), protocol: hostile() }).status).toBe(
      'invalid',
    );
  });
  it('validates duplicate node IDs, IPs, interface IDs and dangling links', () => {
    const topology = createTopology();
    topology.nodes[1].id = topology.nodes[0].id;
    expect(validateTopology(topology).valid).toBe(false);
    const addresses = createTopology();
    node(addresses, 'api').interfaces[0].cidr = node(addresses, 'client').interfaces[0].cidr;
    expect(validateTopology(addresses).valid).toBe(false);
    const interfaces = createTopology();
    node(interfaces, 'edge').interfaces[1].id = node(interfaces, 'edge').interfaces[0].id;
    expect(validateTopology(interfaces).valid).toBe(false);
    const links = createTopology();
    links.links[0].a.interfaceId = 'not-present';
    expect(validateTopology(links).valid).toBe(false);
  });
  it('rejects an interface attached to more than one point-to-point link', () => {
    const topology = createTopology();
    topology.links.push({ ...structuredClone(topology.links[0]), id: 'duplicate-attachment' });
    expect(validateTopology(topology).valid).toBe(false);
  });
  it('rejects a link to the same node, invalid coordinates and malformed port/rules', () => {
    const self = createTopology();
    self.links[0].b = { nodeId: 'client', interfaceId: 'client-lan' };
    expect(validateTopology(self).valid).toBe(false);
    const coordinates = createTopology();
    coordinates.nodes[0].position.x = NaN;
    expect(validateTopology(coordinates).valid).toBe(false);
    const rules = createTopology();
    node(rules, 'firewall').firewall[0].port = 65536;
    expect(validateTopology(rules).valid).toBe(false);
    const cidr = createTopology();
    node(cidr, 'edge').routes[0].destination = '10.20.0.0/33';
    expect(validateTopology(cidr).valid).toBe(false);
  });
  it('bounds total routes, nodes and excessive nested input', () => {
    const topology = createTopology();
    node(topology, 'edge').routes = Array.from({ length: 129 }, (_, index) => ({
      id: `route-${index}`,
      destination: '0.0.0.0/0',
      nextHop: '172.16.0.2',
      metric: index,
      enabled: true,
    }));
    expect(validateTopology(topology).valid).toBe(false);
    expect(
      validateTopology({ ...createTopology(), nodes: Array.from({ length: 33 }, () => ({})) })
        .valid,
    ).toBe(false);
    let nested: unknown = {};
    for (let depth = 0; depth < 14; depth++) nested = { child: nested };
    expect(validateTopology(nested).valid).toBe(false);
  });
  it('clones valid imports instead of retaining references to caller-owned objects', () => {
    const topology = createTopology();
    const result = validateTopology(topology);
    expect(result.valid).toBe(true);
    node(result.topology!, 'client').name = 'Import edited';
    expect(node(topology, 'client').name).toBe('Studio client');
  });
  it.each([
    { ttl: 0 },
    { ttl: 65 },
    { ttl: 1.5 },
    { port: 0 },
    { port: 65536 },
    { port: NaN },
    { protocol: 'ICMP' },
    { sourceId: 'missing' },
    { destinationId: 'client' },
    { extra: true },
  ])('rejects invalid request override %j', (override) => {
    const result = trace(createTopology(), { ...defaultRequest(), ...override } as TraceRequest);
    expect(result.status).toBe('invalid');
    expect(result.steps).toEqual([]);
  });
  it('handles a null request without throwing', () => {
    expect(trace(createTopology(), null as unknown as TraceRequest)).toMatchObject({
      status: 'invalid',
      faultCode: 'invalid_request',
    });
  });
});
