import { describe, expect, it } from "vitest";
import { mapElectronUpdaterError } from "./electronUpdaterErrorMap.js";

describe("mapElectronUpdaterError", () => {
  const cases: Array<[string, "check" | "download" | "idle", string, string]> = [
    ["ERR_UPDATER_CHANNEL_FILE_NOT_FOUND", "idle", "manifest-unreachable", "check"],
    ["ERR_UPDATER_INVALID_VERSION", "idle", "version-invalid", "check"],
    ["ERR_UPDATER_MANIFEST_NOT_SIGNED", "idle", "signature-missing", "verify"],
    ["ERR_UPDATER_MANIFEST_SIGNATURE_INVALID", "idle", "signature-invalid", "verify"],
    ["ERR_UPDATER_INVALID_UPDATE_FILE", "idle", "download-file-invalid", "download"],
    ["ERR_CHECKSUM_MISMATCH", "idle", "checksum-mismatch", "verify"],
    ["ERR_UPDATER_DOWNLOAD_SIZE_EXCEEDED", "idle", "download-size-exceeded", "download"],
    ["ERR_HTTP_RESPONSE_TOO_LARGE", "idle", "download-size-exceeded", "download"],
    ["ERR_STREAM_NOT_FINISHED", "idle", "download-stream-incomplete", "download"],
    ["ERR_UPDATER_BLOCKMAP_FORMAT_CHANGED", "idle", "diff-patch-incompatible", "download"],
    ["ERR_UPDATER_OLD_FILE_NOT_FOUND", "idle", "install-missing-update", "install"],
    ["ERR_UPDATER_CROSS_ORIGIN_HEADERS_NOT_CONFIGURED", "idle", "cors-misconfigured", "config"],
    ["ERR_UPDATER_INVALID_CROSS_ORIGIN_HEADERS", "idle", "cors-misconfigured", "config"],
    ["HTTP_ERROR_500", "idle", "download-transport-failed", "download"],
    ["ECONNREFUSED", "idle", "download-transport-failed", "download"],
  ];

  it.each(cases)(
    "maps %s to %s -> failureMode %s, phase %s",
    (code, phase, failureMode, expectedPhase) => {
      const result = mapElectronUpdaterError(Object.assign(new Error("x"), { code }), phase);
      expect(result).toEqual({ failureMode, phase: expectedPhase });
    },
  );

  it("resolves HTTP_ERROR_404 to manifest-unreachable only while checking", () => {
    expect(
      mapElectronUpdaterError(Object.assign(new Error("x"), { code: "HTTP_ERROR_404" }), "check"),
    ).toEqual({ failureMode: "manifest-unreachable", phase: "check" });
  });

  it("resolves HTTP_ERROR_404 to download-transport-failed outside a check", () => {
    expect(
      mapElectronUpdaterError(Object.assign(new Error("x"), { code: "HTTP_ERROR_404" }), "idle"),
    ).toEqual({ failureMode: "download-transport-failed", phase: "download" });
  });

  it("falls back to unknown when there is no code at all", () => {
    expect(mapElectronUpdaterError(new Error("mystery"), "idle")).toEqual({
      failureMode: "unknown",
      phase: "unknown",
    });
  });
});
