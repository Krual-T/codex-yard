import type { MouseButton } from "../MouseButton";
import type { Window } from "./Window";
export type Input = {
    /** Window object from `list_apps()` or `list_windows()` to click in. */
    window: Window;
    /** Element index from the latest `get_window_state()` accessibility tree. */
    element_index?: number;
    /** Window-relative X coordinate. */
    x?: number;
    /** Window-relative Y coordinate. */
    y?: number;
    /** Optional screenshot id from `get_window_state()`; when supplied, it must be cached for the target window. */
    screenshotId?: string;
    /** Mouse button to click. */
    mouse_button?: MouseButton;
    /** Number of clicks to perform. */
    click_count?: number;
};
export type Return = Promise<void>;
/** Click either an indexed element from the latest window state or a coordinate in the window. */
export type Function = (input: Input) => Return;
