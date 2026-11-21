import type { Audio } from "./Audio";
export type Input = never;
export type Return = Promise<Audio>;
/** Stop the active computer audio recording and return a 24 kHz stereo WAV. */
export type Function = () => Return;
