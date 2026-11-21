import type { Window } from "./Window";
import type { WindowState } from "./WindowState";
export type Input = {
    /** Open window returned by `list_windows()` or `list_apps()`. */
    window: Window;
    /** Case-insensitive accessibility-tree query that retains matching ancestors. */
    query?: string;
    /** Whether to include a screenshot bounded to the window; defaults to true. */
    include_screenshot?: boolean;
};
export type Return = Promise<WindowState>;
/** Read a window's structured accessibility tree and optional screenshot. Log `state.ax_tree` directly for condensed text. */
export type Function = (input: Input) => Return;
