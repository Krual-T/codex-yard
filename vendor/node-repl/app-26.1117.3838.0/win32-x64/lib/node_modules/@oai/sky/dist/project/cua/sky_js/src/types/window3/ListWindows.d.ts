import type { Window } from "./Window";
export type Input = never;
export type Return = Promise<Array<Window>>;
/** List targetable windows and their immediate owners. */
export type Function = () => Return;
