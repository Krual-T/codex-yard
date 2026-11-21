import type { AppIdentifier } from "./AppIdentifier";
export type Input = {
    /** App id, display name, process name, or other supported app identifier from `list_apps()`. */
    app: AppIdentifier;
    /** Element index from the latest `get_app_state()` text. */
    element_index: number;
    /** Replacement value for the editable element. */
    value: string;
};
export type Return = Promise<void>;
/** Replace the value of an indexed editable element. */
export type Function = (input: Input) => Return;
