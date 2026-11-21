import type { ActionSettler } from "../../targets/linux/action_settler";
import type { ElementIds } from "../../targets/linux/element_ids";
export type LinuxOptions = {
    target: "linux";
    /** Minimum milliseconds before the next action, screenshot, or audio operation after successful input. Set 0 to disable. (default: 100) */
    post_action_sleep_ms?: number;
    /** Resize mouse pointer in screenshots to this size in pixels. Set 0 to disable. (default: 12) */
    mouse_size_px?: number;
};
export type LinuxRuntimeOptions = LinuxOptions & {
    action_settler: ActionSettler;
    element_ids: ElementIds;
};
export type Options = LinuxOptions;
