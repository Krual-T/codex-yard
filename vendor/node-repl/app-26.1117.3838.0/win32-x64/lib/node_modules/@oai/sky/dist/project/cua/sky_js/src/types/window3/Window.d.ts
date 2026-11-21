import type { AppIdentifier } from "../window/AppIdentifier";
/** Copy an opaque ID from window discovery. */
export type WindowID = string;
export interface Window {
    app: AppIdentifier;
    id: WindowID;
    /** Immediate owner of a separately targetable dialog, when known. */
    owner?: WindowID;
    title?: string;
}
