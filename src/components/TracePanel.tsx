import type { TraceResult } from '../engine/types';
import { Icon } from './Icons';

export default function TracePanel({
  result,
  activeStep,
  playing,
  onPlay,
  onStep,
  onReset,
  onSelectStep,
}: {
  result: TraceResult;
  activeStep: number;
  playing: boolean;
  onPlay: () => void;
  onStep: () => void;
  onReset: () => void;
  onSelectStep: (index: number) => void;
}) {
  return (
    <section className="trace-panel" aria-labelledby="trace-title">
      <div className="trace-panel-header">
        <div>
          <span className="eyebrow">PACKET EVIDENCE</span>
          <h2 id="trace-title">The path, explained.</h2>
        </div>
        <div className="playback-controls">
          <button
            aria-label={playing ? 'Pause trace playback' : 'Play trace playback'}
            className="icon-only"
            onClick={onPlay}
            disabled={!result.steps.length}
          >
            <Icon name={playing ? 'pause' : 'play'} size={17} />
          </button>
          <button
            aria-label="Next trace step"
            className="icon-only"
            onClick={onStep}
            disabled={activeStep >= result.steps.length - 1}
          >
            <Icon name="step" size={17} />
          </button>
          <button
            aria-label="Rewind trace"
            className="icon-only"
            onClick={onReset}
            disabled={!result.steps.length}
          >
            <Icon name="reset" size={17} />
          </button>
          <span className="playback-counter mono">
            {activeStep + 1} / {result.steps.length}
          </span>
        </div>
      </div>
      <div className="trace-stage-labels">
        <span>
          <i className="request-key" /> Request path
        </span>
        <span>
          <i className="response-key" /> Response path
        </span>
        <span>TTL / Route / Rule evidence</span>
      </div>
      <ol className="trace-list" aria-label="Computed packet trace">
        {result.steps.map((step, index) => (
          <li
            key={step.id}
            className={`${activeStep === index ? 'step-active' : ''} ${index <= activeStep ? 'step-revealed' : ''} ${step.decision === 'fail' ? 'step-failed' : ''} phase-${step.phase}`}
          >
            <button
              className="trace-step"
              onClick={() => onSelectStep(index)}
              aria-current={activeStep === index ? 'step' : undefined}
            >
              <span className="trace-number mono">{String(index + 1).padStart(2, '0')}</span>
              <span className="trace-detail">
                <span className="trace-step-top">
                  <strong>{step.title}</strong>
                  <span className="trace-phase">{step.phase === 'request' ? 'OUT' : 'BACK'}</span>
                </span>
                <span className="trace-message">{step.detail}</span>
                <span className="trace-meta">
                  <span>{step.nodeName}</span>
                  <span>TTL {step.ttl}</span>
                  {step.routeId ? <code>{step.routeId}</code> : null}
                  {step.ruleId ? <code>{step.ruleId}</code> : null}
                  {step.linkId ? <code>{step.linkId}</code> : null}
                </span>
              </span>
              <span className={`step-decision decision-${step.decision}`}>
                <Icon
                  name={
                    step.decision === 'fail'
                      ? 'close'
                      : step.decision === 'pass'
                        ? 'check'
                        : 'arrow'
                  }
                  size={15}
                />
              </span>
            </button>
          </li>
        ))}
      </ol>
      {!result.steps.length ? (
        <div className="empty-trace">
          <Icon name="route" size={28} />
          <p>No packet trace is available for this request.</p>
          <span>{result.reason}</span>
        </div>
      ) : null}
      <div className="trace-footer">
        <span className="mono">MODEL V{result.modelVersion}</span>
        <span>
          {result.hopCount} traversals · {result.modelledLatencyMs} ms modelled transit
        </span>
        <span>Deterministic · No real packets sent</span>
      </div>
    </section>
  );
}
