/**
 * Opaque ID for an immutable clipboard snapshot stored in the Linux helper.
 * Each handle keeps one copied value separate from later clipboard changes.
 * The helper keeps rich formats such as images and SVG without sending their data through JavaScript.
 * A handle can be pasted more than once and into any window served by the same helper.
 * Release it when finished to free its storage. It becomes invalid when the helper exits.
 */
export type ClipboardHandle = string;
