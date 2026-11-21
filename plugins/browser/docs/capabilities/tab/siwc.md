# Tab Capability: siwc
## Sign in with ChatGPT
Read this guidance before authenticating. Detection and normal observations do
not require a documentation read and never prompt for approval.

`siwc.detect()` returns possible matches, not proof of sign-in. Inspect the
purpose of each control and the current login state. For example, "Learn about
ChatGPT" and a hidden login button on an already signed-in page do not justify
an offer. If the site offers Sign in with ChatGPT and the user appears signed
out, proactively offer it once per site origin during this task. After a
decline, cancellation, or request to remain a guest, offer again only if the
user asks.

After acceptance or an existing sign-in request, prepare the page and call
`siwc.authenticate()`. Its native approval is the confirmation; do not ask
again in chat. With multiple matches, inspect the candidates, then use
`siwc.authenticate({ target: candidate.target })` for the intended control.
Marker evidence and list order give no candidate priority. Hidden controls
count too: open the relevant UI before authenticating. Refresh the observation
or detection after navigation, replacement, or a stale target. Never force
clicks or change CSS to reveal a control.

`no_deterministic_matches` does not prove SIWC is absent. Inspect AX, DOM, or
a screenshot. A manually recognized button or link may be addressed with the
observation's snapshot ID and its AX index or DOM ref. Use the browser's
documented handoff if there is no supported target.

Credentials and grants are private to the browser. Never inspect, log, copy,
or paste them into a website or chat. If this capability is unavailable, follow
the browser's documented fallback for sign-in.

## API Reference
```ts
const capability = await tab.capabilities.get("siwc");

interface SiwcTabCapability {
  authenticate(options: { target?: { elementIndex: number; kind: "ax"; snapshotId: string } | { kind: "dom"; ref: string; snapshotId: string } }): Promise<{ status: "page_changed" | "initiated" | "unsupported" | "no_actionable_button" | "target_unavailable" | "account_unavailable" | "account_changed" | "approval_declined" | "approval_cancelled" | "approval_failed" | "grant_failed" | "cookie_failed" | "click_failed" } | { candidates: [{ evidence: "siwc_marker_detected" | "chatgpt_button_detected"; label?: string; target: { elementIndex: number; kind: "ax"; snapshotId: string } | { kind: "dom"; ref: string; snapshotId: string }; visibility: "rendered" | "hidden" }, { evidence: "siwc_marker_detected" | "chatgpt_button_detected"; label?: string; target: { elementIndex: number; kind: "ax"; snapshotId: string } | { kind: "dom"; ref: string; snapshotId: string }; visibility: "rendered" | "hidden" }, unknown]; status: "multiple_actionable_buttons" }>; // Read documentation first. Uses native approval and clicks the selected control once.
  detect(): Promise<{ candidates: [{ evidence: "siwc_marker_detected" | "chatgpt_button_detected"; label?: string; target: { elementIndex: number; kind: "ax"; snapshotId: string } | { kind: "dom"; ref: string; snapshotId: string }; visibility: "rendered" | "hidden" }, unknown]; status: "possible_matches" } | { candidates: []; status: "no_deterministic_matches" } | { reason: "page_changed" | "observation_unavailable"; status: "unavailable" }>; // Detect candidate controls without requesting approval or signing in.
}
```
