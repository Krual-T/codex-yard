import type { Window } from "./Window";
import type { WindowState } from "./WindowState";
export type Input = {
    /** Whether to capture accessibility text describing visible elements and indexes; defaults to false. */
    include_text?: boolean;
    /** Whether to capture and display a screenshot of the window; defaults to true. */
    include_screenshot?: boolean;
    /** Window object from `list_apps()` or `list_windows()` to capture. */
    window: Window;
};
export type Return = Promise<WindowState>;
/** Capture selected state for an open window. */
export type Function = (input: Input) => Return;
