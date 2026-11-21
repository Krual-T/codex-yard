export declare function enumerate<T>(iterable: Iterable<T>): Generator<readonly [number, T], void, unknown>;
export declare namespace enumerate {
    var async: <T>(iterable: AsyncIterable<T>) => AsyncGenerator<readonly [number, Awaited<T>], void, unknown>;
}
