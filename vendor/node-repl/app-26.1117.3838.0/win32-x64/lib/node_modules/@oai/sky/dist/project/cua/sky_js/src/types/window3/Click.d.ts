import type * as Window2 from "../window2/Click";
import type { PointerTarget } from "./PointerTarget";
export type Input = PointerTarget & Pick<Window2.Input, "mouse_button" | "click_count">;
export type Return = Promise<void>;
/** Click an indexed accessibility element or a point on the selected screenshot. */
export type Function = (input: Input) => Return;
