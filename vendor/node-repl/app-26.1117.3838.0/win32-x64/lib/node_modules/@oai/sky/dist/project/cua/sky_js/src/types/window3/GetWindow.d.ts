import type { AppIdentifier } from "../window/AppIdentifier";
import type { Window, WindowID } from "./Window";
export type Input = {
    id: WindowID;
    app?: AppIdentifier;
};
export type Return = Promise<Window>;
/** Resolve a discovered window ID, optionally checking its app. */
export type Function = (input: Input) => Return;
