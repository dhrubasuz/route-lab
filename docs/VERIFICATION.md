# RouteLab release verification

Author, creator and maintainer: **Dhruba Poudel**.

**Live HTTPS release verified on 28 October 2026.** The application uses fictional devices and deterministic browser-local simulation. The results below establish the checked workflows and their recorded inputs.

## Release identity

| Item                    | Verified value                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Live demo               | [about.dhrub.com.np/route-lab](https://about.dhrub.com.np/route-lab/)                                                                |
| Public repository       | [dhrubasuz/route-lab](https://github.com/dhrubasuz/route-lab)                                                                        |
| Deployed runtime source | [`2e8e931dc2e55707596e4bbc8bbc2abdb53e109a`](https://github.com/dhrubasuz/route-lab/commit/2e8e931dc2e55707596e4bbc8bbc2abdb53e109a) |
| Runtime CI              | [Successful verification run](https://github.com/dhrubasuz/route-lab/actions/runs/40633362199)                                       |
| Verification date       | 28 October 2026, Australia/Sydney                                                                                                    |

The linked commit identifies the tested, deployed application. This document, the retained evidence and the evidence-recomputation check are later documentation/verification additions; their commit is distinct from the deployed runtime revision.

## Automated verification

| Check                              | Observed result                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm test`                        | **151 passed across three files:** 132 engine/model-contract tests and 19 UI integration tests. |
| `pnpm typecheck`                   | Passed (`tsc --noEmit`). The production build also performs TypeScript checks.                  |
| `pnpm format:check`                | Passed in the linked runtime CI.                                                                |
| `pnpm build`                       | Passed in the linked runtime CI.                                                                |
| `pnpm audit --prod`                | Passed in the linked runtime CI.                                                                |
| `node scripts/verify-evidence.mjs` | Recomputed all eight retained hosted reports; request, response and repair evidence matched.    |

The engine/model-contract tests cover strict IPv4/CIDR parsing, longest-prefix selection, deterministic ties, next-hop adjacency, stateless firewall decisions, source/service/link availability, TTL bounds, endpoint transit restrictions, fault repairs, immutable inputs, JSON portability and bounded malformed input.

The 19 UI tests use jsdom with the real forwarding engine. They cover denied requests and targeted repairs, return-path failure, invalid staged edits, link changes, scenario reset, changed requests, trace stepping, zoom bounds and Fit reset, local imports, imported graph bounds and exact exported report evidence. Saved TCP/80 and UDP/53 requests retain source, protocol, port and TTL; their outcomes are recomputed. Unknown source IDs, fractional ports and null saved requests are rejected without replacing current work.

## Eight live scenarios

Each report below was downloaded from the actual HTTPS interface. The healthy baseline was delivered directly. Each of the seven fault cases was first observed failing, then repaired through the interface and replayed to delivery.

| Scenario and downloadable report                   | Before repair        | Verified result                                              |
| -------------------------------------------------- | -------------------- | ------------------------------------------------------------ |
| [Healthy network](evidence/healthy.json)           | `delivered` baseline | Request and response delivered.                              |
| [Blocked HTTPS](evidence/blocked-https.json)       | `blocked`            | Targeted firewall repair; request and response delivered.    |
| [Missing route](evidence/missing-route.json)       | `unreachable`        | Edge route restored; request and response delivered.         |
| [Wrong subnet](evidence/wrong-subnet.json)         | `unreachable`        | Transit interface corrected; request and response delivered. |
| [Link down](evidence/link-down.json)               | `unreachable`        | Transit link restored; request and response delivered.       |
| [Routing loop](evidence/route-loop.json)           | `ttl_exceeded`       | Firewall next hop corrected; request and response delivered. |
| [Missing return route](evidence/return-route.json) | `unreachable`        | Response route restored; request and response delivered.     |
| [Service unavailable](evidence/service-down.json)  | `service_closed`     | API listener enabled; request and response delivered.        |

All eight final reports contain eight link traversals and 12 ms of **configured, modelled transit latency** for the same default request. Those values describe this fictional fixture. They are not packet timings, measured network performance or throughput benchmarks.

### Recompute the evidence

After installing the pinned dependencies, run:

```sh
node scripts/verify-evidence.mjs
```

The script validates each saved topology and recomputes its trace from the saved topology and request. It compares the complete exported trace with the computed result, checks delivery and authorship, and verifies each retained before/after comparison against the baseline and repaired configurations. It does not accept the saved success field as proof by itself.

The reports identify **Dhruba Poudel** as author, creator and last modifier. Their data is fictional; no private network configuration or credentials are included.

## Browser observations

| Workflow                               | Recorded observation                                                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guided scenarios on HTTPS              | Healthy baseline plus all seven failures exercised; all seven targeted repairs delivered.                                                                 |
| Manual rule edit, local browser        | Changing the accidental deny's port from 443 to 80 changed the computed outcome from Blocked to Delivered; the comparison showed the actual field change. |
| Report download and reimport           | An actual diagnostic report downloaded and imported successfully.                                                                                         |
| Saved-request integrity, local browser | A report's operations-source request, port 80 and TTL 11 were preserved and recomputed as blocked, despite a forged saved success outcome.                |
| Public narrow layout                   | At a 320 px viewport, client and page scroll widths were both 305 px; at 390 px, both were 375 px. No document-level horizontal overflow was observed.    |
| Public zoom containment                | At 125% zoom, a 327 px map viewport contained an 825 px scrollable map while the document remained 375 px wide.                                           |
| Public mobile repair                   | Apply scenario repair produced Round trip delivered, eight traversals and 12 ms modelled transit.                                                         |
| Keyboard dialog, local browser         | Escape closed the model dialog and returned focus to its trigger.                                                                                         |

Invalid-edit and malformed/oversized-file handling are covered by the automated UI tests. Playback controls, native focus styling and reduced-motion styling are implemented, but this record does not claim a complete manual accessibility review or a separate browser verification of every motion setting. Browser console-log review and any additional hosted checks can be added to this record when completed.

## Scope of the evidence

RouteLab is a pure-browser educational model. It sends no real packets, scans no hosts and changes no cloud or network equipment. The supported IPv4 routing, stateless rules and response-path model are described in [MODEL.md](MODEL.md).

A passing suite supports its tested assertions. This record does not establish complete RFC/vendor conformance, production network-assessment suitability, a security certification, a full accessibility audit or a financial valuation.
