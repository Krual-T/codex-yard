/** One commit interval for every consumer of native-state.json. */
export interface StateMutations {
  run<T>(action: () => T | Promise<T>): Promise<T>;
  flush(): Promise<void>;
}

export function createStateMutations(): StateMutations {
  let pending = Promise.resolve();
  return {
    run<T>(action: () => T | Promise<T>) {
      const result = pending.then(action);
      pending = result.then(() => {}, () => {});
      return result;
    },
    flush: () => pending,
  };
}
