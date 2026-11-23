import { describe, expect, it } from "vitest";
import { createListenerSet } from "./listenerSet.js";

describe("createListenerSet", () => {
  it("notifies a single listener with the value passed to notify", () => {
    const set = createListenerSet<number>();
    const received: number[] = [];
    set.add((value) => {
      received.push(value);
    });

    set.notify(42);

    expect(received).toEqual([42]);
  });

  it("notifies every registered listener, in registration order", () => {
    const set = createListenerSet<string>();
    const first: string[] = [];
    const second: string[] = [];
    set.add((value) => {
      first.push(value);
    });
    set.add((value) => {
      second.push(value);
    });

    set.notify("a");
    set.notify("b");

    expect(first).toEqual(["a", "b"]);
    expect(second).toEqual(["a", "b"]);
  });

  it("notifying with no listeners registered is a safe no-op", () => {
    const set = createListenerSet<number>();
    expect(() => set.notify(1)).not.toThrow();
  });

  it("stops notifying a listener once its own remove function is called", async () => {
    const set = createListenerSet<number>();
    const received: number[] = [];
    const remove = set.add((value) => {
      received.push(value);
    });

    await set.notify(1);
    remove();
    await set.notify(2);

    expect(received).toEqual([1]);
  });

  it("removing one listener leaves the others registered", async () => {
    const set = createListenerSet<number>();
    const first: number[] = [];
    const second: number[] = [];
    const removeFirst = set.add((value) => {
      first.push(value);
    });
    set.add((value) => {
      second.push(value);
    });

    removeFirst();
    await set.notify(1);

    expect(first).toEqual([]);
    expect(second).toEqual([1]);
  });
  it("isolates throwing and rejecting listeners while awaiting the remaining work", async () => {
    const listeners = createListenerSet<number>();
    let finished = false;
    listeners.add(() => {
      throw new Error("sync observer");
    });
    listeners.add(async () => {
      throw new Error("async observer");
    });
    listeners.add(async () => {
      await Promise.resolve();
      finished = true;
    });

    await expect(listeners.notify(1)).resolves.toBeUndefined();
    expect(finished).toBe(true);
  });
});
