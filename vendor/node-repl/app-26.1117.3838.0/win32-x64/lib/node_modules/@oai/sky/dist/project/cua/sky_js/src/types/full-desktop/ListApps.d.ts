import type { Window } from "./Window";
/** Launchable desktop application discovered from freedesktop app entries. */
export type App = {
    /** Desktop-entry identifier accepted by `launch_app()`. */
    id: string;
    /** Human-readable application name. */
    name: string;
    /** Currently open windows associated with this application. */
    windows: Array<Window>;
};
export type Input = never;
export type Return = Promise<Array<App>>;
/** List launchable applications and any currently open windows they own. */
export type Function = () => Return;
