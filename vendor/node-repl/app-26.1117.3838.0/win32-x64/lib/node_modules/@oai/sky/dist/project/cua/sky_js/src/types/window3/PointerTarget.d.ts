import type { Window } from "./Window";
/** Target an indexed accessibility element or a point on this window's selected screenshot. */
export type PointerTarget = {
    window: Window;
} & ({
    element_index: number;
    x?: never;
    y?: never;
    screenshotId?: never;
} | {
    x: number;
    y: number;
    screenshotId?: string;
    element_index?: never;
});
