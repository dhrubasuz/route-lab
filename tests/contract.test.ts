/** Independent model-contract checks. Author: Dhruba Poudel. */
import { describe, expect, it } from 'vitest';
import {
  SCENARIOS,
  createTopology,
  defaultRequest,
  repairTopology,
  trace,
  validateTopology,
} from '../src/engine/index';
import type { Topology, TraceRequest } from '../src/engine/types';

function freezeDeep<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

function outcome(model: Topology) {
  const result = trace(model, defaultRequest());
  return {
    delivered: result.delivered,
    status: result.status,
    faultCode: result.faultCode,
    forwardPath: result.forwardPath,
    returnPath: result.returnPath,
    hopCount: result.hopCount,
    modelledLatencyMs: result.modelledLatencyMs,
  };
}

describe('portable and isolated model contract', () => {
  it('creates independent nested data for separate visitors', () => {
    const first = createTopology('healthy');
    const second = createTopology('healthy');
    expect(first).toEqual(second);
    first.nodes[0].interfaces[0].cidr = '192.0.2.10/24';
    first.links[0].enabled = false;
    expect(second).toEqual(createTopology('healthy'));
  });

  it.each(SCENARIOS)('$id survives JSON export/import without changing its trace', ({ id }) => {
    const model = createTopology(id);
    const imported = validateTopology(JSON.parse(JSON.stringify(model)));
    expect(imported.valid, imported.errors.join('; ')).toBe(true);
    expect(imported.topology).toEqual(model);
    expect(trace(imported.topology!, defaultRequest())).toEqual(trace(model, defaultRequest()));
  });

  it.each(SCENARIOS)('$id can be traced and repaired without modifying frozen inputs', ({ id }) => {
    const model = freezeDeep(createTopology(id));
    const request = freezeDeep(defaultRequest());
    const snapshot = JSON.stringify(model);
    expect(() => trace(model, request)).not.toThrow();
    const repaired = repairTopology(model, id);
    expect(JSON.stringify(model)).toBe(snapshot);
    expect(trace(repaired, request).delivered).toBe(true);
  });

  it('validation does not mutate caller data', () => {
    const source = freezeDeep(createTopology('healthy'));
    const original = JSON.stringify(source);
    const validated = validateTopology(source);
    expect(validated.valid).toBe(true);
    expect(JSON.stringify(source)).toBe(original);
  });

  it('stable outcomes do not depend on node, link or route array order', () => {
    const original = createTopology('healthy');
    const reordered = structuredClone(original);
    reordered.nodes.reverse();
    reordered.links.reverse();
    for (const node of reordered.nodes) {
      node.routes.reverse();
      node.firewall.reverse();
    }
    expect(outcome(reordered)).toEqual(outcome(original));
  });

  it('visual positions and presentation names do not change forwarding', () => {
    const original = createTopology('healthy');
    const relabelled = structuredClone(original);
    relabelled.name = 'A different diagram title';
    for (const node of relabelled.nodes) {
      node.name = `Display name: ${node.id}`;
      node.position = { x: 30, y: 40 };
    }
    expect(outcome(relabelled)).toEqual(outcome(original));
  });

  it('an unused endpoint failure does not break an unrelated path', () => {
    const model = createTopology('healthy');
    const operations = model.nodes.find((node) => node.id === 'ops')!;
    operations.status = 'down';
    expect(trace(model, defaultRequest()).delivered).toBe(true);
  });

  it('modelled transit changes by a traversed link in both directions', () => {
    const model = createTopology('healthy');
    const before = trace(model, defaultRequest());
    expect(before.delivered).toBe(true);
    const transit = model.links.find(
      (link) =>
        [link.a.nodeId, link.b.nodeId].includes('edge') &&
        [link.a.nodeId, link.b.nodeId].includes('firewall'),
    )!;
    transit.latencyMs += 7;
    const after = trace(model, defaultRequest());
    expect(after.delivered).toBe(true);
    expect(after.forwardPath).toEqual(before.forwardPath);
    expect(after.returnPath).toEqual(before.returnPath);
    expect(after.modelledLatencyMs - before.modelledLatencyMs).toBe(14);
  });

  it('a targeted repair preserves unrelated changes and cannot mask their failure', () => {
    const model = createTopology('blocked-https');
    model.name = 'My investigation';
    model.nodes.find((node) => node.id === 'api')!.status = 'down';
    const repaired = repairTopology(model, 'blocked-https');
    expect(repaired.name).toBe('My investigation');
    expect(repaired.nodes.find((node) => node.id === 'api')!.status).toBe('down');
    expect(trace(repaired, defaultRequest()).delivered).toBe(false);
  });
});

