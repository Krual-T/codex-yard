import type { MouseButton } from "../MouseButton";
import type { Window } from "./Window";
export type Input = {
    /** Linux target window, which requires coordinates or an element and is not implicitly activated. Coordinates are window-relative. Omit for desktop input. */
    window?: Window;
    /** Element ID from `get_window_state().ax_tree`. Use instead of x/y for a primary activation or right-click. */
    element_id?: string;
    /** X coordinate on the desktop or within the target window; supply both x and y, or omit both to click at the current desktop pointer. */
    x?: number;
    /** Y coordinate on the desktop or within the target window; supply both x and y, or omit both to click at the current desktop pointer. */
    y?: number;
    /** Mouse button to click, including "right" to open an element's context menu. */
    mouse_button?: MouseButton;
    /** Number of clicks to perform. */
    click_count?: number;
    /** Optional key chord to hold during the click, using the same format as `press_key()`. */
    key?: string;
    /** Milliseconds to hold the mouse button down for each click. */
    duration?: number;
};
export type Return = Promise<void>;
/** Click an AX element, coordinates, or the current desktop pointer with no motion. Element targets support one left or right click without key or duration options. */
export type Function = (input: Input) => Return;
