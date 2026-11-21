import type { Point } from "../Point";
export type Input = Point;
export type Return = Promise<void>;
/** Move the cursor to a screenshot-relative point for hover or dragging. */
export type Function = (input: Input) => Return;
