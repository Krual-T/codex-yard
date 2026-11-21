import type { PointerTarget } from "./PointerTarget";
export type Input = PointerTarget;
export type Return = Promise<void>;
/** Position the virtual cursor over an indexed element or screenshot point. */
export type Function = (input: Input) => Return;
