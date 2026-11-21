import type { Window } from "./Window";
export type Return = Promise<Array<Window>>;
/** List open windows that can be targeted by the window2 API. */
export type Function = () => Return;
