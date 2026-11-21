import type { Window } from "./Window";
export type Input = {
    /** Window object from `list_apps()` or `list_windows()` to type into. */
    window: Window;
    /** Text to type into the current focus. */
    text: string;
};
export type Return = Promise<void>;
/** Type text into the current focus in a window. */
export type Function = (input: Input) => Return;
