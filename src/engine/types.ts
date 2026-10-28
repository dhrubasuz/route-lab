/** Original educational network model. Author: Dhruba Poudel. */
export type Protocol = 'TCP' | 'UDP';
export type NodeKind = 'client' | 'router' | 'firewall' | 'service';
export interface NetworkInterface {
  id: string;
  name: string;
  cidr: string;
}
export interface Route {
  id: string;
  destination: string;
  nextHop: string;
  metric: number;
  enabled: boolean;
}
export interface FirewallRule {
  id: string;
  label: string;
  priority: number;
  action: 'allow' | 'deny';
  sourceCidr: string;
  destinationCidr: string;
  protocol: Protocol | 'ANY';
  port: number | 'any';
  enabled: boolean;
}
export interface Service {
  protocol: Protocol;
  port: number;
  name: string;
  enabled: boolean;
}
export interface NetworkNode {
  id: string;
  name: string;
  kind: NodeKind;
  zone: string;
  status: 'up' | 'down';
  interfaces: NetworkInterface[];
  routes: Route[];
  firewall: FirewallRule[];
  services: Service[];
  position: { x: number; y: number };
}
export interface Link {
  id: string;
  a: { nodeId: string; interfaceId: string };
  b: { nodeId: string; interfaceId: string };
  enabled: boolean;
  latencyMs: number;
}
export interface Topology {
  schemaVersion: 1;
  name: string;
  nodes: NetworkNode[];
  links: Link[];
}
export interface TraceRequest {
  sourceId: string;
  destinationId: string;
  protocol: Protocol;
  port: number;
  ttl: number;
}
export type Phase = 'request' | 'response';
export interface TraceStep {
  id: string;
  index: number;
  nodeId: string;
  nodeName: string;
  phase: Phase;
  kind: 'source' | 'route' | 'firewall' | 'link' | 'destination' | 'drop';
  title: string;
  detail: string;
  decision: 'pass' | 'fail' | 'info';
  ttl: number;
  ruleId?: string;
  routeId?: string;
  linkId?: string;
}
export interface TraceResult {
  modelVersion: '1.0';
  request: TraceRequest;
  delivered: boolean;
  status: 'delivered' | 'blocked' | 'unreachable' | 'ttl_exceeded' | 'service_closed' | 'invalid';
  reason: string;
  faultCode: string;
  steps: TraceStep[];
  forwardPath: string[];
  returnPath: string[];
  modelledLatencyMs: number;
  hopCount: number;
}
export type ScenarioId =
  | 'healthy'
  | 'blocked-https'
  | 'missing-route'
  | 'wrong-subnet'
  | 'link-down'
  | 'route-loop'
  | 'return-route'
  | 'service-down';
export interface Scenario {
  id: ScenarioId;
  title: string;
  category: string;
  difficulty: 'Foundation' | 'Intermediate' | 'Advanced';
  summary: string;
  objective: string;
  hint: string;
  repairSummary: string;
}
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  topology?: Topology;
}

// The engine exposes these functions from index.ts; UI must use real computed results.
// createTopology(scenarioId?: ScenarioId): Topology
// defaultRequest(): TraceRequest
// trace(topology: Topology, request: TraceRequest): TraceResult
// repairTopology(topology: Topology, scenarioId: ScenarioId): Topology
// validateTopology(value: unknown): ValidationResult
// parseIPv4(value: string): number | null
// parseCIDR(value: string): { address: number; network: number; prefix: number; mask: number } | null
// cidrContains(cidr: string, address: string): boolean
// SCENARIOS: readonly Scenario[]
