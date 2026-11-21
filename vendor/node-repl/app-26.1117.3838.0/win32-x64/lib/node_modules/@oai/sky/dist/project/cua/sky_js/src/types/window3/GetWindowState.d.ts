import type * as Window2 from "../window2";
import type { Window } from "./Window";
export type AccessibilityState = Pick<Window2.AccessibilityState, "tree">;
export interface WindowState {
    window: Window;
    /** Images for this window and attached UI, with individual IDs and z-order. */
    screenshots: Array<Window2.Screenshot>;
    accessibility: AccessibilityState | null;
}
export type Input = {
    window: Window;
    /** Reset the diff baseline and restart paging for a fresh tree. */
    disable_diff?: boolean;
} & ({
    include_screenshot?: true;
    include_text?: boolean;
} | {
    include_text: true;
    include_screenshot?: boolean;
});
export type Return = Promise<WindowState>;
/** Read this window's state. A repeated text-only read can return the next cached page in a non-browser window. */
export type Function = (input: Input) => Return;
