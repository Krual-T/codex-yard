import type * as TypeText from "./TypeText";
export type Input = TypeText.Input;
export type Return = TypeText.Return;
/** Paste into the focused control, replacing the Windows clipboard. */
export type Function = (input: Input) => Return;
