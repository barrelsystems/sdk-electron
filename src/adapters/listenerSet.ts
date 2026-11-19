/** A tiny append-only multicast: every adapter's `onStateChange` needs the
 * same register-and-notify-all shape, with no removal API. */
export function createListenerSet<T>(): {
  add(listener: (value: T) => void): void;
  notify(value: T): void;
} {
  const listeners: ((value: T) => void)[] = [];
  return {
    add(listener) {
      listeners.push(listener);
    },
    notify(value) {
      for (const listener of listeners) listener(value);
    },
  };
}
