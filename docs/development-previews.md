# Tailscale development previews

Clicking a development link in a local conversation opens its site in the right panel through the Yard machine's Tailscale HTTPS address. The same resolution applies to the panel address bar and restored tabs. An unavailable service produces a visible error and a retry action; Yard does not start the application itself.

This uses the existing `AGENTS_PUBLIC_ORIGIN` and installed Tailscale CLI. The public origin must be HTTPS on this node's `*.ts.net` name. Tailscale must already be connected, HTTPS enabled, and the Yard service user allowed to run Serve. Missing permission is reported without changing Tailscale operators, ACLs, certificates, or public Funnel configuration. Local-only Yard installations retain direct browser navigation.

The implementation uses the [documented foreground Serve lifecycle](https://tailscale.com/docs/reference/tailscale-cli/serve). It does not use `--bg`.

## Request path

1. The browser bridge recognizes an HTTP(S) loopback development URL. Its conversation host comes from the existing link or browser-owner route. The existing self-contained `.html` transport retains its sandbox.
2. The existing authenticated-by-deployment Yard WebSocket calls the `development-preview` host endpoint with the URL and host. SSH conversation hosts are rejected for automatic local forwarding.
3. The preview manager validates an exact loopback host, a port from 1024 to 65535, and an HTTP(S) URL without credentials. It pins localhost to loopback and checks that the target is listening. This instance's own local URL resolves to `AGENTS_PUBLIC_ORIGIN`.
4. A loopback HTTP proxy listens on a free port. A foreground `tailscale serve --https=<proxy-port> http://127.0.0.1:<proxy-port>` lease makes that proxy available on the same node's Tailscale address. Each target origin has its own proxy/HTTPS port, so root-relative assets and API routes retain their paths.
5. Once Serve confirms its URL and remains alive, the manager returns the public URL with the original path, query and fragment. The iframe uses that temporary URL. Existing browser history, the address field and durable `restoreUrl` retain the original development URL, so refresh, idle expiry and Yard restart can create a fresh lease. Repeated opens reuse the running target lease.

All initial, address-bar, back/forward, refresh and restored navigations use `BrowserChrome` resolution. Unknown conversation owners wait for the existing owner route and never default to the local host. A changed owner, navigation or disposed page invalidates the pending page object, so obsolete asynchronous replies cannot replace the active page. Owner lookup waits at most five seconds and preview resolution at most twenty seconds, with a visible retry action.

Ordinary external websites retain direct client rendering. Ctrl/Cmd clicks and explicit external opens retain their existing destination. Automatic forwarding applies to local conversation hosts; it does not create SSH tunnels or infer a service location on another node.

## Proxy behavior and isolation

The proxy streams HTTP requests and responses, including POST bodies and event streams, and relays WebSocket upgrades. It rewrites Host and same-preview Origin/Referer headers to the target origin so development servers can validate their own origin. Root-relative links require no content rewriting. Redirects to the same target origin are rebased to the preview HTTPS origin. Cookie Domain attributes matching the loopback target are removed; other cookie attributes remain.

For these explicitly opened local previews, the response CSP retains its other directives and permits framing by `'self'` and the configured Yard parent. The proxy removes the conflicting X-Frame-Options header. The preview uses a different origin from Yard. Generic external websites keep their original embedding policies. Applications with absolute cross-port resource URLs must configure their public base URL; Yard does not rewrite JavaScript or HTML bodies.

Serve exposes previews only within the existing tailnet permissions. As with the existing Yard deployment, that network is the access boundary. Preview URLs have no additional login. Same-node ports share the browser's Cookie scope; separate origins isolate DOM and storage, not cookies. HTTPS upstreams retain normal certificate validation, including rejection of untrusted self-signed certificates.

The manager asks the OS for a free random mapping port and excludes existing Serve ports before creation. If another process claims a selected Serve port, it cleans up that attempt and chooses another random port, for at most three attempts within the same fifteen-second total deadline. Permission and connectivity errors do not trigger port retries. Exhausted retries report an error after cleanup. It never resets Serve, changes the application's port or changes the production listener. The `*.ts.net` restriction belongs to this automatic-preview path; Yard's existing support for other exact HTTPS origins remains intact.

## Ownership and cleanup

The Yard service owns the manager, proxy sockets and foreground Serve leases. Opening and teardown are serialized. Each creation has a fifteen-second total deadline across status, target check and Serve setup. Shutdown marks the manager closed and cancels creation before awaiting its queue; an in-progress creation cannot then publish success. Each running entry has one idempotent cleanup action. Failure callbacks remove an entry only while it is still the current entry for that source origin.

A failed open closes its proxy and lease before returning the error. A failed lease closes its HTTP server and every upstream/downstream socket; the next navigation can recreate it. A target service failure returns 502, with a retry link for document GETs, or closes a response already streaming. Retry is a new user navigation: Yard never replays a POST or WebSocket message automatically.

Closing a browser page preserves the application and preview lease. Only when no HTTP request, stream or WebSocket remains active and the last activity ended at least forty-five minutes ago does the manager release the lease. A quiet HMR WebSocket therefore stays connected; the idle clock begins when it closes. Later opens recreate expired leases. Stopping Yard releases its previews while leaving applications and the existing Serve configuration running.

A small IPC child runs the foreground CLI and watches its parent connection. A Yard crash disconnects IPC and terminates that CLI, allowing Tailscale to remove its foreground session. The IPC child and CLI share a dedicated process group, so a crashed IPC child also triggers cleanup of the remaining CLI. Shutdown uses a graceful signal followed by forced group termination within four seconds. No persistent forwarding journal or background Serve configuration is added. The service-host supervision uses POSIX process groups; Windows browsers can access a Linux/macOS Yard host, while Windows service hosts are currently rejected for automatic forwarding.

## Verification and rollback

Portable checks cover HTTP assets, bodies, redirects, WebSocket origin validation, framing headers, URL/host validation, concurrent reuse, permission/setup failures, idle cleanup and parent-crash cleanup. Lifecycle checks include creation cancelled by shutdown, silent setup deadline, quiet active WebSockets, IPC-child failure, stale navigation/owner results and source-address retention. Browser validation uses an isolated CLI conversation and a real temporary Tailscale HTTPS Yard entry, with Codex App unavailable. It clicks a real loopback link, exercises a script/CSS/API/WebSocket page, checks a framed Yard application's UI/API/WebSocket, and confirms existing Serve configuration survives cleanup. The actual validation report records the tested service host and browsers.

Reverting the feature restores direct client navigation. Stopping the updated Yard process removes its foreground previews. No ACL or production Serve-rule rollback is required.
