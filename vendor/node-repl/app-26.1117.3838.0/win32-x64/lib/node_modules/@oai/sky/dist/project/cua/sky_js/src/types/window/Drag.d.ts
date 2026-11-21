import type { AppIdentifier } from "./AppIdentifier";
export type Input = {
    /** App id, display name, process name, or other supported app identifier from `list_apps()`. */
    app: AppIdentifier;
    /** Starting X coordinate in the app-window screenshot. */
    from_x: number;
    /** Starting Y coordinate in the app-window screenshot. */
    from_y: number;
    /** Ending X coordinate in the app-window screenshot. */
    to_x: number;
    /** Ending Y coordinate in the app-window screenshot. */
    to_y: number;
};
export type Return = Promise<void>;
/** Drag from one app-window coordinate to another. */
export type Function = (input: Input) => Return;
