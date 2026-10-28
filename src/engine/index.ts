/** RouteLab's bounded, deterministic IPv4 teaching model. Author: Dhruba Poudel. */
import type {
  FirewallRule,
  Link,
  NetworkNode,
  Phase,
  Protocol,
  Route,
  Scenario,
  ScenarioId,
  Topology,
  TraceRequest,
  TraceResult,
  TraceStep,
  ValidationResult,
} from './types';
export type * from './types';

const LIMITS = { nodes: 32, links: 64, interfaces: 16, routes: 128, rules: 128, services: 32 };
const ID = /^[a-z][a-z0-9-]{0,47}$/;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function parseIPv4(value: string): number | null {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value))
    return null;
  const octets = value.split('.').map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  return (octets[0] * 16777216 + octets[1] * 65536 + octets[2] * 256 + octets[3]) >>> 0;
}

export function parseCIDR(
  value: string,
): { address: number; network: number; prefix: number; mask: number } | null {
  if (typeof value !== 'string') return null;
  const parts = value.split('/');
  if (parts.length !== 2 || !/^(0|[1-9]\d?)$/.test(parts[1])) return null;
  const address = parseIPv4(parts[0]);
  const prefix = Number(parts[1]);
  if (address === null || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { address, network: (address & mask) >>> 0, prefix, mask };
}

function formatIPv4(address: number): string {
  return [address >>> 24, (address >>> 16) & 255, (address >>> 8) & 255, address & 255].join('.');
}

export function cidrContains(cidr: string, address: string): boolean {
  const subnet = parseCIDR(cidr);
  const ip = parseIPv4(address);
  return subnet !== null && ip !== null && (ip & subnet.mask) >>> 0 === subnet.network;
}

/** Structural validation permits deliberate semantic faults such as an off-subnet next hop. */
export function validateTopology(value: unknown): ValidationResult {
  const errors: string[] = [];
  const add = (message: string) => {
    if (errors.length < 30) errors.push(message);
  };
  const visited = new WeakSet<object>();
  let inspected = 0;
  function guard(item: unknown, depth: number): void {
    if (++inspected > 15000 || depth > 12) {
      add('Topology exceeds the supported nesting or size limit.');
      return;
    }
    if (item === null || typeof item !== 'object') return;
    if (visited.has(item)) {
      add('Topology must be a JSON tree without circular or shared object references.');
      return;
    }
    visited.add(item);
    if (!Array.isArray(item) && !isRecord(item)) {
      add('Topology objects must be plain JSON objects.');
      return;
    }
    for (const key of Object.keys(item)) {
      if (forbidden.has(key)) {
        add('Topology contains a forbidden object key.');
        return;
      }
      guard((item as Record<string, unknown>)[key], depth + 1);
      if (errors.length) return;
    }
  }
  guard(value, 0);
  if (errors.length) return { valid: false, errors };
  const keys = (item: Record<string, unknown>, allowed: string[], label: string) => {
    if (Object.keys(item).some((key) => !allowed.includes(key)))
      add(`${label} contains an unsupported field.`);
  };
  const text = (item: unknown, label: string, max = 100) => {
    if (
      typeof item !== 'string' ||
      !item.trim() ||
      item.length > max ||
      /[\u0000-\u001f\u007f]/.test(item)
    )
      add(`${label} must be non-empty text, at most ${max} characters.`);
  };
  const id = (item: unknown, label: string) => {
    if (typeof item !== 'string' || !ID.test(item))
      add(`${label} must use 1–48 lowercase letters, digits or hyphens, starting with a letter.`);
  };
  const list = (item: unknown, label: string, max: number, min = 0): unknown[] => {
    if (!Array.isArray(item) || item.length < min || item.length > max) {
      add(`${label} must contain ${min}–${max} entries.`);
      return [];
    }
    return item;
  };
  if (!isRecord(value)) return { valid: false, errors: ['Topology must be a JSON object.'] };
  keys(value, ['schemaVersion', 'name', 'nodes', 'links'], 'Topology');
  if (value.schemaVersion !== 1) add('Topology schemaVersion must be 1.');
  text(value.name, 'Topology name');
  const nodes = list(value.nodes, 'Nodes', LIMITS.nodes, 2);
  const links = list(value.links, 'Links', LIMITS.links);
  const nodeIds = new Set<string>();
  const nodeInterfaces = new Map<string, Set<string>>();
  const addresses = new Set<number>();
  let routeCount = 0;
  let ruleCount = 0;
  for (const [index, unknownNode] of nodes.entries()) {
    const label = `Node ${index + 1}`;
    if (!isRecord(unknownNode)) {
      add(`${label} must be an object.`);
      continue;
    }
    const node = unknownNode;
    keys(
      node,
      [
        'id',
        'name',
        'kind',
        'zone',
        'status',
        'interfaces',
        'routes',
        'firewall',
        'services',
        'position',
      ],
      label,
    );
    id(node.id, `${label} ID`);
    if (typeof node.id === 'string') {
      if (nodeIds.has(node.id)) add('Node IDs must be unique.');
      nodeIds.add(node.id);
    }
    text(node.name, `${label} name`, 60);
    text(node.zone, `${label} zone`, 60);
    if (
      typeof node.kind !== 'string' ||
      !['client', 'router', 'firewall', 'service'].includes(node.kind)
    )
      add(`${label} has an invalid kind.`);
    if (node.status !== 'up' && node.status !== 'down') add(`${label} status must be up or down.`);
    if (
      !isRecord(node.position) ||
      !integer(node.position.x, 0, 2000) ||
      !integer(node.position.y, 0, 2000)
    )
      add(`${label} needs an integer position inside 0–2000.`);
    else keys(node.position, ['x', 'y'], `${label} position`);
    const interfaces = list(node.interfaces, `${label} interfaces`, LIMITS.interfaces, 1);
    const interfaceIds = new Set<string>();
    for (const item of interfaces) {
      if (!isRecord(item)) {
        add(`${label} interfaces must be objects.`);
        continue;
      }
      keys(item, ['id', 'name', 'cidr'], `${label} interface`);
      id(item.id, 'Interface ID');
      text(item.name, 'Interface name', 60);
      if (typeof item.id === 'string') {
        if (interfaceIds.has(item.id)) add(`${label} interface IDs must be unique.`);
        interfaceIds.add(item.id);
      }
      const cidr = typeof item.cidr === 'string' ? parseCIDR(item.cidr) : null;
      if (!cidr) add(`${label} has an invalid interface IPv4 CIDR.`);
      else {
        if (addresses.has(cidr.address)) add('Interface IPv4 addresses must be unique.');
        addresses.add(cidr.address);
      }
    }
    if (typeof node.id === 'string') nodeInterfaces.set(node.id, interfaceIds);
    const routes = list(node.routes, `${label} routes`, LIMITS.routes);
    const routeIds = new Set<string>();
    routeCount += routes.length;
    for (const item of routes) {
      if (!isRecord(item)) {
        add('Routes must be objects.');
        continue;
      }
      keys(item, ['id', 'destination', 'nextHop', 'metric', 'enabled'], 'Route');
      id(item.id, 'Route ID');
      if (typeof item.id === 'string') {
        if (routeIds.has(item.id)) add(`${label} route IDs must be unique.`);
        routeIds.add(item.id);
      }
      if (typeof item.destination !== 'string' || !parseCIDR(item.destination))
        add('Route destination must be a valid IPv4 CIDR.');
      if (typeof item.nextHop !== 'string' || parseIPv4(item.nextHop) === null)
        add('Route next hop must be a valid IPv4 address.');
      if (!integer(item.metric, 0, 65535)) add('Route metric must be an integer from 0 to 65535.');
      if (typeof item.enabled !== 'boolean') add('Route enabled must be boolean.');
    }
    const rules = list(node.firewall, `${label} firewall rules`, LIMITS.rules);
    ruleCount += rules.length;
    const ruleIds = new Set<string>();
    for (const item of rules) {
      if (!isRecord(item)) {
        add('Firewall rules must be objects.');
        continue;
      }
      keys(
        item,
        [
          'id',
          'label',
          'priority',
          'action',
          'sourceCidr',
          'destinationCidr',
          'protocol',
          'port',
          'enabled',
        ],
        'Firewall rule',
      );
      id(item.id, 'Firewall rule ID');
      text(item.label, 'Firewall rule label', 100);
      if (typeof item.id === 'string') {
        if (ruleIds.has(item.id)) add(`${label} firewall rule IDs must be unique.`);
        ruleIds.add(item.id);
      }
      if (!integer(item.priority, 0, 65535))
        add('Firewall priority must be an integer from 0 to 65535.');
      if (item.action !== 'allow' && item.action !== 'deny')
        add('Firewall action must be allow or deny.');
      for (const field of ['sourceCidr', 'destinationCidr'])
        if (typeof item[field] !== 'string' || !parseCIDR(item[field] as string))
          add(`Firewall ${field} must be a valid IPv4 CIDR.`);
      if (typeof item.protocol !== 'string' || !['TCP', 'UDP', 'ANY'].includes(item.protocol))
        add('Firewall protocol must be TCP, UDP or ANY.');
      if (item.port !== 'any' && !integer(item.port, 1, 65535))
        add('Firewall port must be any or an integer from 1 to 65535.');
      if (typeof item.enabled !== 'boolean') add('Firewall enabled must be boolean.');
    }
    const services = list(node.services, `${label} services`, LIMITS.services);
    const serviceIds = new Set<string>();
    for (const item of services) {
      if (!isRecord(item)) {
        add('Services must be objects.');
        continue;
      }
      keys(item, ['protocol', 'port', 'name', 'enabled'], 'Service');
      if (
        typeof item.protocol !== 'string' ||
        !['TCP', 'UDP'].includes(item.protocol) ||
        !integer(item.port, 1, 65535)
      )
        add('Service protocol/port must be TCP or UDP and 1–65535.');
      text(item.name, 'Service name', 60);
      if (typeof item.enabled !== 'boolean') add('Service enabled must be boolean.');
      if (typeof item.protocol === 'string' && typeof item.port === 'number') {
        const serviceId = `${item.protocol}:${item.port}`;
        if (serviceIds.has(serviceId)) add(`${label} service protocol/port pairs must be unique.`);
        serviceIds.add(serviceId);
      }
    }
  }
  if (routeCount > LIMITS.routes)
    add(`Topology supports at most ${LIMITS.routes} static routes in total.`);
  if (ruleCount > LIMITS.rules)
    add(`Topology supports at most ${LIMITS.rules} firewall rules in total.`);
  const linkIds = new Set<string>();
  const attached = new Set<string>();
  for (const unknownLink of links) {
    if (!isRecord(unknownLink)) {
      add('Links must be objects.');
      continue;
    }
    const link = unknownLink;
    keys(link, ['id', 'a', 'b', 'enabled', 'latencyMs'], 'Link');
    id(link.id, 'Link ID');
    if (typeof link.id === 'string') {
      if (linkIds.has(link.id)) add('Link IDs must be unique.');
      linkIds.add(link.id);
    }
    if (typeof link.enabled !== 'boolean') add('Link enabled must be boolean.');
    if (!integer(link.latencyMs, 0, 1000))
      add('Link modelled latency must be an integer from 0 to 1000 ms.');
    for (const end of ['a', 'b']) {
      const point = link[end];
      if (!isRecord(point)) {
        add('Each link needs two interface endpoints.');
        continue;
      }
      keys(point, ['nodeId', 'interfaceId'], 'Link endpoint');
      if (
        typeof point.nodeId !== 'string' ||
        typeof point.interfaceId !== 'string' ||
        !nodeInterfaces.get(point.nodeId)?.has(point.interfaceId)
      )
        add('Link endpoint must reference an existing node interface.');
      if (typeof point.nodeId === 'string' && typeof point.interfaceId === 'string') {
        const endpoint = `${point.nodeId}/${point.interfaceId}`;
        if (attached.has(endpoint)) add('A point-to-point interface may belong to only one link.');
        attached.add(endpoint);
      }
    }
    if (isRecord(link.a) && isRecord(link.b) && link.a.nodeId === link.b.nodeId)
      add('A link must connect two different nodes.');
  }
  if (errors.length) return { valid: false, errors };
  return { valid: true, errors: [], topology: structuredClone(value) as unknown as Topology };
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'healthy',
    title: 'A clean round trip',
    category: 'Baseline',
    difficulty: 'Foundation',
    summary: 'Follow a complete request and response through the same fictional network.',
    objective: 'Confirm the API is reachable in both directions.',
    hint: 'Inspect the return path as well as the outbound route.',
    repairSummary: 'The baseline configuration already supports this request.',
  },
  {
    id: 'blocked-https',
    title: 'The rule that wins',
    category: 'Firewall',
    difficulty: 'Foundation',
    summary: 'A broad allow exists, yet HTTPS stops at the policy boundary.',
    objective: 'Find which rule actually decides this packet.',
    hint: 'Rules run in ascending priority order. Inspect the deny above the allow.',
    repairSummary:
      'Disable the accidental priority-50 HTTPS deny; keep the narrower intended allow.',
  },
  {
    id: 'missing-route',
    title: 'A route gone missing',
    category: 'Routing',
    difficulty: 'Foundation',
    summary: 'The client reaches its gateway, then the packet has no onward route.',
    objective: 'Restore the edge route to the private service networks.',
    hint: 'Inspect the edge router’s 10.20.0.0/16 route and its enabled flag.',
    repairSummary: 'Re-enable the edge router’s private-network route through 172.16.0.2.',
  },
  {
    id: 'wrong-subnet',
    title: 'Neighbours, on paper',
    category: 'Addressing',
    difficulty: 'Intermediate',
    summary: 'The next hop is physically connected but no longer on the local subnet.',
    objective: 'Correct the edge transit interface’s IPv4 CIDR.',
    hint: 'Compare edge-transit with the firewall’s 172.16.0.2/30 interface.',
    repairSummary: 'Restore edge-transit to 172.16.0.1/30 so both peers are mutually on-link.',
  },
  {
    id: 'link-down',
    title: 'A severed handoff',
    category: 'Connectivity',
    difficulty: 'Foundation',
    summary: 'The routing decision is valid. The selected transit link is not available.',
    objective: 'Find and restore the failed firewall-to-core link.',
    hint: 'The trace identifies the exact selected link, rather than inventing another path.',
    repairSummary: 'Restore the firewall-to-core point-to-point link.',
  },
  {
    id: 'route-loop',
    title: 'Back to the same router',
    category: 'Routing',
    difficulty: 'Advanced',
    summary: 'A mistaken next hop sends the packet back towards the edge until TTL expires.',
    objective: 'Break the loop without increasing the packet’s TTL.',
    hint: 'The firewall’s private-network route should point towards core, not edge.',
    repairSummary: 'Change the firewall’s private-network next hop to 172.16.0.6.',
  },
  {
    id: 'return-route',
    title: 'Half a conversation',
    category: 'Asymmetry',
    difficulty: 'Advanced',
    summary: 'The request arrives at the API. The response cannot get back to the client.',
    objective: 'Diagnose the missing reverse route.',
    hint: 'The failure occurs in the response phase at core. Check 10.10.0.0/16.',
    repairSummary: 'Re-enable core’s client-network route through 172.16.0.5.',
  },
  {
    id: 'service-down',
    title: 'Reachable, not listening',
    category: 'Service',
    difficulty: 'Intermediate',
    summary: 'The network delivers the request, but the destination’s HTTPS service is disabled.',
    objective: 'Separate service availability from network reachability.',
    hint: 'Inspect the API’s TCP/443 listener after following the successful network path.',
    repairSummary: 'Enable the API’s HTTPS service on TCP/443.',
  },
];

