import { useEffect, useRef, useState } from 'react';
import {
  createTopology,
  defaultRequest,
  repairTopology,
  SCENARIOS,
  trace,
  validateTopology,
} from './engine';
import type {
  Link,
  NetworkNode,
  ScenarioId,
  Topology,
  TraceRequest,
  TraceResult,
} from './engine/types';
import { Icon } from './components/Icons';
import TopologyMap from './components/TopologyMap';
import { LinkInspector, NodeInspector } from './components/Inspector';
import TracePanel from './components/TracePanel';

const INITIAL_SCENARIO: ScenarioId = 'blocked-https';
const INITIAL_TOPOLOGY = createTopology(INITIAL_SCENARIO);
const INITIAL_REQUEST = defaultRequest();
const INITIAL_RESULT = trace(INITIAL_TOPOLOGY, INITIAL_REQUEST);

interface Comparison {
  before: TraceResult;
  after: TraceResult;
  changes: string[];
  label: string;
}

function describeChanges(before: Topology, after: Topology): string[] {
  const changes: string[] = [];
  for (const node of after.nodes) {
    const previous = before.nodes.find((item) => item.id === node.id);
    if (!previous) {
      changes.push(`Added ${node.name}.`);
      continue;
    }
    if (previous.status !== node.status)
      changes.push(`${node.name}: ${previous.status} → ${node.status}.`);
    for (const item of node.interfaces) {
      const old = previous.interfaces.find((part) => part.id === item.id);
      if (old && old.cidr !== item.cidr)
        changes.push(`${node.name} / ${item.name}: ${old.cidr} → ${item.cidr}.`);
    }
    for (const item of node.routes) {
      const old = previous.routes.find((part) => part.id === item.id);
      if (!old) changes.push(`${node.name}: added route ${item.id}.`);
      else if (JSON.stringify(old) !== JSON.stringify(item))
        changes.push(
          `${node.name} / ${item.id}: ${old.destination} via ${old.nextHop} (${old.enabled ? 'enabled' : 'disabled'}) → ${item.destination} via ${item.nextHop} (${item.enabled ? 'enabled' : 'disabled'}), metric ${old.metric} → ${item.metric}.`,
        );
    }
    for (const item of previous.routes)
      if (!node.routes.some((part) => part.id === item.id))
        changes.push(`${node.name}: removed route ${item.id}.`);
    for (const item of node.firewall) {
      const old = previous.firewall.find((part) => part.id === item.id);
      if (!old)
        changes.push(
          `${node.name}: added firewall rule ${item.id}: ${item.action} ${item.protocol}:${item.port}, ${item.sourceCidr} → ${item.destinationCidr}, priority ${item.priority}, ${item.enabled ? 'enabled' : 'disabled'}.`,
        );
      else if (JSON.stringify(old) !== JSON.stringify(item)) {
        const fields = (
          [
            'label',
            'priority',
            'action',
            'sourceCidr',
            'destinationCidr',
            'protocol',
            'port',
            'enabled',
          ] as const
        )
          .filter((field) => old[field] !== item[field])
          .map((field) => `${field}: ${String(old[field])} → ${String(item[field])}`);
        changes.push(`${node.name} / ${item.id}: ${fields.join('; ')}.`);
      }
    }
    for (const item of previous.firewall)
      if (!node.firewall.some((part) => part.id === item.id))
        changes.push(`${node.name}: removed firewall rule ${item.id}.`);
    node.services.forEach((item, index) => {
      const old = previous.services[index];
      if (old && JSON.stringify(old) !== JSON.stringify(item))
        changes.push(
          `${node.name} / ${item.name}: ${old.protocol}:${old.port} ${old.enabled ? 'enabled' : 'disabled'} → ${item.protocol}:${item.port} ${item.enabled ? 'enabled' : 'disabled'}.`,
        );
    });
  }
  for (const link of after.links) {
    const old = before.links.find((item) => item.id === link.id);
    if (old && (old.enabled !== link.enabled || old.latencyMs !== link.latencyMs))
      changes.push(
        `${link.id}: ${old.enabled ? 'enabled' : 'disabled'} → ${link.enabled ? 'enabled' : 'disabled'}, modelled latency ${old.latencyMs} → ${link.latencyMs} ms.`,
      );
  }
  return changes;
}

