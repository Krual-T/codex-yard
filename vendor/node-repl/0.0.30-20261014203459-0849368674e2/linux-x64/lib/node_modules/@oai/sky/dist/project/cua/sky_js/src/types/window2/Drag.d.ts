import type { Window } from "./Window";
export type Input = {
    /** Window object from `list_apps()` or `list_windows()` to drag in. */
    window: Window;
    /** Starting window-relative X coordinate. */
    from_x: number;
    /** Starting window-relative Y coordinate. */
    from_y: number;
    /** Ending window-relative X coordinate. */
    to_x: number;
    /** Ending window-relative Y coordinate. */
    to_y: number;
    /** Optional screenshot id from `get_window_state()`; when supplied, it must be cached for the target window. */
    screenshotId?: string;
};
export type Return = Promise<void>;
/** Drag from one window coordinate to another. */
export type Function = (input: Input) => Return;
