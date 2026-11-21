import type { AppIdentifier } from "./AppIdentifier";
export type Input = {
    /** App id, display name, process name, or other supported app identifier from `list_apps()`. */
    app: AppIdentifier;
    /** Element index from the latest `get_app_state()` text. */
    element_index: number;
    /** Accessibility action name to invoke on the element. */
    action: string;
};
export type Return = Promise<void>;
/** Invoke a secondary accessibility action on an indexed element. */
export type Function = (input: Input) => Return;
