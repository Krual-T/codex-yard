import type { MouseButton } from "../MouseButton";
import type { AppIdentifier } from "./AppIdentifier";
export type Input = {
    /** App id, display name, process name, or other supported app identifier from `list_apps()`. */
    app: AppIdentifier;
    /** Element index from the latest `get_app_state()` text. */
    element_index?: number;
    /** X coordinate in the app-window screenshot. */
    x?: number;
    /** Y coordinate in the app-window screenshot. */
    y?: number;
    /** Mouse button to click. */
    mouse_button?: MouseButton;
    /** Number of clicks to perform. */
    click_count?: number;
    /** Key or `+`-separated key chord to hold during the click. */
    key?: string;
    /** Number of seconds to hold the mouse button before releasing it. */
    duration?: number;
};
export type Return = Promise<void>;
/** Click either an indexed element from the latest app state or a coordinate in the app window. */
export type Function = (input: Input) => Return;
