export type App = {
    /** Canonical app id to pass as `app` when targeting a window. */
    id: string;
    /** User-visible app name when available. */
    displayName?: string;
    /** ISO 8601 timestamp for recent app usage when available. */
    lastUsedDate?: string;
    /** Usage count signal when available. */
    useCount?: number;
    /** Whether the app currently appears to be running. */
    isRunning?: boolean;
};
export type Input = never;
export type Return = Promise<Array<App>>;
/** List apps that can be targeted by the window API. */
export type Function = () => Return;
