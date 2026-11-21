import type { Pretty } from "./Pretty";
export type Merge<A, B> = Pretty<Omit<A, keyof B> & B>;
