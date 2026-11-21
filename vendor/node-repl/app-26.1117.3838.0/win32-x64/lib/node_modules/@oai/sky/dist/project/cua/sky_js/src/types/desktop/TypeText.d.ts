export type Input = {
    text: string;
};
export type Return = Promise<void>;
/** Type Unicode text into the focused control. */
export type Function = (input: Input) => Return;
