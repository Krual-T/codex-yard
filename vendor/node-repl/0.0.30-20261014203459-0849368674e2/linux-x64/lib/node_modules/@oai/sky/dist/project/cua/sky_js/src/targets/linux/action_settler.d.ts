import type * as T from "../../types";
type Timing = {
    now: () => number;
    sleep: (ms: number) => Promise<unknown>;
};
export declare class ActionSettler {
    #private;
    constructor(options: T.FullDesktop.LinuxOptions, timing?: Timing);
    wait(): Promise<void>;
    defer(): void;
}
export {};
