import type { ClipboardHandle } from "./ClipboardHandle";
export type Input = {
    /** Snapshot ID returned by clipboard_read() in the current Linux helper. */
    handle: ClipboardHandle;
};
export type Return = Promise<void>;
/** Free a saved clipboard snapshot when finished; releasing the same handle again has no effect. */
export type Function = (input: Input) => Return;
