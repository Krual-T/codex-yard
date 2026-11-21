import type { Window } from "./Window";
export type Input = {
    /** Target window. Linux sends input without activating it. Omit for desktop input. */
    window?: Window;
    /**
     * Key or `+`-separated key chord using X Window System keysym-style names,
     * such as `a`, `space`, `Return`, `Tab`, `Control_L+a`, or `Super_L+d`;
     * whitespace around `+` is ignored and common aliases such as `Ctrl`,
     * `Alt`, and `Shift` are accepted.
     */
    key: string;
    /** Milliseconds to hold the key or chord before releasing it. */
    duration?: number;
};
export type Return = Promise<void>;
/** Press a `+`-separated keyboard chord on the desktop or in a target window. */
export type Function = (input: Input) => Return;
