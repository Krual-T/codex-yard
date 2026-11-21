export type Input = {
    /** Stop automatically after this many milliseconds (default 60000, maximum 300000). */
    max_duration_ms?: number;
};
export type Return = Promise<void>;
/** Start recording loopback audio while other computer-use actions continue. */
export type Function = (input?: Input) => Return;
