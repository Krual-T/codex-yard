import type * as Window2ListApps from "../window2/ListApps";
import type { Window } from "./Window";
export type App = Omit<Window2ListApps.App, "windows"> & {
    windows: Array<Window>;
};
export type Input = never;
export type Return = Promise<Array<App>>;
/** Discover apps and their targetable windows. */
export type Function = () => Return;
