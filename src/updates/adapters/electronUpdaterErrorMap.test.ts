import type { Phase } from "../models/failure.js";
import { EventEmitter } from "node:events";
import {
  createElectronUpdaterAdapter,
  type ElectronUpdaterLike,
} from "./electronUpdaterAdapter.js";
import { categoryForPhase, resolveFailureTitle } from "../errorTaxonomy.js";
import type { UpdateFailureMode } from "../models/failure.js";
import { describe, expect, it, vi } from "vitest";
import { mapElectronUpdaterError } from "./electronUpdaterErrorMap.js";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

describe("mapElectronUpdaterError", () => {
  const cases: Array<[string, "check" | "download" | "idle", UpdateFailureMode, Phase]> = [
    ["ERR_UPDATER_CHANNEL_FILE_NOT_FOUND", "idle", "manifest-unreachable", "check"],
    ["ERR_UPDATER_INVALID_VERSION", "idle", "version-invalid", "check"],
    ["ERR_UPDATER_MANIFEST_NOT_SIGNED", "idle", "signature-missing", "verify"],
    ["ERR_UPDATER_MANIFEST_SIGNATURE_INVALID", "idle", "signature-invalid", "verify"],
    ["ERR_UPDATER_INVALID_UPDATE_FILE", "idle", "download-file-invalid", "download"],
    ["ERR_CHECKSUM_MISMATCH", "idle", "checksum-mismatch", "verify"],
    ["ERR_UPDATER_DOWNLOAD_SIZE_EXCEEDED", "idle", "download-size-exceeded", "download"],
    ["ERR_STREAM_NOT_FINISHED", "idle", "download-stream-incomplete", "download"],
    ["ERR_UPDATER_BLOCKMAP_FORMAT_CHANGED", "idle", "diff-patch-incompatible", "download"],
    ["ERR_UPDATER_OLD_FILE_NOT_FOUND", "idle", "install-missing-update", "install"],
    ["ERR_UPDATER_CROSS_ORIGIN_HEADERS_NOT_CONFIGURED", "idle", "cors-misconfigured", "config"],
    ["ERR_UPDATER_INVALID_CROSS_ORIGIN_HEADERS", "idle", "cors-misconfigured", "config"],
    ["ERR_UPDATER_CROSS_ORIGIN_HEADER_POLICY_MISSING", "idle", "cors-misconfigured", "config"],
    ["ENOSPC", "idle", "temp-storage-constraint", "download"],
    ["EROFS", "idle", "temp-storage-constraint", "download"],
    ["EDQUOT", "idle", "temp-storage-constraint", "download"],
    ["HTTP_ERROR_500", "idle", "download-transport-failed", "download"],
    ["ECONNREFUSED", "idle", "download-transport-failed", "download"],
    // Pinned 6.8.11's real code and `main`'s current replacement name, both kept live.
    ["ERR_HTTP_RESPONSE_TOO_LARGE", "idle", "download-size-exceeded", "check"],
    ["ERR_UPDATER_RESPONSE_TOO_LARGE", "idle", "download-size-exceeded", "check"],
    ["ERR_UPDATER_LATEST_VERSION_NOT_FOUND", "idle", "manifest-unreachable", "check"],
    ["ERR_UPDATER_RELEASE_NOT_FOUND", "idle", "manifest-unreachable", "check"],
    ["ERR_UPDATER_INVALID_TAG", "idle", "version-invalid", "check"],
    ["ERR_UPDATER_INVALID_SIGNATURE", "idle", "signature-invalid", "verify"],
    ["ERR_UPDATER_SIGNATURE_UNVERIFIABLE", "idle", "signature-invalid", "verify"],
    ["ERR_UPDATER_INSTALLER_VERSION_MISMATCH", "idle", "signature-version-mismatch", "verify"],
    ["ERR_UPDATER_INVALID_FILE_NAME", "idle", "download-file-invalid", "download"],
    ["ERR_UPDATER_UNSAFE_INSTALLER_PATH", "idle", "download-file-invalid", "download"],
    ["ERR_UPDATER_BLOCKMAP_FILE_NOT_FOUND", "idle", "diff-patch-incompatible", "download"],
    ["ERR_UPDATER_LOOPBACK_REDIRECT", "idle", "download-transport-failed", "download"],
    ["ERR_UPDATER_MAC_PROXY_SERVER_FAILED", "idle", "install-relaunch-failed", "install"],
    ["ERR_UPDATER_INVALID_RELEASE_FEED", "idle", "manifest-parse-failed", "check"],
    ["ERR_UPDATER_INVALID_UPDATE_INFO", "idle", "manifest-parse-failed", "check"],
    ["ERR_XML_MISSED_ELEMENT", "idle", "manifest-parse-failed", "check"],
    ["ERR_XML_ELEMENT_NAME_EMPTY", "idle", "manifest-parse-failed", "check"],
    ["ERR_XML_ELEMENT_INVALID_NAME", "idle", "manifest-parse-failed", "check"],
    ["ERR_XML_MISSED_ATTRIBUTE", "idle", "manifest-parse-failed", "check"],
    ["ERR_UPDATER_NO_CHECKSUM", "idle", "manifest-parse-failed", "check"],
    ["ERR_UPDATER_NO_PUBLISHED_VERSIONS", "idle", "target-not-found-in-manifest", "check"],
    ["ERR_UPDATER_ASSET_NOT_FOUND", "idle", "target-not-found-in-manifest", "check"],
    ["ERR_UPDATER_NO_FILES_PROVIDED", "idle", "target-not-found-in-manifest", "check"],
    ["ERR_UPDATER_ZIP_FILE_NOT_FOUND", "idle", "target-not-found-in-manifest", "check"],
    ["ERR_UPDATER_NO_WEB_PACKAGE_FOR_ARCH", "idle", "target-not-found-in-manifest", "download"],
    ["ERR_UPDATER_INVALID_CHANNEL", "idle", "config-invalid", "config"],
    ["ERR_UPDATER_INVALID_MAX_UPDATE_INFO_SIZE", "idle", "config-invalid", "config"],
    ["ERR_UPDATER_WEB_INSTALLER_DISABLED", "idle", "config-invalid", "config"],
    ["ERR_UPDATER_NO_PUBLISHER_NAME", "idle", "config-invalid", "config"],
    ["ERR_UPDATER_INVALID_PROVIDER_CONFIGURATION", "idle", "config-invalid", "config"],
    ["ERR_UPDATER_UNSUPPORTED_PROVIDER", "idle", "config-invalid", "config"],
    ["ERR_UPDATER_FEED_BASE_URL_NOT_DECLARED", "idle", "config-invalid", "config"],
    ["ERR_UPDATER_INSECURE_FEED", "idle", "config-invalid", "config"],
  ];

  it.each(cases)(
    "maps %s to %s -> failureMode %s, phase %s",
    (code, phase, failureMode, expectedPhase) => {
      const result = mapElectronUpdaterError(Object.assign(new Error("x"), { code }), phase);
      expect(result).toEqual({ failureMode, phase: expectedPhase });
    },
  );

  it.each(cases)(
    "routes %s through the real adapter to its public failure",
    (code, _phase, mode, phase) => {
      const updater = new EventEmitter() as ElectronUpdaterLike & EventEmitter;
      updater.checkForUpdates = vi.fn().mockResolvedValue(null);
      updater.downloadUpdate = vi.fn().mockResolvedValue(null);
      updater.quitAndInstall = vi.fn();
      updater.setFeedURL = vi.fn();
      const adapter = createElectronUpdaterAdapter(updater);
      expect(adapter.getLastUpdateError()).toBeUndefined();

      updater.emit("error", Object.assign(new Error("native failure"), { code }));

      const failure = adapter.getLastUpdateError();
      expect(failure).toEqual({
        phase,
        failureMode: mode,
        title: resolveFailureTitle(mode),
        platform: "electron-updater",
        platformCode: code,
      });
      expect(adapter.getUpdateState()).toEqual({
        type: "failed",
        category: categoryForPhase(phase),
        code: mode,
        platformCode: code,
      });

      updater.emit("update-not-available");
      expect(adapter.getUpdateState()).toEqual({ type: "idle" });
      expect(adapter.getLastUpdateError()).toEqual(failure);
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

  it.each(["ENOSPC", "EROFS", "EDQUOT"])(
    "maps the download write stream's %s to temp-storage-constraint",
    (code) => {
      expect(mapElectronUpdaterError(Object.assign(new Error("x"), { code }), "idle")).toEqual({
        failureMode: "temp-storage-constraint",
        phase: "download",
      });
    },
  );

  // electron-updater's ElevationDeniedError (Linux pkexec refusal) carries no
  // `.code` at all, only `.name` -- see LinuxUpdater.ts's ElevationDeniedError.
  it("maps ElevationDeniedError (matched by name, not code) to install-auth-required-or-failed", () => {
    const error = new Error(
      "pkexec exited with code 126 (the authentication dialog was dismissed)",
    );
    error.name = "ElevationDeniedError";
    expect(mapElectronUpdaterError(error, "idle")).toEqual({
      failureMode: "install-auth-required-or-failed",
      phase: "install",
    });
  });
});
