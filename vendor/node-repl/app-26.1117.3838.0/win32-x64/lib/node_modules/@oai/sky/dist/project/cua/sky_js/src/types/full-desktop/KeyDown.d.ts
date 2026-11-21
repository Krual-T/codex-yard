import type { Window } from "./Window";
export type Input = {
    /** Target window. Linux sends input without activating it. Omit for desktop input. */
    window?: Window;
    /** Key or `+`-separated chord to hold, using the same format as `press_key()`. */
    key: string;
};
export type Return = Promise<void>;
/** Hold a keyboard chord across actions. Repeating the same parsed chord for the same target is a no-op. Release it with `key_up()` in `finally`. */
export type Function = (input: Input) => Return;
