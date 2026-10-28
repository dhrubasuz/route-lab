# RouteLab security and data boundary

Author and maintainer: Dhruba Poudel.

RouteLab is an educational browser-local network model. It does not open network connections to the IP addresses shown, scan hosts, execute commands, change firewalls or connect to cloud accounts. The bundled topology is fictional.

The hosted application loads its own static HTML, JavaScript, stylesheet and artwork. Importing a JSON topology reads the selected local file into browser memory; it does not upload the file. Export creates a local JSON download. Avoid putting real organisational topology or personal information into a public demonstration or sharing exported files without reviewing them.

Topology import and trace execution have documented structural and size limits. Valid syntax can intentionally describe a broken network; diagnostic results are computed from that model. Rules are not equivalent to a complete vendor firewall or cloud policy implementation.

The public demo has no application accounts, server-side topology database, remote test endpoint or third-party analytics. Browser extensions, hosting request logs and the device remain outside the application's trust boundary. Any later persistence or integrations require an explicit update to this document.

Report a reproducible issue privately through the contact link on the maintainer's portfolio: https://about.dhrub.com.np/. Do not put sensitive topology files in a public issue.
