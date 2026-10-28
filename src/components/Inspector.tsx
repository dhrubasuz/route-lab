import { useState } from 'react';
import type { FirewallRule, Link, NetworkNode, Route, Topology } from '../engine/types';
import { Icon } from './Icons';

function Input({
  label,
  value,
  onChange,
  type = 'text',
  min,
  max,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  min?: number;
  max?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
      />
    </label>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="toggle-label">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
      <i aria-hidden="true" />
    </label>
  );
}

export function NodeInspector({
  node,
  onApply,
}: {
  node: NetworkNode;
  onApply: (node: NetworkNode) => string[];
}) {
  const [draft, setDraft] = useState(() => structuredClone(node));
  const [errors, setErrors] = useState<string[]>([]);
  const dirty = JSON.stringify(node) !== JSON.stringify(draft);
  function changeRoute(index: number, patch: Partial<Route>) {
    setDraft((previous) => ({
      ...previous,
      routes: previous.routes.map((route, i) => (i === index ? { ...route, ...patch } : route)),
    }));
  }
  function changeRule(index: number, patch: Partial<FirewallRule>) {
    setDraft((previous) => ({
      ...previous,
      firewall: previous.firewall.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    }));
  }
  function save() {
    const findings = onApply(draft);
    setErrors(findings);
  }
  return (
    <aside className="inspector-panel" aria-label="Device configuration inspector">
      <div className="panel-eyebrow">
        DEVICE INSPECTOR <span className="mono">{node.kind.toUpperCase()}</span>
      </div>
      <div className="inspector-heading">
        <div>
          <h2>{node.name}</h2>
          <p>
            {node.zone} <span> / </span> {node.id}
          </p>
        </div>
        <span className={`status-tag ${draft.status === 'down' ? 'tag-offline' : 'tag-online'}`}>
          {draft.status}
        </span>
      </div>
      <div className="inspector-body">
        <Toggle
          label="Device online"
          checked={draft.status === 'up'}
          onChange={(checked) => setDraft({ ...draft, status: checked ? 'up' : 'down' })}
        />
        <details open className="config-section">
          <summary>
            Interfaces <span>{draft.interfaces.length}</span>
          </summary>
          <div className="config-section-body">
            {draft.interfaces.map((networkInterface, index) => (
              <Input
                key={networkInterface.id}
                label={`${networkInterface.name} · IPv4 / prefix`}
                value={networkInterface.cidr}
                onChange={(cidr) =>
                  setDraft((previous) => ({
                    ...previous,
                    interfaces: previous.interfaces.map((item, i) =>
                      i === index ? { ...item, cidr } : item,
                    ),
                  }))
                }
              />
            ))}
          </div>
        </details>
        <details open={node.kind === 'router'} className="config-section">
          <summary>
            Static routes <span>{draft.routes.length}</span>
          </summary>
          <div className="config-section-body">
            {draft.routes.length ? (
              draft.routes.map((route, index) => (
                <div className="config-card" key={route.id}>
                  <div className="config-card-top">
                    <code>{route.id}</code>
                    <button
                      className="icon-only tiny"
                      aria-label={`Remove route ${route.id}`}
                      onClick={() =>
                        setDraft({ ...draft, routes: draft.routes.filter((_, i) => i !== index) })
                      }
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                  <Input
                    label="Destination CIDR"
                    value={route.destination}
                    onChange={(destination) => changeRoute(index, { destination })}
                  />
                  <Input
                    label="Next-hop address"
                    value={route.nextHop}
                    onChange={(nextHop) => changeRoute(index, { nextHop })}
                  />
                  <Input
                    label="Metric"
                    value={route.metric}
                    type="number"
                    min={0}
                    max={65535}
                    onChange={(metric) => changeRoute(index, { metric: Number(metric) })}
                  />
                  <Toggle
                    label="Route enabled"
                    checked={route.enabled}
                    onChange={(enabled) => changeRoute(index, { enabled })}
                  />
                </div>
              ))
            ) : (
              <p className="config-empty">
                No static routes. Connected subnets are derived from interfaces.
              </p>
            )}
            <button
              className="add-config"
              disabled={draft.routes.length >= 128}
              onClick={() =>
                setDraft((previous) => ({
                  ...previous,
                  routes: [
                    ...previous.routes,
                    {
                      id: `route-${Date.now()}`,
                      destination: '0.0.0.0/0',
                      nextHop: '0.0.0.0',
                      metric: 100,
                      enabled: true,
                    },
                  ],
                }))
              }
            >
              + Add static route
            </button>
          </div>
        </details>
        {node.kind === 'firewall' ? (
          <details open className="config-section">
            <summary>
              Firewall rules <span>{draft.firewall.length}</span>
            </summary>
            <div className="config-section-body">
              <p className="config-explainer">
                Lower priority wins. First matching rule applies. No match means deny.
              </p>
              {draft.firewall.map((rule, index) => (
                <div className="config-card" key={rule.id}>
                  <div className="config-card-top">
                    <code>{rule.id}</code>
                    <button
                      className="icon-only tiny"
                      aria-label={`Remove rule ${rule.id}`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          firewall: draft.firewall.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                  <Input
                    label="Rule label"
                    value={rule.label}
                    onChange={(label) => changeRule(index, { label })}
                  />
                  <div className="field-row">
                    <Input
                      label="Priority"
                      value={rule.priority}
                      type="number"
                      min={0}
                      max={65535}
                      onChange={(priority) => changeRule(index, { priority: Number(priority) })}
                    />
                    <label className="field">
                      <span>Action</span>
                      <select
                        value={rule.action}
                        onChange={(event) =>
                          changeRule(index, { action: event.target.value as 'allow' | 'deny' })
                        }
                      >
                        <option value="allow">Allow</option>
                        <option value="deny">Deny</option>
                      </select>
                    </label>
                  </div>
                  <Input
                    label="Source CIDR"
                    value={rule.sourceCidr}
                    onChange={(sourceCidr) => changeRule(index, { sourceCidr })}
                  />
                  <Input
                    label="Destination CIDR"
                    value={rule.destinationCidr}
                    onChange={(destinationCidr) => changeRule(index, { destinationCidr })}
                  />
                  <div className="field-row">
                    <label className="field">
                      <span>Protocol</span>
                      <select
                        value={rule.protocol}
                        onChange={(event) =>
                          changeRule(index, {
                            protocol: event.target.value as FirewallRule['protocol'],
                          })
                        }
                      >
                        <option>TCP</option>
                        <option>UDP</option>
                        <option>ANY</option>
                      </select>
                    </label>
                    <Input
                      label="Port or any"
                      value={rule.port}
                      onChange={(value) =>
                        changeRule(index, { port: value === 'any' ? 'any' : Number(value) })
                      }
                    />
                  </div>
                  <Toggle
                    label="Rule enabled"
                    checked={rule.enabled}
                    onChange={(enabled) => changeRule(index, { enabled })}
                  />
                </div>
              ))}
              <button
                className="add-config"
                disabled={draft.firewall.length >= 128}
                onClick={() =>
                  setDraft((previous) => ({
                    ...previous,
                    firewall: [
                      ...previous.firewall,
                      {
                        id: `rule-${Date.now()}`,
                        label: 'New rule',
                        priority: 150,
                        action: 'allow',
                        sourceCidr: '10.10.0.0/16',
                        destinationCidr: '10.20.1.0/24',
                        protocol: 'TCP',
                        port: 443,
                        enabled: true,
                      },
                    ],
                  }))
                }
              >
                + Add firewall rule
              </button>
            </div>
          </details>
        ) : null}
        {draft.services.length ? (
          <details open className="config-section">
            <summary>
              Listening services <span>{draft.services.length}</span>
            </summary>
            <div className="config-section-body">
              {draft.services.map((service, index) => (
                <div className="config-card" key={`${index}-${service.protocol}`}>
                  <span className="config-service-name">
                    {service.name} / {service.protocol}
                  </span>
                  <Input
                    label="Listening port"
                    value={service.port}
                    type="number"
                    min={1}
                    max={65535}
                    onChange={(value) =>
                      setDraft((previous) => ({
                        ...previous,
                        services: previous.services.map((item, i) =>
                          i === index ? { ...item, port: Number(value) } : item,
                        ),
                      }))
                    }
                  />
                  <Toggle
                    label={`${service.name} enabled`}
                    checked={service.enabled}
                    onChange={(enabled) =>
                      setDraft((previous) => ({
                        ...previous,
                        services: previous.services.map((item, i) =>
                          i === index ? { ...item, enabled } : item,
                        ),
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          </details>
        ) : null}
        {errors.length ? (
          <div className="form-error" role="alert">
            <strong>Configuration was not applied.</strong>
            <ul>
              {errors.slice(0, 8).map((error, index) => (
                <li key={`${index}-${error}`}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="inspector-actions">
        <p>{dirty ? 'Unsaved configuration changes' : 'Edit a value, then apply and retrace.'}</p>
        <button className="button primary compact" disabled={!dirty} onClick={save}>
          Apply configuration <Icon name="check" size={15} />
        </button>
        {dirty ? (
          <button
            className="text-button"
            onClick={() => {
              setDraft(structuredClone(node));
              setErrors([]);
            }}
          >
            Discard changes
          </button>
        ) : null}
      </div>
    </aside>
  );
}

export function LinkInspector({
  link,
  topology,
  onApply,
}: {
  link: Link;
  topology: Topology;
  onApply: (link: Link) => string[];
}) {
  const [draft, setDraft] = useState(() => structuredClone(link));
  const [errors, setErrors] = useState<string[]>([]);
  const a = topology.nodes.find((node) => node.id === link.a.nodeId),
    b = topology.nodes.find((node) => node.id === link.b.nodeId);
  const dirty = JSON.stringify(draft) !== JSON.stringify(link);
  return (
    <aside className="inspector-panel" aria-label="Physical link configuration">
      <div className="panel-eyebrow">
        LINK INSPECTOR <span className="mono">POINT TO POINT</span>
      </div>
      <div className="inspector-heading">
        <div>
          <h2>
            {a?.name} <span>↔</span> {b?.name}
          </h2>
          <p>{link.id}</p>
        </div>
      </div>
      <div className="inspector-body">
        <div className="link-endpoints">
          <code>{a?.interfaces.find((item) => item.id === link.a.interfaceId)?.cidr}</code>
          <span>↕</span>
          <code>{b?.interfaces.find((item) => item.id === link.b.interfaceId)?.cidr}</code>
        </div>
        <Toggle
          label="Physical link enabled"
          checked={draft.enabled}
          onChange={(enabled) => setDraft({ ...draft, enabled })}
        />
        <Input
          label="Modelled one-way latency (ms)"
          value={draft.latencyMs}
          type="number"
          min={0}
          max={1000}
          onChange={(value) => setDraft({ ...draft, latencyMs: Number(value) })}
        />
        <p className="config-explainer">
          This is a configured simulation value, not a measurement of a real network.
        </p>
        {errors.length ? (
          <div role="alert" className="form-error">
            {errors.join(' ')}
          </div>
        ) : null}
      </div>
      <div className="inspector-actions">
        <button
          className="button primary compact"
          disabled={!dirty}
          onClick={() => setErrors(onApply(draft))}
        >
          Apply link configuration <Icon name="check" size={15} />
        </button>
        {dirty ? (
          <button
            className="text-button"
            onClick={() => {
              setDraft(structuredClone(link));
              setErrors([]);
            }}
          >
            Discard changes
          </button>
        ) : null}
      </div>
    </aside>
  );
}
