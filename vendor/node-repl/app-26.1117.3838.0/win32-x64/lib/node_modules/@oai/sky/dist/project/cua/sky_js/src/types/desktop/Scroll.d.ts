export type Input = {
    /** X coordinate relative to the latest screenshot. */
    x: number;
    /** Y coordinate relative to the latest screenshot. */
    y: number;
    /** Horizontal scroll distance; positive values scroll right. */
    delta_x?: number;
    /** Vertical scroll distance; positive values scroll down. */
    delta_y?: number;
};
export type Return = Promise<void>;
/** Scroll at a screenshot-relative point; 120 is one wheel notch. */
export type Function = (input: Input) => Return;
