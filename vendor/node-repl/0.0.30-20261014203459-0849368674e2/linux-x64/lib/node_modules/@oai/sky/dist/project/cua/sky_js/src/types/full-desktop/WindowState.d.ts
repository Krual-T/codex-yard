import type { Screenshot } from "./Screenshot";
import type { Window } from "./Window";
/** One accessible application element or an X11 fallback window node. */
export type AccessibilityNode = {
    /** Compact decimal ID accepted by element actions with this window and client. Stable while the native element remains in successive reads. X11 fallback nodes are observation-only. */
    id: string;
    /** Original native identity, retained for inspecting the captured data. Native AT-SPI IDs are also accepted by element actions. */
    native_id?: string;
    /** Accessible role, such as window, button, text, or menu item. */
    role: string;
    /** User-visible accessible name when one is available. */
    name?: string;
    /** Additional accessible description when one is available. */
    description?: string;
    /** Current accessible value when one is available. */
    value?: string;
    /** Current interaction states. Omitted when unavailable, including on the X11 fallback. */
    states?: Array<AccessibilityState>;
    /** Supported action names accepted by `perform_secondary_action`. */
    actions?: Array<string>;
    /** Nested accessible elements. */
    children: Array<AccessibilityNode>;
    /** Condensed tree text, also displayed by `console.log(node)`. JSON serialization retains all data fields. */
    to_string(): string;
};
/** AT-SPI states useful for choosing controls and checking interaction results. */
export type AccessibilityState = "checked" | "defunct" | "editable" | "enabled" | "expanded" | "focusable" | "focused" | "selected" | "sensitive" | "showing" | "visible" | "indeterminate" | "checkable";
/** Bounded observation of an open X11 window. */
export type WindowState = {
    /** Current metadata for the observed window. */
    window: Window;
    /** Structured accessibility tree with stable element identifiers. Log it directly for condensed text; use JSON.stringify for all data fields. */
    ax_tree: AccessibilityNode;
    /** Whether the tree came from AT-SPI or the dependency-free X11 fallback. */
    ax_tree_source: "at_spi" | "x11";
    /** Window-only screenshots when screenshot capture was requested. */
    screenshots: Array<Screenshot>;
};
