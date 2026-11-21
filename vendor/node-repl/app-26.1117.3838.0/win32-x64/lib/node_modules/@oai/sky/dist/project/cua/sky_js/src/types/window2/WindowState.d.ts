import type { Screenshot } from "./Screenshot";
import type { Window } from "./Window";
export type AccessibilityState = {
    /** Existing formatted accessibility tree text, including element indexes and tab hierarchy. */
    tree: string;
    /** Formatted line for the focused element when available. */
    focused_element?: string;
    /** Text selected in the window when available. */
    selected_text?: string;
    /** Formatted lines for selected elements when available. */
    selected_elements?: Array<string>;
    /** Document text for the focused or most relevant document element when available. */
    document_text?: string;
};
export type WindowState = {
    /** Window captured by the state request. */
    window: Window;
    /** Bounded screenshots captured for the window and related transient UI. */
    screenshots: Array<Screenshot>;
    /** Structured accessibility state when requested. */
    accessibility: AccessibilityState | null;
};