const route = (id: string, destination: string, nextHop: string): Route => ({
  id,
  destination,
  nextHop,
  metric: 10,
  enabled: true,
});
const iface = (id: string, name: string, cidr: string) => ({ id, name, cidr });
const rule = (
  id: string,
  label: string,
  priority: number,
  sourceCidr: string,
  destinationCidr: string,
  port: number | 'any',
): FirewallRule => ({
  id,
  label,
  priority,
  action: 'allow',
  sourceCidr,
  destinationCidr,
  protocol: 'TCP',
  port,
  enabled: true,
});

export function defaultRequest(): TraceRequest {
  return { sourceId: 'client', destinationId: 'api', protocol: 'TCP', port: 443, ttl: 8 };
}

export function createTopology(scenarioId: ScenarioId = 'healthy'): Topology {
  if (!SCENARIOS.some((scenario) => scenario.id === scenarioId))
    throw new Error('Unknown RouteLab scenario.');
  const nodes: NetworkNode[] = [
    {
      id: 'client',
      name: 'Studio client',
      kind: 'client',
      zone: 'Access',
      status: 'up',
      interfaces: [iface('client-lan', 'LAN', '10.10.1.10/24')],
      routes: [route('route-client-default', '0.0.0.0/0', '10.10.1.1')],
      firewall: [],
      services: [],
      position: { x: 90, y: 230 },
    },
    {
      id: 'edge',
      name: 'Edge router',
      kind: 'router',
      zone: 'Access',
      status: 'up',
      interfaces: [
        iface('edge-client', 'Client LAN', '10.10.1.1/24'),
        iface('edge-transit', 'Policy transit', '172.16.0.1/30'),
        iface('edge-ops', 'Operations LAN', '10.10.2.1/24'),
      ],
      routes: [route('route-edge-private', '10.20.0.0/16', '172.16.0.2')],
      firewall: [],
      services: [],
      position: { x: 280, y: 230 },
    },
    {
      id: 'firewall',
      name: 'Policy gateway',
      kind: 'firewall',
      zone: 'Policy boundary',
      status: 'up',
      interfaces: [
        iface('firewall-edge', 'Edge transit', '172.16.0.2/30'),
        iface('firewall-core', 'Core transit', '172.16.0.5/30'),
      ],
      routes: [
        route('route-firewall-private', '10.20.0.0/16', '172.16.0.6'),
        route('route-firewall-clients', '10.10.0.0/16', '172.16.0.1'),
      ],
      firewall: [
        rule('allow-client-api', 'Client HTTPS to API', 100, '10.10.1.0/24', '10.20.1.0/24', 443),
        rule('allow-ops-api', 'Operations HTTPS to API', 110, '10.10.2.0/24', '10.20.1.0/24', 443),
        rule(
          'allow-api-response',
          'API response to access networks',
          200,
          '10.20.1.0/24',
          '10.10.0.0/16',
          'any',
        ),
      ],
      services: [],
      position: { x: 470, y: 230 },
    },
    {
      id: 'core',
      name: 'Core router',
      kind: 'router',
      zone: 'Private services',
      status: 'up',
      interfaces: [
        iface('core-firewall', 'Policy transit', '172.16.0.6/30'),
        iface('core-api', 'API LAN', '10.20.1.1/24'),
        iface('core-database', 'Data LAN', '10.20.2.1/24'),
      ],
      routes: [route('route-core-clients', '10.10.0.0/16', '172.16.0.5')],
      firewall: [],
      services: [],
      position: { x: 670, y: 230 },
    },
    {
      id: 'api',
      name: 'Application API',
      kind: 'service',
      zone: 'Private services',
      status: 'up',
      interfaces: [iface('api-lan', 'API LAN', '10.20.1.20/24')],
      routes: [route('route-api-default', '0.0.0.0/0', '10.20.1.1')],
      firewall: [],
      services: [{ protocol: 'TCP', port: 443, name: 'HTTPS API', enabled: true }],
      position: { x: 880, y: 120 },
    },
    {
      id: 'database',
      name: 'Data store',
      kind: 'service',
      zone: 'Private services',
      status: 'up',
      interfaces: [iface('database-lan', 'Data LAN', '10.20.2.20/24')],
      routes: [route('route-database-default', '0.0.0.0/0', '10.20.2.1')],
      firewall: [],
      services: [{ protocol: 'TCP', port: 5432, name: 'Database', enabled: true }],
      position: { x: 880, y: 360 },
    },
    {
      id: 'ops',
      name: 'Operations desk',
      kind: 'client',
      zone: 'Access',
      status: 'up',
      interfaces: [iface('ops-lan', 'Operations LAN', '10.10.2.10/24')],
      routes: [route('route-ops-default', '0.0.0.0/0', '10.10.2.1')],
      firewall: [],
      services: [],
      position: { x: 280, y: 440 },
    },
  ];
  const link = (
    id: string,
    a: string,
    ai: string,
    b: string,
    bi: string,
    latencyMs: number,
  ): Link => ({
    id,
    a: { nodeId: a, interfaceId: ai },
    b: { nodeId: b, interfaceId: bi },
    enabled: true,
    latencyMs,
  });
  const topology: Topology = {
    schemaVersion: 1,
    name: 'Northline / fictional service network',
    nodes,
    links: [
      link('link-client-edge', 'client', 'client-lan', 'edge', 'edge-client', 1),
      link('link-edge-firewall', 'edge', 'edge-transit', 'firewall', 'firewall-edge', 2),
      link('link-firewall-core', 'firewall', 'firewall-core', 'core', 'core-firewall', 2),
      link('link-core-api', 'core', 'core-api', 'api', 'api-lan', 1),
      link('link-core-database', 'core', 'core-database', 'database', 'database-lan', 1),
      link('link-edge-ops', 'edge', 'edge-ops', 'ops', 'ops-lan', 1),
    ],
  };
  const edge = nodes.find((node) => node.id === 'edge')!;
  const firewall = nodes.find((node) => node.id === 'firewall')!;
  if (scenarioId === 'blocked-https')
    firewall.firewall.unshift({
      ...rule(
        'fault-block-https',
        'Accidental HTTPS deny',
        50,
        '10.10.0.0/16',
        '10.20.1.0/24',
        443,
      ),
      action: 'deny',
    });
  if (scenarioId === 'missing-route') edge.routes[0].enabled = false;
  if (scenarioId === 'wrong-subnet')
    edge.interfaces.find((item) => item.id === 'edge-transit')!.cidr = '172.16.1.1/30';
  if (scenarioId === 'link-down')
    topology.links.find((item) => item.id === 'link-firewall-core')!.enabled = false;
  if (scenarioId === 'route-loop')
    firewall.routes.find((item) => item.id === 'route-firewall-private')!.nextHop = '172.16.0.1';
  if (scenarioId === 'return-route')
    nodes.find((node) => node.id === 'core')!.routes[0].enabled = false;
  if (scenarioId === 'service-down')
    nodes.find((node) => node.id === 'api')!.services[0].enabled = false;
  return topology;
}