describe('bounded hostile input contract', () => {
  it.each([null, undefined, 8, 'network', [], true, { schemaVersion: 2 }])(
    'rejects non-topology input %j without throwing',
    (value) => {
      const result = validateTopology(value);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    },
  );

  it('rejects duplicate node identities', () => {
    const model = createTopology('healthy');
    model.nodes.push(structuredClone(model.nodes[0]));
    expect(validateTopology(model).valid).toBe(false);
  });

  it('rejects unresolved physical interface references', () => {
    const model = createTopology('healthy');
    model.links[0].a.interfaceId = 'not-an-interface';
    expect(validateTopology(model).valid).toBe(false);
  });

  it('rejects a link attached to a nonexistent device', () => {
    const model = createTopology('healthy');
    model.links[0].b.nodeId = 'nonexistent-device';
    expect(validateTopology(model).valid).toBe(false);
  });

  it('rejects an oversized node collection before forwarding', () => {
    const model = createTopology('healthy');
    const example = model.nodes[0];
    model.nodes = Array.from({ length: 33 }, (_, index) => ({
      ...structuredClone(example),
      id: `node-${index}`,
    }));
    expect(validateTopology(model).valid).toBe(false);
  });

  it('rejects an oversized route table', () => {
    const model = createTopology('healthy');
    const router = model.nodes.find((node) => node.id === 'edge')!;
    const example = router.routes[0];
    router.routes = Array.from({ length: 129 }, (_, index) => ({
      ...example,
      id: `route-${index}`,
    }));
    expect(validateTopology(model).valid).toBe(false);
  });

  it('rejects an oversized firewall table', () => {
    const model = createTopology('healthy');
    const firewall = model.nodes.find((node) => node.id === 'firewall')!;
    const example = firewall.firewall[0];
    firewall.firewall = Array.from({ length: 129 }, (_, index) => ({
      ...example,
      id: `rule-${index}`,
    }));
    expect(validateTopology(model).valid).toBe(false);
  });

  it.each([-1, NaN, Infinity])('rejects invalid modelled link latency %s', (latencyMs) => {
    const model = createTopology('healthy');
    model.links[0].latencyMs = latencyMs;
    expect(validateTopology(model).valid).toBe(false);
  });

  it('rejects a prototype-sensitive key in imported JSON', () => {
    const value = JSON.parse(
      JSON.stringify(createTopology('healthy')).replace('{', '{"__proto__":{"polluted":true},'),
    );
    expect(validateTopology(value).valid).toBe(false);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it.each([0, -1, 1.5, 65, Infinity, NaN])('rejects invalid initial TTL %s', (ttl) => {
    const request = { ...defaultRequest(), ttl };
    const result = trace(createTopology('healthy'), request);
    expect(result.delivered).toBe(false);
    expect(result.status).toBe('invalid');
  });

  it.each([0, -1, 1.5, 65536, Infinity, NaN])('rejects invalid destination port %s', (port) => {
    const request = { ...defaultRequest(), port };
    const result = trace(createTopology('healthy'), request);
    expect(result.delivered).toBe(false);
    expect(result.status).toBe('invalid');
  });

  it('rejects unsupported protocol names', () => {
    const request = { ...defaultRequest(), protocol: 'ICMP' } as unknown as TraceRequest;
    expect(trace(createTopology('healthy'), request).status).toBe('invalid');
  });
});
