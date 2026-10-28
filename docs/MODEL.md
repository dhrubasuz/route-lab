# RouteLab simulation model

Author and maintainer: **Dhruba Poudel**.

## Purpose and boundary

RouteLab explains a small, explicit model of IPv4 forwarding. The interface changes a structured topology and passes that topology, together with a request, to a pure deterministic engine. The engine returns a finite trace with a reason for each relevant decision.

The engine sends no packets and makes no network configuration changes. A node named “API” is a fictional service in the model; it is not a request to an API on the internet.

## Addresses and links

An interface contains an IPv4 host address and prefix in CIDR notation. The model distinguishes the configured host address from the corresponding network prefix. Its parser rejects malformed addresses rather than asking a browser URL parser to reinterpret them.

A link joins two explicitly named node/interface endpoints. Forwarding requires an enabled physical link and a next hop that can be resolved on that connection. A route to an address is not sufficient if its next hop is off-link or the connection is down.

Structurally valid configuration can be operationally broken. In particular, the wrong-subnet scenario must remain importable and editable so that the trace can explain its failure. Validation protects the model's structure and bounds; it does not require every request to succeed.

## Forwarding

Connected networks and enabled static routes participate in route selection. The most specific matching destination prefix wins. Equal-prefix alternatives use the model's documented metric and identifier ordering to produce a repeatable choice. This explicit tie rule belongs to RouteLab; it does not claim to reproduce every operating system or routing protocol's preference rules.

The chosen next hop must resolve to a linked neighbour. The engine does not use an unrestricted shortest-path search to bypass a missing or incorrect forwarding-table entry. Clients and services are endpoints, rather than transit routers.

The packet's TTL is reduced at forwarding routers and firewalls. Exhaustion terminates the trace, including when a route sends traffic back into an earlier part of the topology. The application bounds request TTL so a loop cannot create an unbounded trace.

## Firewall decisions

A firewall considers enabled rules in ascending priority order, with a stable identifier tie-break. Rules match source CIDR, destination CIDR, protocol and destination port. The first matching rule allows or denies the packet. If no rule matches, the model denies it.

This firewall is **stateless**. The response therefore needs its own permitted path and matching rule. A forward allow does not establish a state table or automatically authorise the response. Azure network security groups are stateful; RouteLab borrows familiar rule fields for teaching, not their complete semantics.

## Request, service and response

A request chooses source and destination nodes, TCP or UDP, destination port and initial TTL. The default request uses the nodes' primary interfaces, TCP port 443 and TTL 8.

Reaching the destination is one condition of success. The requested destination service must be enabled, and a response must return to the initiating address. The response uses destination port **49152**, a fixed fictional client port in this model. It is not a simulation of real ephemeral-port allocation, a TCP handshake or a TLS exchange.

A missing return route can therefore produce a failed overall result after the forward trace reaches a valid service. Request and response phases remain explicit in the evidence.

## Evidence and modelled latency

A result includes its request, status, fault code, reasons, forward and response paths, hop count and steps. Steps identify applicable routes, firewall rules and links where relevant. Values follow from the supplied topology, so a manual configuration change can alter an outcome independently of the scenario title.

Link latency is configured **simulation input**. Its accumulated result is modelled transit latency. It is not measured round-trip time, application response time, a hardware benchmark or evidence of a customer's network performance.

The default scenarios and repair helpers are immutable: the caller's original topology remains available for comparison. A repair reverses its selected scenario fault; unrelated edits can still cause the rerun to fail.

## Import and resource bounds

The public input is a versioned JSON topology. The engine validates its shape, identifiers, numeric values, addresses, links and collection limits. Invalid input should result in structured validation errors or an invalid trace, rather than a fabricated network success. The UI also enforces a bounded file size before parsing.

The first release targets at most 32 nodes and 64 links, bounded route/rule collections and a finite request TTL. Refer to the implementation and tests for the exact enforced limits in a released revision; the verification record must identify that revision.

## Deliberate omissions

The model does not implement Ethernet frames, MAC learning, ARP, DHCP, DNS, NAT, IPv6, BGP/OSPF, TCP sequencing, retransmission timers, TLS, congestion, cloud identity permissions or real equipment discovery. It does not emulate a named cloud provider's complete forwarding or security platform.

## Primary references

- [RFC 1812 — Requirements for IP Version 4 Routers](https://www.rfc-editor.org/rfc/rfc1812): IPv4 forwarding and TTL principles. RouteLab implements the stated subset, not RFC conformance.
- [RFC 4632 — Classless Inter-domain Routing](https://www.rfc-editor.org/rfc/rfc4632): CIDR and prefix-based routing concepts.
- [Microsoft Learn — How network security groups filter network traffic](https://learn.microsoft.com/en-us/azure/virtual-network/network-security-group-how-it-works): rule fields and the importance of understanding where traffic is evaluated. RouteLab's stateless rule model remains distinct from Azure's stateful service.
- [Microsoft Learn — Azure network security groups overview](https://learn.microsoft.com/en-us/azure/virtual-network/network-security-groups-overview): priority evaluation and stateful flow records, which RouteLab deliberately does not implement.
