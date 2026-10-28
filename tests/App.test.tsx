// @vitest-environment jsdom
/** End-to-end component interactions with the real engine. Author: Dhruba Poudel. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import App from '../src/App';
import { createTopology } from '../src/engine';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const resultRegion = () => screen.getByRole('region', { name: 'Trace result' });
const traceList = () => screen.getByRole('list', { name: 'Computed packet trace' });

function topologyFile(contents: string, name = 'topology.json'): File {
  const file = new File([contents], name, { type: 'application/json' });
  // jsdom does not implement Blob.text; real browser File.text remains the production path.
  Object.defineProperty(file, 'text', { value: async () => contents });
  return file;
}

describe('guided investigation using the actual forwarding engine', () => {
  it('starts with the deciding deny rule and proves a targeted repair in both directions', () => {
    render(<App />);
    expect(within(resultRegion()).getByText('Blocked')).toBeTruthy();
    expect(within(traceList()).getAllByText('fault-block-https').length).toBeGreaterThan(0);
    expect(within(resultRegion()).getByText(/priority 50/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Apply scenario repair' }));

    expect(within(resultRegion()).getByText('Round trip delivered')).toBeTruthy();
    expect(within(traceList()).getByText('Service received the request')).toBeTruthy();
    expect(within(traceList()).getByText('Response reached the client')).toBeTruthy();
    const comparison = screen.getByRole('region', {
      name: 'Before and after configuration evidence',
    });
    expect(within(comparison).getByText('Blocked')).toBeTruthy();
    expect(within(comparison).getByText('Round trip delivered')).toBeTruthy();
    expect(within(comparison).getByText(/Round trip verified/)).toBeTruthy();
  });

  it('distinguishes reaching the API from a missing response route', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Half a conversation/ }));
    expect(within(resultRegion()).getByText('Unreachable')).toBeTruthy();
    expect(within(resultRegion()).getByText(/response phase/)).toBeTruthy();
    expect(within(traceList()).getByText('Service received the request')).toBeTruthy();
    expect(within(traceList()).queryByText('Response reached the client')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Apply scenario repair' }));
    expect(within(traceList()).getByText('Response reached the client')).toBeTruthy();
    expect(within(resultRegion()).getByText('Round trip delivered')).toBeTruthy();
  });

  it('rejects an invalid staged interface edit and preserves the previous trace', () => {
    render(<App />);
    const inspector = screen.getByRole('complementary', {
      name: 'Device configuration inspector',
    });
    const cidr = within(inspector).getByLabelText(/Edge transit.*IPv4/);
    fireEvent.change(cidr, { target: { value: '999.0.0.1/24' } });
    fireEvent.click(within(inspector).getByRole('button', { name: 'Apply configuration' }));

    expect(within(inspector).getByRole('alert').textContent).toMatch(/not applied/);
    expect(within(resultRegion()).getByText('Blocked')).toBeTruthy();
    expect(
      screen.queryByRole('region', { name: 'Before and after configuration evidence' }),
    ).toBeNull();

    fireEvent.click(within(inspector).getByRole('button', { name: 'Discard changes' }));
    expect((within(inspector).getByLabelText(/Edge transit.*IPv4/) as HTMLInputElement).value).toBe(
      '172.16.0.2/30',
    );
    expect(within(inspector).queryByRole('alert')).toBeNull();
  });

  it('computes a link failure after an actual configuration edit', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /A clean round trip/ }));
    expect(within(resultRegion()).getByText('Round trip delivered')).toBeTruthy();
    fireEvent.click(screen.getByText(/Inspect a physical link/));
    fireEvent.click(screen.getByRole('button', { name: /^Policy gateway ↔ Core router/ }));

    const inspector = screen.getByRole('complementary', { name: 'Physical link configuration' });
    fireEvent.click(within(inspector).getByRole('checkbox', { name: 'Physical link enabled' }));
    fireEvent.click(within(inspector).getByRole('button', { name: 'Apply link configuration' }));
    expect(within(resultRegion()).getByText('Unreachable')).toBeTruthy();
    expect(within(resultRegion()).getByText(/link-firewall-core is disabled/)).toBeTruthy();
    expect(within(traceList()).queryByText('Service received the request')).toBeNull();
  });

  it('reset restores the scenario fault after a successful repair', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply scenario repair' }));
    expect(within(resultRegion()).getByText('Round trip delivered')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset this scenario' }));
    expect(within(resultRegion()).getByText('Blocked')).toBeTruthy();
    expect(
      screen.queryByRole('region', { name: 'Before and after configuration evidence' }),
    ).toBeNull();
  });

  it('recomputes a changed request rather than keeping the previous successful outcome', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply scenario repair' }));
    fireEvent.change(screen.getByLabelText('Destination port'), { target: { value: '80' } });
    expect(screen.getByText(/Request changed/)).toBeTruthy();
    expect(
      screen.queryByRole('region', { name: 'Before and after configuration evidence' }),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Run trace' }));
    expect(within(resultRegion()).getByText('Blocked')).toBeTruthy();
    expect(within(resultRegion()).getByText(/TCP\/80/)).toBeTruthy();
    expect(within(traceList()).queryByText('Response reached the client')).toBeNull();
  });

  it('playback reset and stepping expose the selected evidence step', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Rewind trace' }));
    expect(within(traceList()).queryByRole('button', { current: 'step' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next trace step' }));
    expect(within(traceList()).getByRole('button', { current: 'step' }).textContent).toMatch(
      /Request created/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next trace step' }));
    expect(within(traceList()).getByRole('button', { current: 'step' }).textContent).toMatch(
      /Selected 0\.0\.0\.0\/0/,
    );
  });
  it('bounds topology zoom and restores Fit without changing the diagnostic evidence', () => {
    render(<App />);
    const enlarge = screen.getByRole('button', { name: 'Zoom in topology' });
    const shrink = screen.getByRole('button', { name: 'Zoom out topology' });
    const fit = screen.getByRole('button', { name: 'Fit topology' });
    const evidence = traceList().textContent;
    expect((shrink as HTMLButtonElement).disabled).toBe(true);
    expect(fit.textContent).toBe('Fit');
    for (let step = 0; step < 4; step++) fireEvent.click(enlarge);
    expect(fit.textContent).toBe('200%');
    expect((enlarge as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(enlarge);
    expect(fit.textContent).toBe('200%');
    fireEvent.click(shrink);
    expect(fit.textContent).toBe('175%');
    fireEvent.click(fit);
    expect(fit.textContent).toBe('Fit');
    expect((shrink as HTMLButtonElement).disabled).toBe(true);
    expect(traceList().textContent).toBe(evidence);
    expect(within(resultRegion()).getByText('Blocked')).toBeTruthy();
  });
});

describe('local topology import', () => {
  it.each([
    { protocol: 'TCP', port: 80, ttl: 11 },
    { protocol: 'UDP', port: 53, ttl: 12 },
  ])(
    'preserves a saved $protocol/$port request and recomputes its outcome',
    async ({ protocol, port, ttl }) => {
      render(<App />);
      const model = createTopology('healthy');
      model.name = 'Saved request fixture';
      const savedRequest = { sourceId: 'ops', destinationId: 'api', protocol, port, ttl };
      const report = {
        format: 'RouteLab diagnostic report',
        topology: model,
        request: savedRequest,
        trace: {
          delivered: true,
          status: 'delivered',
          reason: 'A forged saved success',
          steps: [],
        },
      };
      fireEvent.change(screen.getByLabelText('Import topology JSON'), {
        target: { files: [topologyFile(JSON.stringify(report), 'saved-report.json')] },
      });
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Saved request fixture' })).toBeTruthy(),
      );
      expect((screen.getByLabelText('From') as HTMLSelectElement).value).toBe('ops');
      expect((screen.getByLabelText('To') as HTMLSelectElement).value).toBe('api');
      // Source selection opens a client inspector, so this label unambiguously identifies the request.
      expect((screen.getByLabelText('Protocol') as HTMLSelectElement).value).toBe(protocol);
      expect((screen.getByLabelText('Destination port') as HTMLInputElement).value).toBe(
        String(port),
      );
      expect((screen.getByLabelText('Initial packet TTL') as HTMLInputElement).value).toBe(
        String(ttl),
      );
      expect(within(resultRegion()).getByText('Blocked')).toBeTruthy();
      expect(within(resultRegion()).getByText(new RegExp(`${protocol}/${port}`))).toBeTruthy();
      expect(within(traceList()).getByText('Request created')).toBeTruthy();
      expect(
        within(traceList()).getByText(new RegExp('10\\.10\\.2\\.10 → 10\\.20\\.1\\.20')),
      ).toBeTruthy();
      expect(screen.queryByText('A forged saved success')).toBeNull();
      expect(screen.getByRole('status').textContent).toMatch(
        /recomputed locally; saved outcomes were not trusted/,
      );
    },
  );

  it.each([
    {
      label: 'an unknown source',
      request: {
        sourceId: 'absent-node',
        destinationId: 'api',
        protocol: 'TCP',
        port: 443,
        ttl: 8,
      },
    },
    {
      label: 'a fractional port',
      request: { sourceId: 'client', destinationId: 'api', protocol: 'TCP', port: 443.5, ttl: 8 },
    },
    { label: 'a null request', request: null },
  ])('rejects a saved report with $label without changing existing work', async ({ request }) => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Destination port'), { target: { value: '8443' } });
    const replacement = createTopology('healthy');
    replacement.name = 'Rejected replacement fixture';
    fireEvent.change(screen.getByLabelText('Import topology JSON'), {
      target: {
        files: [
          topologyFile(JSON.stringify({ topology: replacement, request }), 'invalid-report.json'),
        ],
      },
    });
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/imported request could not be used/),
    );
    expect(screen.getByRole('heading', { name: 'The rule that wins' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Rejected replacement fixture' })).toBeNull();
    expect((screen.getByLabelText('From') as HTMLSelectElement).value).toBe('client');
    expect((screen.getByLabelText('Destination port') as HTMLInputElement).value).toBe('8443');
    expect(screen.getByText(/Request changed/)).toBeTruthy();
    expect(within(resultRegion()).getByText('Blocked')).toBeTruthy();
    expect(within(resultRegion()).getByText(/priority 50/)).toBeTruthy();
  });

  it('imports a valid custom topology and computes its service result', async () => {
    render(<App />);
    const model = createTopology('healthy');
    model.name = 'Imported lab fixture';
    model.nodes.find((node) => node.id === 'api')!.services[0].enabled = false;
    fireEvent.change(screen.getByLabelText('Import topology JSON'), {
      target: { files: [topologyFile(JSON.stringify(model))] },
    });
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Imported lab fixture' })).toBeTruthy(),
    );
    expect(within(resultRegion()).getByText('Service closed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Apply scenario repair' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps valid imported devices inside the visible SVG coordinate bounds', async () => {
    render(<App />);
    const model = createTopology('healthy');
    model.name = 'Extended graph fixture';
    model.nodes.find((node) => node.id === 'api')!.position = { x: 2000, y: 2000 };
    model.nodes.find((node) => node.id === 'client')!.position = { x: 0, y: 0 };
    fireEvent.change(screen.getByLabelText('Import topology JSON'), {
      target: { files: [topologyFile(JSON.stringify(model))] },
    });
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Extended graph fixture' })).toBeTruthy(),
    );
    const diagram = screen.getByRole('img', { name: /^Fictional network topology/ });
    const [x, y, width, height] = diagram.getAttribute('viewBox')!.split(' ').map(Number);
    expect(x).toBeLessThan(0);
    expect(y).toBeLessThan(0);
    expect(x + width).toBeGreaterThan(2000);
    expect(y + height).toBeGreaterThan(2000);
    expect(within(resultRegion()).getByText('Round trip delivered')).toBeTruthy();
  });

  it('rejects malformed JSON without changing the previous configuration', async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Import topology JSON'), {
      target: { files: [topologyFile('{not valid json}')] },
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/valid JSON/));
    expect(within(resultRegion()).getByText('Blocked')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'The rule that wins' })).toBeTruthy();
  });

  it('rejects an oversized file before reading or parsing it', async () => {
    render(<App />);
    const file = new File(['x'.repeat(65537)], 'oversized.json', { type: 'application/json' });
    const read = vi.fn(async () => JSON.stringify(createTopology('healthy')));
    Object.defineProperty(file, 'text', { value: read });
    fireEvent.change(screen.getByLabelText('Import topology JSON'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/64 KiB/));
    expect(read).not.toHaveBeenCalled();
    expect(within(resultRegion()).getByText('Blocked')).toBeTruthy();
  });

  it('rejects structurally invalid JSON with an actionable model error', async () => {
    render(<App />);
    const model = createTopology('healthy');
    model.links[0].a.interfaceId = 'missing-interface';
    fireEvent.change(screen.getByLabelText('Import topology JSON'), {
      target: { files: [topologyFile(JSON.stringify(model))] },
    });
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/existing node interface/),
    );
    expect(within(resultRegion()).getByText('Blocked')).toBeTruthy();
  });

  it('exports the exact computed request and trace with authorship', async () => {
    let emitted: Blob | undefined;
    const revoke = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => {
        emitted = blob;
        return 'blob:fictional-test-report';
      }),
      revokeObjectURL: revoke,
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply scenario repair' }));
    // A pending request edit must not be confused with the already computed evidence.
    fireEvent.change(screen.getByLabelText('Destination port'), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export report' }));
    expect(emitted).toBeTruthy();
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(emitted!);
    });
    const report = JSON.parse(text);
    expect(report.author).toBe('Dhruba Poudel');
    expect(report.creator).toBe('Dhruba Poudel');
    expect(report.lastModifiedBy).toBe('Dhruba Poudel');
    expect(report.request.port).toBe(443);
    expect(report.trace.request).toEqual(report.request);
    expect(report.trace.delivered).toBe(true);
    expect(
      report.topology.nodes
        .find((node: { id: string }) => node.id === 'firewall')
        .firewall.find((rule: { id: string }) => rule.id === 'fault-block-https').enabled,
    ).toBe(false);
    expect(report.comparison).toBeNull();
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:fictional-test-report'), {
      timeout: 1500,
    });
  });
});
