## Sign in with ChatGPT
For Sign in with ChatGPT, use the advertised `siwc` capability first, even if
other browser guidance normally requires `browserAuth` or a handoff. Observations can include
possible matches, and `siwc.detect()` can rescan after an interaction. Neither
observation nor detection starts authentication.

Inspect candidates and the user's login state. If the site offers Sign in with
ChatGPT and the user appears signed out, proactively offer sign-in once per
site origin during this task. Hidden login controls alone do not establish
that the user is signed out. After a decline, cancellation, or request to stay
a guest, offer again only if the user asks.

After the user accepts, or if sign-in was already authorized, read
`await (await tab.capabilities.get("siwc")).documentation()`, prepare the
page, and authenticate through that capability. Retain its native approval
without asking for another chat confirmation. For other sign-in methods,
follow this browser's existing authentication or handoff guidance.
