import type { Window } from "./Window";
export type Input = {
    /** Target window. Linux sends input without activating it. Omit for desktop input. */
    window?: Window;
    /** Editable element ID from `get_window_state().ax_tree`. Requires window; Sky focuses it before typing. */
    element_id?: string;
    /** Text to type into the selected element or current focus. */
    text: string;
};
export type Return = Promise<void>;
/** Type text into an editable AX element or the current focus. Invalid element targets fail before typing. */
export type Function = (input: Input) => Return;
