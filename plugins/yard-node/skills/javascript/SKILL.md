---
name: javascript
description: Run JavaScript with persistent variables, top-level await, Node packages and image results through Yard's standalone yard_node MCP. Use for iterative JavaScript execution; browser and desktop operations use their dedicated MCP tools.
---

# Standalone JavaScript

Use `yard_node.evaluate` for a persistent Node.js REPL. Top-level variables survive between calls in the same MCP session. Load built-ins and packages with `await yardNode.import('node:fs/promises')` or `await yardNode.import('package-name')`; modules resolve from the current `process.cwd()`. Use `process.chdir()` to select a task directory. The evaluator uses Node's in-process Inspector session in REPL mode; it opens no debug port. Native `import()` has no module loader in this context, so use the helper. This is the execution host's ordinary Node process with the configured MCP permissions; code can read/write files and access the network.

`console.log` and the last expression appear as text. `yardNode.cwd` reports the current `process.cwd()`. `yardNode.emitImage({ bytes, mimeType: 'image/png' })` emits PNG/JPEG bytes as an MCP image. Images are limited to 8 MiB total per call; text output is capped at 64 KiB. Do not base64-print images.

Evaluations run serially. Use `yard_node.reset` to discard variables; REPL mode also permits redeclaring top-level bindings. Reset, cancellation of a running evaluation, timeout, process exit or output overflow discards the current kernel and queued calls in that generation. Cancelling a queued evaluation only cancels that call before its code starts. The old process exits before a new kernel starts. Ordinary JavaScript errors preserve variables. Previously written files, requests, or separately spawned processes remain; inspect their results before repeating code. Background logs after a call completes are omitted. Stop background work explicitly when finished.

The runtime is owned by the Codex backend's MCP session. Closing the Yard page preserves it while that session stays loaded. A daemon restart or unloading the session starts a fresh kernel.

This plugin supplies JavaScript execution. Use the configured Chrome DevTools MCP for browser pages and `yard_computer` for desktop input. App-specific `nodeRepl.rpc`, BrowserLib and private App services are separate APIs and are not provided here.
