import type { AppIdentifier } from "./AppIdentifier";
import type { AppState } from "./AppState";
export type Input = {
    /** App id, display name, process name, or other supported app identifier from `list_apps()`. */
    app: AppIdentifier;
    /** Return a full accessibility tree instead of a diff from the previous tree. */
    disableDiff?: boolean;
};
export type Return = Promise<AppState>;
/** Capture the current state, screenshot, and accessibility text for an app window. */
export type Function = (input: Input) => Return;
