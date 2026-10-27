# Deployment boundaries

This is a personal development workspace with access to the connected user's files, terminals, and Codex sessions. Run it as a user whose resources you intend to expose to the workspace.

The HTTP server binds to loopback and validates Host, Origin, and WebSocket requests. Those checks protect request boundaries; they do not provide user authentication. Remote access requires a private network or an authenticated HTTPS reverse proxy. Set `AGENTS_PUBLIC_ORIGIN` to that exact origin. Do not put an unauthenticated public proxy in front of the server.

Keep `.local/`, `.env`, Codex state, SSH identities, browser pairing tokens, runtime logs, screenshots containing real conversations, and imported app resources outside version control. Data directories and tool sockets are private to the running user.

Chrome pairing grants access to the selected browser session. Pair only a browser you intend to use with the workspace, approve its native debugging prompt, and disconnect the companion when finished.

Use GitHub private vulnerability reporting for sensitive reports when it is enabled on the repository. Public issues should contain reproducible steps with synthetic data, without credentials or private conversation content.
