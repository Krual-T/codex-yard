import type { Point } from "../Point";
export type Input = {
    path: Array<Point>;
};
export type Return = Promise<void>;
/** Drag with the left mouse button through screenshot-relative points. */
export type Function = (input: Input) => Return;
