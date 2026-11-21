import type { Window } from "./Window";
export type Input = {
    /** Target window supplied to `key_down()`. Omit for a desktop hold. */
    window?: Window;
    /** Key or `+`-separated chord supplied to `key_down()`. Aliases and case normalize; chord order is preserved. */
    key: string;
};
export type Return = Promise<void>;
/** Release a keyboard chord held for the same target. An absent hold is a no-op, and shared physical keys remain down until no hold needs them. */
export type Function = (input: Input) => Return;
