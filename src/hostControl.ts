import { app } from "electron";
import type { UpdaterAdapter } from "./adapters/electronUpdaterAdapter.js";
import { checkPreAction } from "./protocol/preActionCheck.js";

export interface HostControlParams {
  baseUrl: string;
  credential: string;
  installationId: string;
  autoDownload: boolean;
  adapter: UpdaterAdapter;
  getTrustedKeyPem: () => string;
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

  function canProceed(stage: "pre-download" | "pre-apply"): Promise<boolean> {
    return checkPreAction({
      baseUrl: params.baseUrl,
      credential: params.credential,
      installationId: params.installationId,
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
        if (proceed) params.adapter.quitAndInstall();
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
        if (proceed) params.adapter.quitAndInstall();
      });
    },
  };
}
