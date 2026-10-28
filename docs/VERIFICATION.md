# RouteLab release verification

Author, creator and maintainer: **Dhruba Poudel**.

**Status: automated verification passed; final publication and browser evidence record pending.**

Automated results below were observed from the completed run. Final source revision, public deployment and browser acceptance remain separate evidence to be recorded by the release owner.

## Release identity

| Item                        | Actual evidence                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| Source revision             | Pending release verification                                                                    |
| Public repository           | Intended: `https://github.com/dhrubasuz/route-lab` — creation not yet confirmed in this record  |
| Live URL                    | Intended: `https://about.dhrub.com.np/route-lab/` — deployment not yet confirmed in this record |
| Verification date           | Automated run: 28 October 2026, 3:33 pm Australia/Sydney; final release checks pending          |
| Automated check output / CI | Local `pnpm test` and `pnpm typecheck` passed; hosted CI pending                                |

## Automated acceptance

- IPv4/CIDR parsing and membership boundaries.
- Connected/static longest-prefix selection and deterministic route ties.
- Next-hop/link resolution and endpoint transit restrictions.
- Firewall priority, first-match decisions, implicit deny and response traffic.
- Source/destination availability, service matching and TTL exhaustion.
- Every supplied fault and its targeted repair.
- Input immutability, isolated scenario creation and JSON portability.
- Bounded malformed input and stable results under non-semantic reordering.
- TypeScript checks, production build, formatting and dependency audit.

### Observed automated results

| Command          | Observed result                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm test`      | **151 tests passed across three files:** 132 engine/model-contract tests and 19 UI integration tests. |
| `pnpm typecheck` | Passed (`tsc --noEmit`, successful exit).                                                             |

The 19 UI tests run in jsdom with the actual forwarding engine. They cover a denied request and targeted repair, separate response-path failure, invalid staged edits, physical-link changes, reset, changed requests, trace stepping, zoom bounds and Fit reset, local imports, imported graph bounds and exact exported report evidence. Saved TCP/80 and UDP/53 requests retain their selected source, protocol, port and TTL on import; the engine recomputes their outcome instead of trusting a saved trace. Unknown source IDs, fractional ports and null saved requests are rejected without changing existing configuration or pending request edits. These checks do not replace real browser layout, download or accessibility checks.

The release owner must record the final production build, formatting, dependency audit, hosted CI and exact source revision after those checks complete. No test-count target or independent quality score is claimed.

## Browser and live acceptance

| Check                                                                       | Result  |
| --------------------------------------------------------------------------- | ------- |
| Default fault is visible and trace reasons agree with configuration         | Pending |
| All eight scenarios exercised through the actual interface                  | Pending |
| Each faulty scenario repaired and the same request replayed                 | Pending |
| Manual route/firewall/interface edit changes a computed result              | Pending |
| Invalid edit rejected without silently replacing the previous configuration | Pending |
| Request and response phases are inspectable                                 | Pending |
| Playback, stepping, pause and reset remain usable                           | Pending |
| Exported report inspected for exact configuration, trace and attribution    | Pending |
| Valid topology imported; malformed/oversized input rejected                 | Pending |
| Desktop and narrow layout / map scroll / no page overflow                   | Pending |
| Keyboard controls, visible focus and reduced-motion behaviour               | Pending |
| Public demo and repository links resolve to the intended project            | Pending |
| Hosted build assets load without application errors                         | Pending |

## Evidence rules

Use fictional configurations only. Do not publish credentials, real network inventories, employer information or browser session data. Screenshots and reports identify Dhruba Poudel as author where supported.

A passing test suite supports its assertions. It does not establish production suitability, complete RFC/vendor conformance, a security certification or a financial value. Synthetic transit latency is a model result, not a measured network benchmark.
