import type { AppIdentifier } from "./AppIdentifier";
export type SelectionType = "text" | "cursor_before" | "cursor_after";
export type Input = {
    /** App id, display name, process name, or other supported app identifier from `list_apps()`. */
    app: AppIdentifier;
    /** Element index from the latest `get_app_state()` text. */
    element_index: number;
    /** Text to locate within the editable element. */
    text: string;
    /** Optional text immediately before the target text to disambiguate matches. */
    prefix?: string;
    /** Optional text immediately after the target text to disambiguate matches. */
    suffix?: string;
    /** Whether to select the text itself or place the cursor before or after it. */
    selection_type?: SelectionType;
};
export type Return = Promise<void>;
/** Select matching text in an indexed editable element. */
export type Function = (input: Input) => Return;
