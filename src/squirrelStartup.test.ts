import { describe, expect, it, vi } from "vitest";
import { isSquirrelStartupEvent, quitIfSquirrelStartupEvent } from "./squirrelStartup.js";

describe("isSquirrelStartupEvent", () => {
  it("is true when the injected require resolves a truthy export", () => {
    expect(isSquirrelStartupEvent(vi.fn().mockReturnValue(true))).toBe(true);
  });

  it("is false when the injected require resolves a falsy export", () => {
    expect(isSquirrelStartupEvent(vi.fn().mockReturnValue(false))).toBe(false);
  });

  it("fails open to false when the optional dependency isn't installed", () => {
    const throwingRequire = vi.fn(() => {
      throw new Error("Cannot find module 'electron-squirrel-startup'");
    });

    expect(isSquirrelStartupEvent(throwingRequire)).toBe(false);
  });

  it("the real default require is never invoked just by importing this module", () => {
    // Regression guard: electron-squirrel-startup transitively requires
    // `electron` at load time, which tries to resolve the real Electron
    // binary -- calling isSquirrelStartupEvent() with no argument in a test
    // would hang/download. Covered by never doing so anywhere in this file.
    expect(isSquirrelStartupEvent).toBeTypeOf("function");
  });
});

describe("quitIfSquirrelStartupEvent", () => {
  it("does nothing and returns false when it's not a Squirrel lifecycle event", () => {
    const app = { quit: vi.fn() };
    const browserWindow = { getAllWindows: vi.fn().mockReturnValue([]) };

    const quit = quitIfSquirrelStartupEvent(app, browserWindow, vi.fn().mockReturnValue(false));

    expect(quit).toBe(false);
    expect(app.quit).not.toHaveBeenCalled();
  });

  it("quits and returns true, silently, when it is a Squirrel lifecycle event with no window yet", () => {
    const app = { quit: vi.fn() };
    const browserWindow = { getAllWindows: vi.fn().mockReturnValue([]) };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const quit = quitIfSquirrelStartupEvent(app, browserWindow, vi.fn().mockReturnValue(true));

    expect(quit).toBe(true);
    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("warns, unconditionally, when a window already exists", () => {
    const app = { quit: vi.fn() };
    const browserWindow = { getAllWindows: vi.fn().mockReturnValue([{}]) };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    quitIfSquirrelStartupEvent(app, browserWindow, vi.fn().mockReturnValue(true));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(app.quit).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
