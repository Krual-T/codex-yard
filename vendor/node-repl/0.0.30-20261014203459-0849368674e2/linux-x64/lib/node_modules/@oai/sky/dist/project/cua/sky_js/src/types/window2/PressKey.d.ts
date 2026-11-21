import type { Window } from "./Window";
export type Input = {
    /** Window object from `list_apps()` or `list_windows()` to receive the key press. */
    window: Window;
    /** Key or `+`-separated key chord using X Window System keysym-style names, such as `a`, `space`, `Return`, `Tab`, `Control_L+a`, `Control_L+Shift_L+period`, or `KP_0`; whitespace around `+` is ignored, and common aliases such as `Control`, `Ctrl`, `Alt`, `Shift`, `period`, `greater`, and `Numpad_0` are accepted. */
    key: string;
};
export type Return = Promise<void>;
/** Press a `+`-separated keyboard chord in a window. */
export type Function = (input: Input) => Return;
