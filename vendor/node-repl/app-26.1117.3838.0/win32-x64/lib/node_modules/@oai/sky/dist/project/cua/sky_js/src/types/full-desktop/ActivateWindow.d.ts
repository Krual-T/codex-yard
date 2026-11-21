import type { Window } from "./Window";
export type Input = {
    /** Open window returned by `list_windows()` or `list_apps()`. */
    window: Window;
};
export type Return = Promise<void>;
/** Raise an open window and direct keyboard focus to it. */
export type Function = (input: Input) => Return;
