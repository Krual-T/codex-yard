import type { Point } from "../Point";
/** Keep the mouse button pressed across pointer movements and screenshots. */
export type Handle = {
    /** Press the mouse button at the starting desktop coordinate. */
    start(point: Point): Promise<void>;
    /** Move the pressed mouse button to another desktop coordinate. */
    move_to(point: Point): Promise<void>;
    /** Release the mouse button and finish the drag. */
    end(): Promise<void>;
};
export type Input = never;
export type Return = Handle;
/** Create a drag handle for observing screenshots before releasing the mouse button. */
export type Function = () => Return;
