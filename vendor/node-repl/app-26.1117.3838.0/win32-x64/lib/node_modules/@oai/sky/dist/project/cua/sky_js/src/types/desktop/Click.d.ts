import type { MouseButton } from "../MouseButton";
export type Input = {
    /** X coordinate relative to the latest screenshot. */
    x: number;
    /** Y coordinate relative to the latest screenshot. */
    y: number;
    /** Mouse button to click; defaults to left. */
    mouse_button?: MouseButton;
    /** Number of clicks, from 1 to 3. */
    click_count?: number;
};
export type Return = Promise<void>;
/** Click at a position in the latest screenshot. */
export type Function = (input: Input) => Return;
