import { AnyFunction } from "@oai/types";
export declare function createLazyEvaluator<T extends AnyFunction>(evaluate: T): (...params: Parameters<T>) => ReturnType<T>;
