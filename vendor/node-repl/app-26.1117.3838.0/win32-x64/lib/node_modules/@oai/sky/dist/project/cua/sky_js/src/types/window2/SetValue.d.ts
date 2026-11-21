import type { Window } from "./Window";
export type Input = {
    /** Window object from `list_apps()` or `list_windows()` containing the editable element. */
    window: Window;
    /** Element index from the latest `get_window_state()` accessibility tree. */
    element_index: number;
    /** Replacement value for the editable element. */
    value: string;
};
export type Return = Promise<void>;
/** Replace the value of an indexed editable element. */
export type Function = (input: Input) => Return;
