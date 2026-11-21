export type Input = {
    /** Horizontal integer offset in pixels, from -32768 to 32767. */
    dx: number;
    /** Vertical integer offset in pixels, from -32768 to 32767. */
    dy: number;
    /** Optional key chord to hold while moving, using the same format as `press_key()`. */
    key?: string;
};
export type Return = Promise<void>;
/** Move the desktop pointer by a relative offset using normal desktop input routing. */
export type Function = (input: Input) => Return;
