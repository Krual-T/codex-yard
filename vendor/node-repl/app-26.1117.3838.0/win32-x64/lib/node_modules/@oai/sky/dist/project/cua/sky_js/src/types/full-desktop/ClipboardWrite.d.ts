import type { ClipboardHandle } from "./ClipboardHandle";
import type { Window } from "./Window";
export type Input = {
    /** Window whose current focus should receive the clipboard contents. */
    window: Window;
    /** Reusable snapshot ID from clipboard_read(), valid until released or the Linux helper exits. */
    handle: ClipboardHandle;
};
export type Return = Promise<void>;
/** Invoke the app's Paste action with the handle's saved contents; the handle can be reused. */
export type Function = (input: Input) => Return;
