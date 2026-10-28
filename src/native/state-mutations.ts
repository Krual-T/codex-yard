/** One commit interval for every consumer of native-state.json. */
export interface StateMutations {
  run<T>(action: () => T | Promise<T>): Promise<T>;
  flush(): Promise<void>;
}

export function createStateMutations(beforeAction?: () => void | Promise<void>): StateMutations {
  let pending = Promise.resolve();
  return {
    run<T>(action: () => T | Promise<T>) {
      const result = pending.then(beforeAction ? async () => { await beforeAction(); return action(); } : action);
      pending = result.then(() => {}, () => {});
      return result;
    },
    flush: () => pending,
  };
}
