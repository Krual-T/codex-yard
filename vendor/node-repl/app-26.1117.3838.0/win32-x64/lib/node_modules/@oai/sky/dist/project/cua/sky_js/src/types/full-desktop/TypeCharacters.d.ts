import type { Window } from "./Window";
export type Input = {
    /** Send keys to the current focus in this window, without activating it. */
    window: Window;
    /** Printable characters available on the keyboard layout. Use press_key for Return or Tab. */
    text: string;
};
/** Number of characters sent. Inspect the app to see the resulting text. */
export type Return = Promise<number>;
/** Send printable keys at current focus and return the number sent. Inspect the app to verify the edit. */
export type Function = (input: Input) => Return;
