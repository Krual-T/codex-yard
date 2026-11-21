import type { ClipboardHandle } from "./ClipboardHandle";
import type { Window } from "./Window";
export type Input = {
    /** Window whose current selection should be copied. */
    window: Window;
};
export type Return = Promise<ClipboardHandle>;
/**
 * Invoke the app's Copy action and return a handle for a saved snapshot of its contents.
 * The snapshot stays separate from later clipboard changes. Release the handle when finished.
 */
export type Function = (input: Input) => Return;
