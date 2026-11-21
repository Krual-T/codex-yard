import type { Direction } from "../Direction";
import type { Window } from "./Window";
export type Input = {
    /** Linux target window, without implicit activation. Coordinates are window-relative. Omit for desktop input. */
    window?: Window;
    /** Element ID from `get_window_state().ax_tree` to scroll over. Requires window; use instead of x/y. */
    element_id?: string;
    /** Direction to scroll. */
    direction: Direction;
    /** Distance to scroll in pixels. */
    pixels?: number;
    /** Optional X coordinate for the scroll origin. */
    x?: number;
    /** Optional Y coordinate for the scroll origin. */
    y?: number;
    /** Optional key chord to hold during the scroll, using the same format as `press_key()`. */
    key?: string;
};
export type Return = Promise<void>;
/** Scroll over an AX element, window-relative coordinates, or the current desktop target. */
export type Function = (input: Input) => Return;
