import type { AnyFunction } from "../AnyFunction";
export type All<T extends AnyFunction> = Parameters<T>;
export type First<T extends AnyFunction> = Parameters<T>[0];
export type Second<T extends AnyFunction> = Parameters<T>[1];
export type Third<T extends AnyFunction> = Parameters<T>[2];
export type At<Index extends number, T extends AnyFunction> = Parameters<T>[Index];
