import { app } from "electron";
import type { UpdaterAdapter } from "./adapters/electronUpdaterAdapter.js";
import { checkPreAction } from "./protocol/preActionCheck.js";
import type { BackendConnection } from "./types.js";

export interface HostControlParams {
  connection: BackendConnection;
  autoDownload: boolean;
  adapter: UpdaterAdapter;
  getTrustedKeyPem: () => string;
  /** Called with the version about to be applied, immediately before every
   * `quitAndInstall()` call -- the version-expectation marker a later
   * startup compares against to confirm the apply actually landed. */
  recordVersionExpectation: (version: string) => Promise<void>;
  /** Called when this session's own apply attempt already failed and was
   * classified -- clears the marker above so the next startup doesn't
   * also report it as an unexplained mismatch. */
  clearVersionExpectation: () => Promise<void>;
  log?: ((message: string) => void) | undefined;
}

export interface HostControl {
  downloadUpdate(): void;
  applyUpdate(): void;
}

/**
 * Gates every download and apply on a fresh `pre-action-check`, not just the
 * cadence's own 30-minute Policy -- a Hold placed since the last check-in
 * must still land in time to stop either action.
 */
export function startHostControl(params: HostControlParams): HostControl {
  let pendingInstall = false;
  let quitHandlerRegistered = false;
  // Set right before quitAndInstall(), so a `failed` transition that
  // follows it synchronously is known to be this same apply attempt.
  let awaitingApplyOutcome = false;

  function canProceed(stage: "pre-download" | "pre-apply"): Promise<boolean> {
    return checkPreAction({
      connection: params.connection,
      stage,
      trustedKeyPem: params.getTrustedKeyPem(),
      log: params.log,
    }).then((policy) => policy?.type !== "held");
  }

  function startDownload(): void {
    void canProceed("pre-download").then((proceed) => {
      if (proceed) params.adapter.downloadUpdate();
    });
  }

  async function applyNow(): Promise<void> {
    const targetVersion = params.adapter.getTargetVersion();
    if (targetVersion !== undefined) {
      await params.recordVersionExpectation(targetVersion);
      awaitingApplyOutcome = true;
    }
    params.adapter.quitAndInstall();
  }

  function registerQuitHandler(): void {
    if (quitHandlerRegistered) return;
    quitHandlerRegistered = true;

    app.on("before-quit", (event) => {
      if (!pendingInstall) return;
      // Cleared before the second app.quit() below so it passes straight
      // through instead of re-entering this same branch.
      pendingInstall = false;
      event.preventDefault();

      void canProceed("pre-apply").then((proceed) => {
        if (proceed) void applyNow();
        else app.quit();
      });
    });
  }

  params.adapter.onStateChange((state) => {
    if (state.type === "available" && params.autoDownload) {
      startDownload();
    }

    if (state.type === "downloaded") {
      pendingInstall = true;
      registerQuitHandler();
    }

    if (state.type === "failed" && awaitingApplyOutcome) {
      awaitingApplyOutcome = false;
      void params.clearVersionExpectation();
    }
  });

  return {
    downloadUpdate(): void {
      if (params.adapter.getAdapterState().type !== "available") return;
      startDownload();
    },
    applyUpdate(): void {
      if (params.adapter.getAdapterState().type !== "downloaded") return;

      // Cleared up front so the before-quit interceptor this triggers (once
      // quitAndInstall() calls app.quit() internally) passes straight
      // through instead of running a second pre-apply check and apply.
      pendingInstall = false;

      void canProceed("pre-apply").then((proceed) => {
        if (proceed) void applyNow();
      });
    },
  };
}
