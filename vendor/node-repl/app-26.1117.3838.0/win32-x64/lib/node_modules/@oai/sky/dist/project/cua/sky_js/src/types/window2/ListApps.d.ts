import type { AppIdentifier } from "../window/AppIdentifier";
import type { Window } from "./Window";
export type App = {
    /** Canonical app id for the app that owns the windows. */
    id: AppIdentifier;
    /** User-visible app name when available. */
    displayName?: string;
    /** Open windows owned by this app. */
    windows: Array<Window>;
    /** ISO 8601 timestamp for recent app usage when available. */
    lastUsedDate?: string;
    /** Usage count signal when available. */
    useCount?: number;
    /** Whether the app currently appears to be running. */
    isRunning?: boolean;
};
export type Input = never;
export type Return = Promise<Array<App>>;
/** List installed apps, including their currently open targetable windows when present. */
export type Function = () => Return;
