import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mapBuiltinUpdaterError } from "./builtinUpdaterErrorMap.js";
import type { BuiltinUpdaterError } from "./builtinUpdaterErrorMap.js";

function macError(domain?: string, code?: number): BuiltinUpdaterError {
  const error: BuiltinUpdaterError = new Error("x");
  if (domain !== undefined) error.domain = domain;
  if (code !== undefined) error.code = code;
  return error;
}

describe("mapBuiltinUpdaterError", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  describe("on macOS", () => {
    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    });

    it("maps the relaunch path to install-relaunch-failed when no real (domain, code) is present", () => {
      expect(mapBuiltinUpdaterError(macError(), "relaunching")).toEqual({
        failureMode: "install-relaunch-failed",
        phase: "install",
      });
    });

    it("maps the configure path to config-invalid when no real (domain, code) is present", () => {
      expect(mapBuiltinUpdaterError(macError(), "configuring")).toEqual({
        failureMode: "config-invalid",
        phase: "config",
      });
    });

    it("maps the check path to unknown failureMode, but still the real phase, when no real (domain, code) is present", () => {
      expect(mapBuiltinUpdaterError(macError(), "checking")).toEqual({
        failureMode: "unknown",
        phase: "check",
      });
    });

    // Squirrel.Mac's real SQRLCodeSignatureErrorDomain -- raised when the
    // staged update bundle fails codesign verification.
    it.each([
      ["SQRLCodeSignatureErrorDomain -1 (DidNotPass)", "SQRLCodeSignatureErrorDomain", -1],
      [
        "SQRLCodeSignatureErrorDomain -2 (CouldNotCreateStaticCode)",
        "SQRLCodeSignatureErrorDomain",
        -2,
      ],
    ])("maps %s to signature-invalid regardless of operation", (_name, domain, code) => {
      expect(mapBuiltinUpdaterError(macError(domain, code), "checking")).toEqual({
        failureMode: "signature-invalid",
        phase: "verify",
      });
    });

    it.each([-1, -2, -3, -4, -5, -6, -7, -8])(
      "maps every real SQRLInstallerErrorDomain code (%d) to install-write-failed",
      (code) => {
        expect(
          mapBuiltinUpdaterError(macError("SQRLInstallerErrorDomain", code), "relaunching"),
        ).toEqual({
          failureMode: "install-write-failed",
          phase: "install",
        });
      },
    );

    it("maps SQRLUpdaterErrorDomain 2 (MissingUpdateBundle) to install-missing-update", () => {
      expect(mapBuiltinUpdaterError(macError("SQRLUpdaterErrorDomain", 2), "checking")).toEqual({
        failureMode: "install-missing-update",
        phase: "install",
      });
    });

    it("maps SQRLUpdaterErrorDomain 3 (PreparingUpdateJob) to install-write-failed", () => {
      expect(mapBuiltinUpdaterError(macError("SQRLUpdaterErrorDomain", 3), "checking")).toEqual({
        failureMode: "install-write-failed",
        phase: "install",
      });
    });

    it("maps SQRLUpdaterErrorDomain 4 (RetrievingCodeSigningRequirement) to signature-invalid", () => {
      expect(mapBuiltinUpdaterError(macError("SQRLUpdaterErrorDomain", 4), "checking")).toEqual({
        failureMode: "signature-invalid",
        phase: "verify",
      });
    });

    it.each([5, 6, 7])(
      "maps SQRLUpdaterErrorDomain %d (malformed update-check response/JSON) to manifest-parse-failed",
      (code) => {
        expect(
          mapBuiltinUpdaterError(macError("SQRLUpdaterErrorDomain", code), "checking"),
        ).toEqual({ failureMode: "manifest-parse-failed", phase: "check" });
      },
    );

    // Squirrel.Mac raises this when the app bundle is on a read-only volume --
    // the exact condition macOS App Translocation produces (Squirrel.Mac#182).
    it("maps SQRLUpdaterErrorDomain 8 (ReadOnlyVolume) to translocation-blocked", () => {
      expect(mapBuiltinUpdaterError(macError("SQRLUpdaterErrorDomain", 8), "checking")).toEqual({
        failureMode: "translocation-blocked",
        phase: "check",
      });
    });

    it("falls back to the operation-based mapping for an unrecognized domain", () => {
      expect(mapBuiltinUpdaterError(macError("NSCocoaErrorDomain", 260), "relaunching")).toEqual({
        failureMode: "install-relaunch-failed",
        phase: "install",
      });
    });
  });

  describe("on Windows", () => {
    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    });

    it("maps every call path to unknown failureMode -- no library-sourced identifier exists at all -- while still reporting the real phase per call site", () => {
      expect(mapBuiltinUpdaterError(macError(), "checking")).toEqual({
        failureMode: "unknown",
        phase: "check",
      });
      expect(mapBuiltinUpdaterError(macError(), "relaunching")).toEqual({
        failureMode: "unknown",
        phase: "install",
      });
      expect(mapBuiltinUpdaterError(macError(), "configuring")).toEqual({
        failureMode: "unknown",
        phase: "config",
      });
    });

    it("ignores a (domain, code) pair even if present, since Windows never produces a real one", () => {
      expect(
        mapBuiltinUpdaterError(macError("SQRLCodeSignatureErrorDomain", -1), "checking"),
      ).toEqual({ failureMode: "unknown", phase: "check" });
    });
  });
});
