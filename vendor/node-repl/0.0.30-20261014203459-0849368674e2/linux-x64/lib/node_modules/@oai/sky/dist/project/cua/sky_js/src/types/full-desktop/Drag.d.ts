import type { Point } from "../Point";
import type { Window } from "./Window";
export type Input = {
    /** Linux target window, without implicit activation. Path coordinates are window-relative. Omit for desktop input. */
    window?: Window;
    /** At least two desktop or target-window coordinates to visit in order. */
    path: Array<Point>;
    /** Optional key chord to hold during the drag, using the same format as `press_key()`. */
    key?: string;
};
export type Return = Promise<void>;
/** Drag through an ordered path of desktop or target-window coordinates. */
export type Function = (input: Input) => Return;
