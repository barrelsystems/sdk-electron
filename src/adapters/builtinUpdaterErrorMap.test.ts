import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mapBuiltinUpdaterError } from "./builtinUpdaterErrorMap.js";

describe("mapBuiltinUpdaterError", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  describe("on macOS", () => {
    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    });

    it("maps the relaunch path to install-relaunch-failed", () => {
      expect(mapBuiltinUpdaterError("relaunching")).toEqual({
        failureMode: "install-relaunch-failed",
        phase: "install",
      });
    });

    it("maps the configure path to config-invalid", () => {
      expect(mapBuiltinUpdaterError("configuring")).toEqual({
        failureMode: "config-invalid",
        phase: "config",
      });
    });

    it("maps the check path to unknown failureMode, but still the real phase -- the (domain, code) space isn't enumerated", () => {
      expect(mapBuiltinUpdaterError("checking")).toEqual({
        failureMode: "unknown",
        phase: "check",
      });
    });
  });

  describe("on Windows", () => {
    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    });

    it("maps every call path to unknown failureMode -- no library-sourced identifier exists at all -- while still reporting the real phase per call site", () => {
      expect(mapBuiltinUpdaterError("checking")).toEqual({
        failureMode: "unknown",
        phase: "check",
      });
      expect(mapBuiltinUpdaterError("relaunching")).toEqual({
        failureMode: "unknown",
        phase: "install",
      });
      expect(mapBuiltinUpdaterError("configuring")).toEqual({
        failureMode: "unknown",
        phase: "config",
      });
    });
  });
});
