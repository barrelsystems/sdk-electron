import { describe, expect, it } from "vitest";
import { categoryForPhase, resolveFailureTitle } from "./errorTaxonomy.js";
import type { UpdateFailureMode } from "./types.js";

describe("resolveFailureTitle", () => {
  it("resolves a static, non-empty title for every UpdateFailureMode", () => {
    const modes: UpdateFailureMode[] = [
      "manifest-unreachable",
      "manifest-parse-failed",
      "version-invalid",
      "signature-missing",
      "signature-invalid",
      "signature-version-mismatch",
      "checksum-mismatch",
      "download-transport-failed",
      "download-file-invalid",
      "download-size-exceeded",
      "download-stream-incomplete",
      "diff-patch-incompatible",
      "extraction-failed",
      "target-not-found-in-manifest",
      "temp-storage-constraint",
      "install-write-failed",
      "install-auth-required-or-failed",
      "install-downgrade-blocked",
      "install-relaunch-failed",
      "install-missing-update",
      "config-invalid",
      "cors-misconfigured",
      "platform-unsupported",
      "sdk-misuse",
      "translocation-blocked",
      "webkit-terminated",
      "release-notes-failed",
      "update-check-declined",
      "resume-appcast-failed",
      "unknown",
    ];

    for (const mode of modes) {
      expect(resolveFailureTitle(mode).length).toBeGreaterThan(0);
    }
  });
});

describe("categoryForPhase", () => {
  it("maps check to check", () => {
    expect(categoryForPhase("check")).toBe("check");
  });

  it("maps verify, download, and extract to download", () => {
    expect(categoryForPhase("verify")).toBe("download");
    expect(categoryForPhase("download")).toBe("download");
    expect(categoryForPhase("extract")).toBe("download");
  });

  it("maps install, config, and unknown to updater", () => {
    expect(categoryForPhase("install")).toBe("updater");
    expect(categoryForPhase("config")).toBe("updater");
    expect(categoryForPhase("unknown")).toBe("updater");
  });
});
