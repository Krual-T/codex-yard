import type { AppIdentifier } from "../window/AppIdentifier";
export type Input = {
    /** App id returned by `list_apps()`, or an explicit `.exe` process path/identifier for apps that are not yet discoverable in `list_apps()`. */
    app: AppIdentifier;
};
export type Return = Promise<void>;
/** Launch an app by id so its window can be selected from `list_apps()`. On Windows, explicit `.exe` process paths/identifiers are also supported for apps that are not yet listed. */
export type Function = (input: Input) => Return;
