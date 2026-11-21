import type { Window } from "./Window";
export type Input = {
    /** Window object from `list_apps()` or `list_windows()` containing the element. */
    window: Window;
    /** Element index from the latest `get_window_state()` accessibility tree. */
    element_index: number;
    /** Secondary action label from `get_window_state()`, such as `Raise`, `Scroll Up`, `Scroll Down`, `Scroll Left`, `Scroll Right`, `Expand`, or `Collapse`; matching is case-insensitive. */
    action: string;
};
export type Return = Promise<void>;
/** Invoke a secondary accessibility action on an indexed element. */
export type Function = (input: Input) => Return;
