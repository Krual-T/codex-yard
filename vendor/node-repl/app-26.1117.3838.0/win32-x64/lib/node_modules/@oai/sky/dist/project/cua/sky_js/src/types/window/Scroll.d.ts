import type { Direction } from "../Direction";
import type { AppIdentifier } from "./AppIdentifier";
export type Input = {
    /** App id, display name, process name, or other supported app identifier from `list_apps()`. */
    app: AppIdentifier;
    /** Direction to scroll. */
    direction: Direction;
    /** Number of pages to scroll. */
    pages?: number;
    /** Element index from the latest `get_app_state()` text. */
    element_index?: number;
    /** X coordinate in the app-window screenshot. */
    x?: number;
    /** Y coordinate in the app-window screenshot. */
    y?: number;
};
export type Return = Promise<void>;
/** Scroll at either an indexed element from the latest app state or a coordinate in the app window. */
export type Function = (input: Input) => Return;