export function repairTopology(topology: Topology, scenarioId: ScenarioId): Topology {
  const repaired = structuredClone(topology);
  const node = (id: string) => repaired.nodes.find((item) => item.id === id);
  if (scenarioId === 'blocked-https') {
    const item = node('firewall')?.firewall.find((entry) => entry.id === 'fault-block-https');
    if (item) item.enabled = false;
  }
  if (scenarioId === 'missing-route') {
    const item = node('edge')?.routes.find((entry) => entry.id === 'route-edge-private');
    if (item) item.enabled = true;
  }
  if (scenarioId === 'wrong-subnet') {
    const item = node('edge')?.interfaces.find((entry) => entry.id === 'edge-transit');
    if (item) item.cidr = '172.16.0.1/30';
  }
  if (scenarioId === 'link-down') {
    const item = repaired.links.find((entry) => entry.id === 'link-firewall-core');
    if (item) item.enabled = true;
  }
  if (scenarioId === 'route-loop') {
    const item = node('firewall')?.routes.find((entry) => entry.id === 'route-firewall-private');
    if (item) item.nextHop = '172.16.0.6';
  }
  if (scenarioId === 'return-route') {
    const item = node('core')?.routes.find((entry) => entry.id === 'route-core-clients');
    if (item) item.enabled = true;
  }
  if (scenarioId === 'service-down') {
    const item = node('api')?.services.find(
      (entry) => entry.protocol === 'TCP' && entry.port === 443,
    );
    if (item) item.enabled = true;
  }
  return repaired;
}

