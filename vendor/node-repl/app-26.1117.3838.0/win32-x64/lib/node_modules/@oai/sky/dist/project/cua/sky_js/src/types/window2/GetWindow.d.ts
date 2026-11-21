import type { AppIdentifier } from "../window/AppIdentifier";
import type { Window } from "./Window";
export type Input = {
    /** Opaque window identifier from a previously returned `Window`. */
    id: number;
    /** Optional app identifier to carry forward from a previously returned `Window`. */
    app?: AppIdentifier;
};
export type Return = Promise<Window>;
/** Rehydrate a currently open window by id; useful after losing a window binding. */
export type Function = (input: Input) => Return;
