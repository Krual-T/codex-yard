import type { AppIdentifier } from "./AppIdentifier";
export type Input = {
    /** App id, display name, process name, or other supported app identifier from `list_apps()`. */
    app: AppIdentifier;
    /** Key or `+`-separated key chord using X Window System keysym-style names, such as `a`, `space`, `Return`, `Tab`, `Control_L+a`, or `Super_L+d`; whitespace around `+` is ignored, and common aliases such as `Control`, `Ctrl`, `Alt`, and `Shift` are accepted. */
    key: string;
    /** Number of seconds to hold the key before releasing it. */
    duration?: number;
};
export type Return = Promise<void>;
/** Press a `+`-separated keyboard chord in an app window. */
export type Function = (input: Input) => Return;
