import type { AppIdentifier } from "./AppIdentifier";
export type Input = {
    /** App id, display name, process name, or other supported app identifier from `list_apps()`. */
    app: AppIdentifier;
    /** Text to type into the current focus. */
    text: string;
};
export type Return = Promise<void>;
/** Type text into the current focus in an app window. */
export type Function = (input: Input) => Return;
