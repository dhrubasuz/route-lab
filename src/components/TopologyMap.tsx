import { useState } from 'react';
import type { NetworkNode, Topology, TraceResult, TraceStep } from '../engine/types';
import { DeviceGlyph } from './Icons';

function pathFor(a: NetworkNode, b: NetworkNode) {
  return `M ${a.position.x} ${a.position.y} L ${b.position.x} ${b.position.y}`;
}

export default function TopologyMap({
  topology,
  result,
  activeStep,
  playing,
  selectedId,
  selectedLinkId,
  onSelectNode,
  onSelectLink,
}: {
  topology: Topology;
  result: TraceResult;
  activeStep: number;
  playing: boolean;
  selectedId: string;
  selectedLinkId: string | null;
  onSelectNode: (id: string) => void;
  onSelectLink: (id: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const shownSteps = result.steps.slice(0, activeStep + 1);
  const visited = new Set(shownSteps.map((step) => step.nodeId));
  const traversed = new Set(
    shownSteps.filter((step) => step.kind === 'link').map((step) => step.linkId),
  );
  const current: TraceStep | undefined = result.steps[activeStep];
  const byId = new Map(topology.nodes.map((node) => [node.id, node]));
  const minX = Math.min(0, ...topology.nodes.map((node) => node.position.x - 90));
  const minY = Math.min(0, ...topology.nodes.map((node) => node.position.y - 90));
  const maxX = Math.max(1000, ...topology.nodes.map((node) => node.position.x + 90));
  const maxY = Math.max(540, ...topology.nodes.map((node) => node.position.y + 90));
  const customBounds = minX < 0 || minY < 0 || maxX > 1000 || maxY > 540;
  return (
    <div className="network-canvas">
      <div className="canvas-topline">
        <span>
          <i className="live-dot" /> TOPOLOGY / IPV4
        </span>
        <div className="canvas-meta">
          <span className="mono">
            {topology.nodes.length} devices · {topology.links.length} links
          </span>
          <div className="zoom-controls" aria-label="Topology zoom controls">
            <button
              aria-label="Zoom out topology"
              title="Zoom out"
              disabled={zoom <= 1}
              onClick={() => setZoom((previous) => Math.max(1, previous - 0.25))}
            >
              −
            </button>
            <button
              aria-label="Fit topology"
              title="Fit topology"
              className="zoom-fit"
              onClick={() => setZoom(1)}
            >
              {zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}
            </button>
            <button
              aria-label="Zoom in topology"
              title="Zoom in"
              disabled={zoom >= 2}
              onClick={() => setZoom((previous) => Math.min(2, previous + 0.25))}
            >
              +
            </button>
          </div>
        </div>
      </div>
      <div
        className="map-scroll"
        role="region"
        aria-label="Scrollable network topology"
        tabIndex={0}
      >
        <svg
          className={`topology-map ${playing ? 'is-playing' : ''}`}
          style={{
            width: `${zoom * 100}%`,
            minWidth: `${660 * zoom}px`,
            height: 'auto',
            maxHeight: 'none',
          }}
          viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
          role="img"
          aria-label="Fictional network topology. Select a device or link to inspect its configuration; equivalent keyboard buttons are below the diagram."
        >
          <defs>
            <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r=".8" fill="#ffffff" opacity=".10" />
            </pattern>
          </defs>
          <rect x={minX} y={minY} width={maxX - minX} height={maxY - minY} fill="url(#grid)" />
          {!customBounds ? (
            <>
              <rect x="35" y="68" width="330" height="423" rx="16" className="zone-box" />
              <rect
                x="404"
                y="68"
                width="328"
                height="423"
                rx="16"
                className="zone-box zone-transit"
              />
              <rect
                x="772"
                y="68"
                width="193"
                height="423"
                rx="16"
                className="zone-box zone-services"
              />
              <text x="54" y="45" className="zone-label">
                01 / ACCESS NETWORK
              </text>
              <text x="423" y="45" className="zone-label">
                02 / TRANSIT & POLICY
              </text>
              <text x="786" y="45" className="zone-label">
                03 / SERVICES
              </text>
            </>
          ) : null}
          {topology.links.map((link) => {
            const a = byId.get(link.a.nodeId),
              b = byId.get(link.b.nodeId);
            if (!a || !b) return null;
            const isActive = current?.linkId === link.id;
            const reverse = isActive && current.nodeId === link.b.nodeId;
            return (
              <g
                key={link.id}
                onClick={() => onSelectLink(link.id)}
                className={`network-link ${!link.enabled ? 'link-disabled' : ''} ${traversed.has(link.id) ? 'link-traversed' : ''} ${selectedLinkId === link.id ? 'link-selected' : ''} ${isActive ? 'link-active' : ''} ${reverse ? 'link-reverse' : ''}`}
              >
                <title>
                  {a.name} to {b.name}: select physical link
                </title>
                <path d={pathFor(a, b)} className="link-hit-target" />
                <path d={pathFor(a, b)} className="link-track" />
                {traversed.has(link.id) && link.enabled ? (
                  <path d={pathFor(a, b)} className="link-flow" />
                ) : null}
                <g
                  transform={`translate(${(a.position.x + b.position.x) / 2},${(a.position.y + b.position.y) / 2})`}
                >
                  <circle r="12" className="link-point" />
                  <text textAnchor="middle" y="4" className="link-symbol">
                    {link.enabled ? '↔' : '×'}
                  </text>
                </g>
              </g>
            );
          })}
          {topology.nodes.map((node) => {
            const selected = node.id === selectedId && !selectedLinkId;
            const focus = current?.nodeId === node.id;
            const failed = focus && current?.decision === 'fail';
            return (
              <g
                key={node.id}
                onClick={() => onSelectNode(node.id)}
                transform={`translate(${node.position.x},${node.position.y})`}
                className={`network-node ${selected ? 'node-selected' : ''} ${visited.has(node.id) ? 'node-visited' : ''} ${focus ? 'node-current' : ''} ${failed ? 'node-failed' : ''} ${node.status === 'down' ? 'node-offline' : ''}`}
              >
                <title>{node.name}: select device configuration</title>
                <rect x="-67" y="-52" width="134" height="104" rx="12" className="node-body" />
                <g transform="translate(0,-19)" className="node-glyph">
                  <DeviceGlyph kind={node.kind} />
                </g>
                <text textAnchor="middle" y="19" className="node-name">
                  {node.name}
                </text>
                <text textAnchor="middle" y="38" className="node-address">
                  {node.interfaces[0]?.cidr.split('/')[0] ?? 'No interface'}
                </text>
                <circle cx="53" cy="-38" r="4" className="node-led" />
                {focus ? (
                  <>
                    <circle cx="-53" cy="-38" r="6" className="packet-dot" />
                    <text x="0" y="-64" textAnchor="middle" className="packet-label">
                      {failed
                        ? 'STOPPED HERE'
                        : current?.phase === 'response'
                          ? 'RETURN PATH'
                          : 'PACKET HERE'}
                    </text>
                  </>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="canvas-key">
        <span>
          <i className="key-line" /> Physical link
        </span>
        <span>
          <i className="key-line key-traced" /> Traced path
        </span>
        <span>
          <i className="key-line key-down" /> Disabled
        </span>
        <span className="canvas-note">Fictional topology · Computed locally</span>
      </div>
      <div className="map-selection" aria-label="Inspect network devices">
        <span className="selection-label">INSPECT</span>
        {topology.nodes.map((node) => (
          <button
            key={node.id}
            className={selectedId === node.id && !selectedLinkId ? 'selected' : ''}
            onClick={() => onSelectNode(node.id)}
            aria-pressed={selectedId === node.id && !selectedLinkId}
          >
            {node.name}
            <span className={`device-dot ${node.status === 'down' ? 'is-down' : ''}`} />
          </button>
        ))}
      </div>
      <details className="link-selector">
        <summary>
          Inspect a physical link <span>{topology.links.length} connections</span>
        </summary>
        <div>
          {topology.links.map((link) => (
            <button
              key={link.id}
              className={selectedLinkId === link.id ? 'selected' : ''}
              onClick={() => onSelectLink(link.id)}
            >
              {byId.get(link.a.nodeId)?.name ?? link.a.nodeId} <span>↔</span>{' '}
              {byId.get(link.b.nodeId)?.name ?? link.b.nodeId}
              <small>{link.enabled ? `${link.latencyMs} ms modelled` : 'Link disabled'}</small>
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
