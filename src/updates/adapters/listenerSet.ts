import { recordInternalDefect } from "../internalDefects.js";

/** Snapshot listeners before delivery; removing a listener cannot skip its neighbor. */
export function createListenerSet<T>(): {
  add(listener: (value: T) => void | Promise<void>): () => void;
  notify(value: T): Promise<void>;
} {
  const listeners = new Set<(value: T) => void | Promise<void>>();

  return {
    add(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async notify(value) {
      await Promise.all(
        [...listeners].map(async (listener) => {
          try {
            await listener(value);
          } catch {
            recordInternalDefect("observer:callback");
          }
        }),
      );
    },
  };
}
