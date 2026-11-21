import type { Window } from "./Window";
export type Input = {
    /** Window object from `list_apps()` or `list_windows()` to bring to the foreground. */
    window: Window;
};
export type Return = Promise<void>;
/** Optional escape hatch to bring an open window to the foreground; input methods activate their target window automatically. */
export type Function = (input: Input) => Return;
