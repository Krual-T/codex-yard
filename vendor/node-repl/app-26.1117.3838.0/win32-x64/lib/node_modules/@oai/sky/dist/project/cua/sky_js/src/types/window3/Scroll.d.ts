import type { Direction } from "../Direction";
import type * as Window2 from "../window2/Scroll";
import type { Window } from "./Window";
export type Input = {
    window: Window;
} & ({
    element_index: number;
    direction: Direction;
    pages?: number;
    x?: never;
    y?: never;
    screenshotId?: never;
    scrollX?: never;
    scrollY?: never;
} | (Omit<Window2.Input, "window"> & {
    element_index?: never;
    direction?: never;
    pages?: never;
}));
export type Return = Promise<void>;
/** Scroll an indexed element by pages or apply horizontal and vertical deltas at a screenshot point. */
export type Function = (input: Input) => Return;
