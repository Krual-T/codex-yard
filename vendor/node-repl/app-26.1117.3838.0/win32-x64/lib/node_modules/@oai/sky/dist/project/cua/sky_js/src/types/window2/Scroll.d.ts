import type { Window } from "./Window";
export type Input = {
    /** Window object from `list_apps()` or `list_windows()` to scroll. */
    window: Window;
    /** Window-relative X coordinate to scroll from. */
    x: number;
    /** Window-relative Y coordinate to scroll from. */
    y: number;
    /** Optional screenshot id from `get_window_state()`; when supplied, it must be cached for the target window. */
    screenshotId?: string;
    /** Horizontal scroll delta; negative means left, positive means right. */
    scrollX: number;
    /** Vertical scroll delta; negative means up, positive means down. */
    scrollY: number;
};
export type Return = Promise<void>;
/** Scroll by a delta from a specific coordinate in the window. */
export type Function = (input: Input) => Return;
