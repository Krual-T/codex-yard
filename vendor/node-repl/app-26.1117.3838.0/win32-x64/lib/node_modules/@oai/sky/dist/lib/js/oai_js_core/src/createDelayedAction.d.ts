export declare function createDelayedAction<Args extends Array<any>>(action: (...args: Args) => void, delay_ms?: number): (...args: Args) => void;
