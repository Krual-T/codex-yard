import type { Window } from "./Window";
export type Input = {
    /** Window whose AT-SPI tree contains the element. Linux does not activate it. */
    window: Window;
    /** Element ID from the latest `get_window_state()` tree. Refresh the tree if it is stale. */
    element_id: string;
    /** Action name shown under Secondary Actions or in the element's `actions` array. Matching is case-insensitive. */
    action: string;
};
export type Return = Promise<void>;
/** Invoke a named accessibility action. Throws if the name is unavailable, ambiguous, or the action fails. */
export type Function = (input: Input) => Return;
