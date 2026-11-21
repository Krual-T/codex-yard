export type Input = {
    key: string;
};
export type Return = Promise<void>;
/** Press a key or plus-separated chord; `Down` and `ArrowDown` name the same arrow key. */
export type Function = (input: Input) => Return;
