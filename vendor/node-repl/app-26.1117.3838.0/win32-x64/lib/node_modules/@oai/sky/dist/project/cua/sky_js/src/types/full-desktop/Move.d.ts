import type { Window } from "./Window";
export type Input = {
    /** Linux target window, without implicit activation. Coordinates are window-relative. Omit for desktop input. */
    window?: Window;
    /** X coordinate on the desktop or within the target window. */
    x: number;
    /** Y coordinate on the desktop or within the target window. */
    y: number;
    /** Optional key chord to hold while moving, using the same format as `press_key()`. */
    key?: string;
};
export type Return = Promise<void>;
/** Move the pointer to a desktop or target-window coordinate. */
export type Function = (input: Input) => Return;
