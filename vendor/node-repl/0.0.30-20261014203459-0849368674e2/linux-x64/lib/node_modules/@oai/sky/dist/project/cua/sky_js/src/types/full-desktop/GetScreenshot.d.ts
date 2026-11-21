import type { Screenshot } from "./Screenshot";
export type Input = never;
export type Return = Promise<Array<Screenshot>>;
/** Capture screenshots for the full desktop target. */
export type Function = () => Return;