interface Candidate {
  id: string;
  destination: string;
  nextHop: string;
  metric: number;
  prefix: number;
  interfaceId?: string;
}
function chooseRoute(node: NetworkNode, destination: string): Candidate | undefined {
  const candidates: Candidate[] = [];
  for (const item of node.interfaces) {
    const subnet = parseCIDR(item.cidr)!;
    if (cidrContains(item.cidr, destination))
      candidates.push({
        id: `connected-${item.id}`,
        destination: `${formatIPv4(subnet.network)}/${subnet.prefix}`,
        nextHop: destination,
        metric: 0,
        prefix: subnet.prefix,
        interfaceId: item.id,
      });
  }
  for (const item of node.routes)
    if (item.enabled && cidrContains(item.destination, destination))
      candidates.push({ ...item, prefix: parseCIDR(item.destination)!.prefix });
  return candidates.sort(
    (a, b) => b.prefix - a.prefix || a.metric - b.metric || compareId(a.id, b.id),
  )[0];
}

export function trace(topology: Topology, request: TraceRequest): TraceResult {
  const safeRequest: TraceRequest = isRecord(request)
    ? {
        sourceId: typeof request.sourceId === 'string' ? request.sourceId : '',
        destinationId: typeof request.destinationId === 'string' ? request.destinationId : '',
        protocol: request.protocol === 'UDP' ? 'UDP' : 'TCP',
        port:
          typeof request.port === 'number' && Number.isFinite(request.port) ? request.port : 443,
        ttl: typeof request.ttl === 'number' && Number.isFinite(request.ttl) ? request.ttl : 8,
      }
    : defaultRequest();
  const result: TraceResult = {
    modelVersion: '1.0',
    request: safeRequest,
    delivered: false,
    status: 'invalid',
    reason: '',
    faultCode: '',
    steps: [],
    forwardPath: [],
    returnPath: [],
    modelledLatencyMs: 0,
    hopCount: 0,
  };
  const validation = validateTopology(topology);
  if (!validation.valid) {
    result.reason = validation.errors.join(' ');
    result.faultCode = 'invalid_topology';
    return result;
  }
  if (
    !isRecord(request) ||
    Object.keys(request).some(
      (key) => !['sourceId', 'destinationId', 'protocol', 'port', 'ttl'].includes(key),
    ) ||
    typeof request.sourceId !== 'string' ||
    typeof request.destinationId !== 'string' ||
    (request.protocol !== 'TCP' && request.protocol !== 'UDP') ||
    !integer(request.port, 1, 65535) ||
    !integer(request.ttl, 1, 64)
  ) {
    result.reason =
      'Choose source and destination IDs, TCP or UDP, a port from 1–65535 and an integer TTL from 1–64.';
    result.faultCode = 'invalid_request';
    return result;
  }
  const model = validation.topology!;
  const nodes = new Map(model.nodes.map((node) => [node.id, node]));
  const source = nodes.get(request.sourceId);
  const destination = nodes.get(request.destinationId);
  if (!source || !destination || source.id === destination.id) {
    result.reason = 'Choose two different nodes that exist in this topology.';
    result.faultCode = 'invalid_endpoints';
    return result;
  }
  const sourceIP = source.interfaces[0].cidr.split('/')[0];
  const destinationIP = destination.interfaces[0].cidr.split('/')[0];
  const step = (
    node: NetworkNode,
    phase: Phase,
    kind: TraceStep['kind'],
    title: string,
    detail: string,
    decision: TraceStep['decision'],
    ttl: number,
    extra: Partial<TraceStep> = {},
  ) => {
    const index = result.steps.length;
    result.steps.push({
      id: `${phase}-${index + 1}`,
      index,
      nodeId: node.id,
      nodeName: node.name,
      phase,
      kind,
      title,
      detail,
      decision,
      ttl,
      ...extra,
    });
  };
  const fail = (
    node: NetworkNode,
    phase: Phase,
    ttl: number,
    status: TraceResult['status'],
    faultCode: string,
    title: string,
    detail: string,
    extra: Partial<TraceStep> = {},
  ): false => {
    result.status = status;
    result.reason = detail;
    result.faultCode = faultCode;
    step(node, phase, 'drop', title, detail, 'fail', ttl, extra);
    return false;
  };
  function walk(start: NetworkNode, end: NetworkNode, phase: Phase): boolean {
    let current = start;
    let ttl = request.ttl;
    const packetSource = phase === 'request' ? sourceIP : destinationIP;
    const packetDestination = phase === 'request' ? destinationIP : sourceIP;
    const packetPort = phase === 'request' ? request.port : 49152;
    const path = phase === 'request' ? result.forwardPath : result.returnPath;
    path.push(start.id);
    step(
      start,
      phase,
      'source',
      phase === 'request' ? 'Request created' : 'Response created',
      `${packetSource} → ${packetDestination} · ${request.protocol}/${packetPort} · TTL ${ttl}.`,
      'info',
      ttl,
    );
    // At most TTL router transitions plus finite non-forwarding endpoints; guard remains independent.
    for (let iteration = 0; iteration < 67; iteration++) {
      if (current.status === 'down')
        return fail(
          current,
          phase,
          ttl,
          'unreachable',
          'node_down',
          'Node is unavailable',
          `${current.name} is down. The ${phase} cannot continue.`,
        );
      if (iteration > 0 && current.id !== end.id) {
        if (current.kind !== 'router' && current.kind !== 'firewall')
          return fail(
            current,
            phase,
            ttl,
            'unreachable',
            'non_forwarding_node',
            'Endpoint cannot forward',
            `${current.name} is an endpoint, not an IPv4 forwarding device.`,
          );
        ttl--;
        if (ttl <= 0)
          return fail(
            current,
            phase,
            0,
            'ttl_exceeded',
            'ttl_exceeded',
            'TTL exhausted',
            `TTL expired at ${current.name}. Inspect repeated hops and routing decisions; increasing TTL does not repair a loop.`,
          );
      }
      if (current.kind === 'firewall') {
        const matched = current.firewall
          .filter((item) => item.enabled)
          .sort((a, b) => a.priority - b.priority || compareId(a.id, b.id))
          .find(
            (item) =>
              cidrContains(item.sourceCidr, packetSource) &&
              cidrContains(item.destinationCidr, packetDestination) &&
              (item.protocol === 'ANY' || item.protocol === request.protocol) &&
              (item.port === 'any' || item.port === packetPort),
          );
        if (!matched)
          return fail(
            current,
            phase,
            ttl,
            'blocked',
            'implicit_deny',
            'No matching allow',
            `${current.name} implicitly denies ${request.protocol}/${packetPort}: no enabled rule matches this source and destination.`,
          );
        step(
          current,
          phase,
          'firewall',
          `${matched.action === 'allow' ? 'Allowed' : 'Denied'} by ${matched.label}`,
          `Priority ${matched.priority} · ${matched.sourceCidr} → ${matched.destinationCidr} · ${matched.protocol}/${matched.port}. First matching rule wins.`,
          matched.action === 'allow' ? 'pass' : 'fail',
          ttl,
          { ruleId: matched.id },
        );
        if (matched.action === 'deny')
          return fail(
            current,
            phase,
            ttl,
            'blocked',
            'explicit_deny',
            'Policy stopped this packet',
            `${current.name} denied the ${phase} using “${matched.label}” at priority ${matched.priority}.`,
            { ruleId: matched.id },
          );
      }
      if (current.id === end.id) {
        if (
          phase === 'request' &&
          !current.services.some(
            (service) =>
              service.enabled &&
              service.protocol === request.protocol &&
              service.port === request.port,
          )
        )
          return fail(
            current,
            phase,
            ttl,
            'service_closed',
            'service_closed',
            'Destination is not listening',
            `${current.name} was reached, but no enabled ${request.protocol}/${request.port} service accepts this request.`,
          );
        step(
          current,
          phase,
          'destination',
          phase === 'request' ? 'Service received the request' : 'Response reached the client',
          phase === 'request'
            ? `${current.name} accepts ${request.protocol}/${request.port}. A separate return packet must still reach ${source!.name}.`
            : `The response reached ${source!.name} on modelled ephemeral port 49152. Both directions succeeded.`,
          'pass',
          ttl,
        );
        return true;
      }
      const selected = chooseRoute(current, packetDestination);
      if (!selected)
        return fail(
          current,
          phase,
          ttl,
          'unreachable',
          'no_route',
          'No route to destination',
          `${current.name} has no enabled connected or static route matching ${packetDestination} in the ${phase} phase.`,
        );
      step(
        current,
        phase,
        'route',
        `Selected ${selected.destination}`,
        `Next hop ${selected.nextHop} · metric ${selected.metric}. Longest prefix wins, then lower metric, then route ID.`,
        'pass',
        ttl,
        { routeId: selected.id },
      );
      let adjacency:
        { link: Link; localCidr: string; peerCidr: string; peer: NetworkNode } | undefined;
      for (const link of model.links) {
        const local =
          link.a.nodeId === current.id ? link.a : link.b.nodeId === current.id ? link.b : undefined;
        if (!local || (selected.interfaceId && local.interfaceId !== selected.interfaceId))
          continue;
        const remote = local === link.a ? link.b : link.a;
        const peer = nodes.get(remote.nodeId)!;
        const peerInterface = peer.interfaces.find((item) => item.id === remote.interfaceId)!;
        if (peerInterface.cidr.split('/')[0] !== selected.nextHop) continue;
        adjacency = {
          link,
          localCidr: current.interfaces.find((item) => item.id === local.interfaceId)!.cidr,
          peerCidr: peerInterface.cidr,
          peer,
        };
        break;
      }
      if (!adjacency)
        return fail(
          current,
          phase,
          ttl,
          'unreachable',
          'next_hop_unreachable',
          'Next hop is not adjacent',
          `${current.name} selected ${selected.nextHop}, but no attached point-to-point peer owns that address.`,
          { routeId: selected.id },
        );
      const localAddress = adjacency.localCidr.split('/')[0];
      if (
        !cidrContains(adjacency.localCidr, selected.nextHop) ||
        !cidrContains(adjacency.peerCidr, localAddress)
      )
        return fail(
          current,
          phase,
          ttl,
          'unreachable',
          'subnet_mismatch',
          'Peers are not mutually on-link',
          `${current.name} uses ${adjacency.localCidr}; its peer uses ${adjacency.peerCidr}. Both interface subnets must contain the other peer’s address.`,
          { routeId: selected.id, linkId: adjacency.link.id },
        );
      if (!adjacency.link.enabled)
        return fail(
          current,
          phase,
          ttl,
          'unreachable',
          'link_down',
          'Selected link is down',
          `${adjacency.link.id} is disabled. The selected route cannot cross this link.`,
          { linkId: adjacency.link.id, routeId: selected.id },
        );
      step(
        current,
        phase,
        'link',
        `Forward to ${adjacency.peer.name}`,
        `${adjacency.link.id} · ${adjacency.link.latencyMs} ms modelled one-way transit.`,
        'pass',
        ttl,
        { linkId: adjacency.link.id, routeId: selected.id },
      );
      result.modelledLatencyMs += adjacency.link.latencyMs;
      result.hopCount++;
      current = adjacency.peer;
      path.push(current.id);
    }
    return fail(
      current,
      phase,
      ttl,
      'ttl_exceeded',
      'simulation_bound',
      'Simulation bound reached',
      'The bounded forwarding model stopped this path. Inspect routing loops.',
    );
  }
  if (!walk(source, destination, 'request')) return result;
  if (!walk(destination, source, 'response')) return result;
  result.delivered = true;
  result.status = 'delivered';
  result.faultCode = 'none';
  result.reason =
    'The request reached an enabled service and the independent response reached the source.';
  return result;
}