function downloadJSON(filename: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ResultLabel({ result }: { result: TraceResult }) {
  const labels: Record<TraceResult['status'], string> = {
    delivered: 'Round trip delivered',
    blocked: 'Blocked',
    unreachable: 'Unreachable',
    ttl_exceeded: 'TTL exceeded',
    service_closed: 'Service closed',
    invalid: 'Invalid request',
  };
  return (
    <span className={`result-label ${result.delivered ? 'result-success' : 'result-failure'}`}>
      <i />
      {labels[result.status]}
    </span>
  );
}

export default function App() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>(INITIAL_SCENARIO);
  const [topology, setTopology] = useState<Topology>(() => structuredClone(INITIAL_TOPOLOGY));
  const [initialTopology, setInitialTopology] = useState<Topology>(() =>
    structuredClone(INITIAL_TOPOLOGY),
  );
  const [request, setRequest] = useState<TraceRequest>(() => ({ ...INITIAL_REQUEST }));
  const [result, setResult] = useState<TraceResult>(INITIAL_RESULT);
  const [activeStep, setActiveStep] = useState(INITIAL_RESULT.steps.length - 1);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState('firewall');
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [revision, setRevision] = useState(1);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [hintVisible, setHintVisible] = useState(false);
  const [notice, setNotice] = useState(
    'Scenario loaded. Inspect the stopped packet, then repair the configuration.',
  );
  const [importError, setImportError] = useState('');
  const [imported, setImported] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const helpDialog = useRef<HTMLDialogElement>(null);
  const scenario = SCENARIOS.find((item) => item.id === scenarioId) ?? SCENARIOS[0];
  const selectedNode = topology.nodes.find((node) => node.id === selectedId) ?? topology.nodes[0];
  const selectedLink = topology.links.find((link) => link.id === selectedLinkId);
  const requestChanged = JSON.stringify(request) !== JSON.stringify(result.request);
  const active = result.steps[activeStep];

  useEffect(() => {
    if (!playing) return;
    if (activeStep >= result.steps.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setActiveStep((previous) => previous + 1), 780);
    return () => window.clearTimeout(timer);
  }, [playing, activeStep, result.steps.length]);

  function present(next: TraceResult) {
    setResult(next);
    setPlaying(false);
    setActiveStep(next.steps.length - 1);
    const failure = next.steps.findLast((step) => step.decision === 'fail');
    if (failure && topology.nodes.some((node) => node.id === failure.nodeId)) {
      setSelectedId(failure.nodeId);
      setSelectedLinkId(null);
    }
  }

  function chooseScenario(id: ScenarioId) {
    const next = createTopology(id),
      nextRequest = defaultRequest(),
      nextResult = trace(next, nextRequest);
    setScenarioId(id);
    setTopology(next);
    setInitialTopology(structuredClone(next));
    setRequest(nextRequest);
    setComparison(null);
    setHintVisible(false);
    setImportError('');
    setImported(false);
    setRevision((previous) => previous + 1);
    setSelectedId(
      nextResult.steps.findLast((step) => step.decision === 'fail')?.nodeId ?? 'client',
    );
    setSelectedLinkId(null);
    setResult(nextResult);
    setActiveStep(nextResult.steps.length - 1);
    setPlaying(false);
    setNotice(
      `${SCENARIOS.find((item) => item.id === id)?.title} loaded. ${nextResult.delivered ? 'The request and response both arrived.' : nextResult.reason}`,
    );
  }

  function applyTopology(next: Topology, label: string): string[] {
    const checked = validateTopology(next);
    if (!checked.valid || !checked.topology)
      return checked.errors.length ? checked.errors : ['The topology could not be validated.'];
    const accepted = checked.topology;
    const before = trace(topology, request),
      after = trace(accepted, request);
    const changes = describeChanges(topology, accepted);
    setTopology(accepted);
    setRevision((previous) => previous + 1);
    setComparison({ before, after, changes, label });
    present(after);
    setNotice(
      `${label}. ${after.delivered ? 'The request and response were delivered.' : after.reason}`,
    );
    return [];
  }

  function applyNode(node: NetworkNode) {
    return applyTopology(
      { ...topology, nodes: topology.nodes.map((item) => (item.id === node.id ? node : item)) },
      'Device configuration applied',
    );
  }
  function applyLink(link: Link) {
    return applyTopology(
      { ...topology, links: topology.links.map((item) => (item.id === link.id ? link : item)) },
      'Link configuration applied',
    );
  }

  function repair() {
    const errors = applyTopology(repairTopology(topology, scenarioId), 'Scenario repair applied');
    if (errors.length) setNotice(`Repair was not applied: ${errors.join(' ')}`);
  }

  function runTrace(event?: React.FormEvent) {
    event?.preventDefault();
    const next = trace(topology, request);
    present(next);
    setComparison(null);
    setNotice(
      next.delivered
        ? 'Trace complete. Both request and response arrived.'
        : `Trace complete. ${next.reason}`,
    );
  }

  function changeRequest(patch: Partial<TraceRequest>) {
    setRequest((previous) => ({ ...previous, ...patch }));
    setComparison(null);
    setPlaying(false);
  }

  function exportReport() {
    downloadJSON('routelab-diagnostic-report.json', {
      author: 'Dhruba Poudel',
      creator: 'Dhruba Poudel',
      lastModifiedBy: 'Dhruba Poudel',
      format: 'RouteLab diagnostic report',
      schemaVersion: 1,
      modelVersion: '1.0',
      scenario: imported ? 'Imported topology' : scenario.title,
      scope:
        'Fictional IPv4 static-routing model with stateless firewall rules. No real packets are sent. Latencies are configured model values.',
      topology,
      baselineTopology: initialTopology,
      request: result.request,
      trace: result,
      comparison,
    });
    setNotice(
      'Diagnostic report downloaded, including configuration, trace and comparison evidence.',
    );
  }

  async function importFile(file?: File) {
    if (!file) return;
    setImportError('');
    if (file.size > 65536) {
      setImportError('Choose a JSON topology or RouteLab report no larger than 64 KiB.');
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const candidate =
        parsed && typeof parsed === 'object' && 'topology' in parsed
          ? (parsed as { topology: unknown }).topology
          : parsed;
      const checked = validateTopology(candidate);
      if (!checked.valid || !checked.topology) {
        setImportError(checked.errors.slice(0, 6).join(' '));
        return;
      }
      const next = checked.topology,
        baseRequest = defaultRequest();
      const client = next.nodes.find((node) => node.kind === 'client') ?? next.nodes[0];
      const destination =
        next.nodes.find((node) => node.kind === 'service' && node.id !== client.id) ??
        next.nodes.find((node) => node.id !== client.id) ??
        client;
      const savedRequest =
        parsed && typeof parsed === 'object' && 'topology' in parsed && 'request' in parsed
          ? (parsed as { request: unknown }).request
          : undefined;
      const nextRequest =
        savedRequest === undefined
          ? { ...baseRequest, sourceId: client.id, destinationId: destination.id }
          : (savedRequest as TraceRequest);
      const nextResult = trace(next, nextRequest);
      if (nextResult.status === 'invalid') {
        setImportError(`The imported request could not be used. ${nextResult.reason}`);
        return;
      }
      setTopology(next);
      setInitialTopology(structuredClone(next));
      setRequest(nextRequest);
      setResult(nextResult);
      setActiveStep(nextResult.steps.length - 1);
      setSelectedId(nextRequest.sourceId);
      setSelectedLinkId(null);
      setComparison(null);
      setRevision((previous) => previous + 1);
      setImported(true);
      setPlaying(false);
      setNotice(
        savedRequest === undefined
          ? 'Topology imported and traced locally. Choose a built-in scenario to return to the guided lab.'
          : 'Report configuration and request imported. The trace was recomputed locally; saved outcomes were not trusted.',
      );
    } catch {
      setImportError('The file could not be read as valid JSON. No configuration was changed.');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to the network lab
      </a>
      <header className="site-header">
        <a className="wordmark" href="./" aria-label="RouteLab home">
          <span className="brand-symbol">
            <Icon name="route" size={25} />
          </span>
          <span>
            Route<span className="wordmark-light">Lab</span>
            <small>NETWORK DIAGNOSTICS</small>
          </span>
        </a>
        <div className="header-middle">
          <span className="version-chip mono">V1.0</span>
          <span>
            Built by <a href="https://about.dhrub.com.np/">Dhruba Poudel</a>
          </span>
        </div>
        <nav aria-label="Project navigation">
          <button onClick={() => helpDialog.current?.showModal()}>
            <Icon name="info" size={17} />
            <span>The model</span>
          </button>
          <a
            href="https://github.com/dhrubasuz/route-lab"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="code" size={18} />
            <span>Source code</span>
            <Icon name="external" size={13} />
          </a>
        </nav>
      </header>
      <div className="hero-strip">
        <div>
          <span className="eyebrow">
            <i /> AN INTERACTIVE NETWORK LAB
          </span>
          <h1>
            Follow the packet.
            <br className="mobile-break" /> <span>Find the fault.</span>
          </h1>
          <p>Break a fictional network. Explain the failure. Prove the repair.</p>
        </div>
        <div className="hero-stamp">
          <span className="stamp-route">
            A <i /> B
          </span>
          <span>ROUTING / POLICY / RECOVERY</span>
          <strong>Every hop, accounted for.</strong>
        </div>
      </div>
      <main id="main" className="lab-shell">
        <aside className="scenario-rail" aria-label="Network scenarios">
          <div className="rail-heading">
            <span className="eyebrow">THE SCENARIOS</span>
            <span className="mono">01—08</span>
          </div>
          <p className="rail-intro">
            Start with a fault.
            <br />
            Leave with an explanation.
          </p>
          <div className="scenario-list">
            {SCENARIOS.map((item, index) => (
              <button
                key={item.id}
                className={`scenario-button ${item.id === scenarioId && !imported ? 'is-selected' : ''}`}
                onClick={() => chooseScenario(item.id)}
                aria-pressed={item.id === scenarioId && !imported}
              >
                <span className="scenario-number mono">{String(index + 1).padStart(2, '0')}</span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.category}</small>
                </span>
                <Icon name="chevron" size={13} />
              </button>
            ))}
          </div>
          <div className="rail-footnote">
            <Icon name="shield" size={20} />
            <p>
              Learn by changing the model.<span>Nothing touches a real network.</span>
            </p>
          </div>
        </aside>
        <div className="lab-content">
          <section className="scenario-intro" aria-labelledby="scenario-title">
            <div>
              <div className="scenario-kicker">
                <span className="eyebrow">
                  {imported
                    ? 'YOUR LOCAL TOPOLOGY'
                    : `SCENARIO / ${scenario.category.toUpperCase()}`}
                </span>
                <span className="difficulty-chip">
                  {imported ? 'Custom configuration' : scenario.difficulty}
                </span>
              </div>
              <h2 id="scenario-title">{imported ? topology.name : scenario.title}</h2>
              <p>
                {imported
                  ? 'Imported configuration. Inspect each device and trace the request to diagnose its behaviour.'
                  : scenario.summary}
              </p>
            </div>
            <div className="workspace-tools">
              <button className="tool-button" onClick={() => fileInput.current?.click()}>
                <Icon name="upload" size={17} />
                Import
              </button>
              <button className="tool-button" onClick={exportReport}>
                <Icon name="download" size={17} />
                Export report
              </button>
              <input
                ref={fileInput}
                className="visually-hidden"
                type="file"
                accept=".json,application/json"
                aria-label="Import topology JSON"
                onChange={(event) => void importFile(event.target.files?.[0])}
              />
            </div>
          </section>
          {importError ? (
            <div className="import-error" role="alert">
              <Icon name="info" />
              <div>
                <strong>Topology was not imported.</strong>
                <p>{importError}</p>
              </div>
              <button
                className="icon-only"
                onClick={() => setImportError('')}
                aria-label="Dismiss import error"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          ) : null}
          <div className="studio-grid">
            <div className="network-workspace">
              <TopologyMap
                topology={topology}
                result={result}
                activeStep={activeStep}
                playing={playing}
                selectedId={selectedId}
                selectedLinkId={selectedLinkId}
                onSelectNode={(id) => {
                  setSelectedId(id);
                  setSelectedLinkId(null);
                }}
                onSelectLink={(id) => setSelectedLinkId(id)}
              />
              <form className="request-bar" onSubmit={runTrace}>
                <div className="request-bar-title">
                  <Icon name="route" size={19} />
                  <span>TRACE REQUEST</span>
                </div>
                <div className="request-fields">
                  <label className="field">
                    <span>From</span>
                    <select
                      value={request.sourceId}
                      onChange={(event) => changeRequest({ sourceId: event.target.value })}
                    >
                      {topology.nodes.map((node) => (
                        <option key={node.id} value={node.id}>
                          {node.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="request-arrow">
                    <Icon name="arrow" size={18} />
                  </span>
                  <label className="field">
                    <span>To</span>
                    <select
                      value={request.destinationId}
                      onChange={(event) => changeRequest({ destinationId: event.target.value })}
                    >
                      {topology.nodes.map((node) => (
                        <option key={node.id} value={node.id}>
                          {node.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field protocol-field">
                    <span>Protocol</span>
                    <select
                      value={request.protocol}
                      onChange={(event) =>
                        changeRequest({ protocol: event.target.value as TraceRequest['protocol'] })
                      }
                    >
                      <option>TCP</option>
                      <option>UDP</option>
                    </select>
                  </label>
                  <label className="field port-field">
                    <span>Port</span>
                    <input
                      aria-label="Destination port"
                      type="number"
                      min="1"
                      max="65535"
                      required
                      value={request.port}
                      onChange={(event) => changeRequest({ port: Number(event.target.value) })}
                    />
                  </label>
                  <label className="field ttl-field">
                    <span>TTL</span>
                    <input
                      aria-label="Initial packet TTL"
                      type="number"
                      min="1"
                      max="64"
                      required
                      value={request.ttl}
                      onChange={(event) => changeRequest({ ttl: Number(event.target.value) })}
                    />
                  </label>
                  <button className="button primary run-button" type="submit">
                    Run trace <Icon name="arrow" size={17} />
                  </button>
                </div>
                {requestChanged ? (
                  <p className="request-pending">
                    Request changed. Run trace to compute the new path.
                  </p>
                ) : (
                  <p className="request-caption">
                    IPv4 · Static routes · Stateless policy · Request + response
                  </p>
                )}
              </form>
              <section
                className={`result-banner ${result.delivered ? 'banner-success' : 'banner-failure'}`}
                aria-label="Trace result"
              >
                <div className="result-icon">
                  <Icon name={result.delivered ? 'check' : 'shield'} size={22} />
                </div>
                <div>
                  <ResultLabel result={result} />
                  <p>{result.reason}</p>
                </div>
                <div className="result-stats">
                  <strong className="mono">
                    {result.hopCount}
                    <small>traversals</small>
                  </strong>
                  <strong className="mono">
                    {result.modelledLatencyMs}
                    <small>ms modelled</small>
                  </strong>
                </div>
              </section>
              {!imported ? (
                <section className="mission-card">
                  <div>
                    <span className="eyebrow">YOUR OBJECTIVE</span>
                    <p>{scenario.objective}</p>
                    {hintVisible ? (
                      <div className="hint-text">
                        <strong>A direction to investigate</strong>
                        <p>{scenario.hint}</p>
                      </div>
                    ) : null}
                  </div>
                  <div className="mission-actions">
                    <button
                      className="text-button"
                      onClick={() => setHintVisible((previous) => !previous)}
                    >
                      {hintVisible ? 'Hide hint' : 'Show a hint'}
                    </button>
                    <button
                      className="button repair-button"
                      onClick={repair}
                      disabled={scenarioId === 'healthy'}
                    >
                      <Icon name="wrench" size={16} />
                      Apply scenario repair
                    </button>
                    <button
                      className="text-button reset-scenario"
                      onClick={() => chooseScenario(scenarioId)}
                    >
                      Reset this scenario
                    </button>
                  </div>
                </section>
              ) : null}
              {comparison ? (
                <section
                  className="comparison-panel"
                  aria-label="Before and after configuration evidence"
                >
                  <div className="comparison-heading">
                    <span className="eyebrow">CHANGE EVIDENCE</span>
                    <span className="mono">
                      REV {revision - 1} → {revision}
                    </span>
                  </div>
                  <div className="comparison-results">
                    <div>
                      <small>BEFORE</small>
                      <ResultLabel result={comparison.before} />
                    </div>
                    <Icon name="arrow" size={20} />
                    <div>
                      <small>AFTER</small>
                      <ResultLabel result={comparison.after} />
                    </div>
                    <span className="comparison-verdict">
                      {comparison.after.delivered
                        ? 'Round trip verified in this model.'
                        : 'A fault remains. Keep investigating.'}
                    </span>
                  </div>
                  <details>
                    <summary>
                      Inspect {comparison.changes.length} configuration{' '}
                      {comparison.changes.length === 1 ? 'change' : 'changes'}
                    </summary>
                    {comparison.changes.length ? (
                      <ul>
                        {comparison.changes.map((change, index) => (
                          <li key={index}>{change}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>
                        The repair did not change this configuration. Manual edits may have already
                        removed the selected fault.
                      </p>
                    )}
                  </details>
                </section>
              ) : null}
              <TracePanel
                result={result}
                activeStep={activeStep}
                playing={playing}
                onPlay={() => {
                  if (playing) setPlaying(false);
                  else {
                    if (activeStep >= result.steps.length - 1) setActiveStep(-1);
                    setPlaying(true);
                  }
                }}
                onStep={() => {
                  setPlaying(false);
                  setActiveStep((previous) => Math.min(previous + 1, result.steps.length - 1));
                }}
                onReset={() => {
                  setPlaying(false);
                  setActiveStep(-1);
                }}
                onSelectStep={(index) => {
                  setPlaying(false);
                  setActiveStep(index);
                  setSelectedId(result.steps[index].nodeId);
                  setSelectedLinkId(null);
                }}
              />
            </div>
            <div className="inspector-column">
              {selectedLink ? (
                <LinkInspector
                  key={`${selectedLink.id}-${revision}`}
                  link={selectedLink}
                  topology={topology}
                  onApply={applyLink}
                />
              ) : selectedNode ? (
                <NodeInspector
                  key={`${selectedNode.id}-${revision}`}
                  node={selectedNode}
                  onApply={applyNode}
                />
              ) : null}
              <div className="active-evidence">
                <span className="eyebrow">SELECTED TRACE STEP</span>
                <p>{active ? active.title : 'At the start line.'}</p>
                <span>
                  {active
                    ? `${active.nodeName} · ${active.phase} · TTL ${active.ttl}`
                    : 'Play or step through the computed evidence.'}
                </span>
              </div>
              <div className="inspector-tip">
                <Icon name="info" size={17} />
                <p>
                  Configuration changes are staged. Apply them to compute a new trace and compare
                  the result.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
      <div className="notice-bar" role="status" aria-live="polite">
        <span className="notice-symbol" />
        <span>{notice}</span>
        <span className="notice-runtime mono">LOCAL ENGINE / SIMULATED TRAFFIC</span>
      </div>
      <footer className="site-footer">
        <div className="footer-brand">
          RouteLab
          <span>
            Designed & developed by <a href="https://about.dhrub.com.np/">Dhruba Poudel</a>
          </span>
        </div>
        <p>An educational IPv4 model. Fictional devices, deterministic results.</p>
        <button onClick={() => helpDialog.current?.showModal()}>
          Model scope & references <Icon name="external" size={13} />
        </button>
      </footer>
      <dialog ref={helpDialog} className="model-dialog" aria-labelledby="model-title">
        <div className="dialog-heading">
          <span className="eyebrow">UNDER THE SURFACE</span>
          <button
            className="icon-only"
            aria-label="Close model information"
            onClick={() => helpDialog.current?.close()}
          >
            <Icon name="close" />
          </button>
        </div>
        <h2 id="model-title">
          A small network.
          <br />
          An inspectable model.
        </h2>
        <p>
          RouteLab computes an original, fictional IPv4 topology in your browser. Its purpose is to
          make routing and policy decisions understandable, repeatable and testable.
        </p>
        <h3>What is modelled</h3>
        <ul>
          <li>
            Connected and static routes, with longest-prefix selection, metric and deterministic ID
            tie-breaking.
          </li>
          <li>
            Adjacent next-hop resolution, interface subnets, physical-link state and node
            availability.
          </li>
          <li>First-match, priority-ordered stateless firewall rules and default deny.</li>
          <li>Forward request and return response, listening services and router TTL.</li>
        </ul>
        <h3>Where the model stops</h3>
        <p>
          No real packets are sent and no cloud accounts are connected. DNS, NAT, ARP, dynamic
          routing, TCP handshakes, encryption and stateful firewall sessions are outside this model.
          Configured link latencies are synthetic values, not measured response times.
        </p>
        <p>
          Imports are processed locally. This application does not upload a topology or diagnostic
          report. Refreshing the page starts a new lab; download a report to preserve your work.
        </p>
        <div className="reference-links">
          <a
            href="https://www.rfc-editor.org/rfc/rfc1812"
            target="_blank"
            rel="noopener noreferrer"
          >
            RFC 1812 · IPv4 forwarding <Icon name="external" size={13} />
          </a>
          <a
            href="https://www.rfc-editor.org/rfc/rfc4632"
            target="_blank"
            rel="noopener noreferrer"
          >
            RFC 4632 · CIDR addressing <Icon name="external" size={13} />
          </a>
          <a
            href="https://github.com/dhrubasuz/route-lab"
            target="_blank"
            rel="noopener noreferrer"
          >
            Implementation, tests & model contract <Icon name="external" size={13} />
          </a>
        </div>
        <button className="button primary" onClick={() => helpDialog.current?.close()}>
          Back to the lab <Icon name="arrow" size={16} />
        </button>
      </dialog>
    </div>
  );
}
