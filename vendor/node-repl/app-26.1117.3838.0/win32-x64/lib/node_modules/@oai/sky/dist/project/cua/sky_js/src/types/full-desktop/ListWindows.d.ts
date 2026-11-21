import type { Window } from "./Window";
export type Input = never;
export type Return = Promise<Array<Window>>;
/** List mapped application windows, including dialogs and transient windows. */
export type Function = () => Return;
