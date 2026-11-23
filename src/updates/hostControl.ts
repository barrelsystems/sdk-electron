import { app } from "electron";
import type { UpdaterAdapter } from "./adapters/updaterAdapter.js";
import type { UpdateEligibility } from "./models/eligibility.js";
import type { UpdateState } from "./models/state.js";
import { ActionError } from "./models/actionError.js";
import { checkPreAction } from "./protocol/preActionCheck.js";
import type { BackendConnection } from "./protocol/wireTypes.js";

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
  onEligibility?: ((eligibility: UpdateEligibility) => void) | undefined;
  log?: ((message: string) => void) | undefined;
}

export interface HostControl {
  downloadUpdate(): Promise<void>;
  applyUpdate(): Promise<void>;
  settled(): Promise<void>;
}

/** Fresh eligibility gates actions; automatic denials never reject into the host event loop. */
export function startHostControl(params: HostControlParams): HostControl {
  const pending = new Set<Promise<void>>();
  let action: "download" | "apply" | undefined;
  let pendingInstall = false;
  let quitHandlerRegistered = false;
  let awaitingApplyOutcome = false;
  let activeOperation: Promise<void> | undefined;
  let settleDownload: ((state: UpdateState) => void) | undefined;

  function track(operation: Promise<void>): Promise<void> {
    pending.add(operation);
    activeOperation = operation;
    function finished(): void {
      pending.delete(operation);
      if (activeOperation === operation) activeOperation = undefined;
    }
    void operation.then(finished, finished);
    return operation;
  }

  async function canProceed(stage: "pre-download" | "pre-apply"): Promise<boolean> {
    const eligibility = await checkPreAction({
      connection: params.connection,
      stage,
      trustedKeyPem: params.getTrustedKeyPem(),
      log: params.log,
    });
    if (eligibility) params.onEligibility?.(eligibility);

    return eligibility?.type !== "held";
  }

  function downloadOutcome(state: UpdateState): Error | true | undefined {
    if (state.type === "downloaded") return true;
    if (state.type === "update-cancelled") return new ActionError("cancelled");
    if (state.type === "failed")
      return new ActionError("failed", params.adapter.getLastUpdateError());

    return undefined;
  }

  async function downloadUpdate(): Promise<void> {
    if (action) throw new ActionError("alreadyInProgress");
    if (params.adapter.getUpdateState().type !== "available")
      throw new ActionError("noUpdateAvailable");

    action = "download";
    try {
      if (!(await canProceed("pre-download"))) throw new ActionError("held");

      await new Promise<void>((resolve, reject) => {
        settleDownload = (state) => {
          const outcome = downloadOutcome(state);
          if (outcome === true) resolve();
          else if (outcome) reject(outcome);
        };
        params.adapter.downloadUpdate();
        settleDownload(params.adapter.getUpdateState());
      });
    } finally {
      settleDownload = undefined;
      action = undefined;
    }
  }

  async function applyNow(): Promise<void> {
    const targetVersion = params.adapter.getTargetVersion();
    if (targetVersion !== undefined) {
      await params.recordVersionExpectation(targetVersion);
      awaitingApplyOutcome = true;
    }
    await params.adapter.quitAndInstall();
    if (params.adapter.getUpdateState().type === "failed") {
      throw new ActionError("failed", params.adapter.getLastUpdateError());
    }
  }

  async function applyUpdate(): Promise<void> {
    if (action) throw new ActionError("alreadyInProgress");
    if (params.adapter.getUpdateState().type !== "downloaded")
      throw new ActionError("nothingDownloadedYet");

    action = "apply";
    try {
      if (!(await canProceed("pre-apply"))) throw new ActionError("held");

      pendingInstall = false;
      await applyNow();
    } finally {
      action = undefined;
    }
  }

  function registerQuitHandler(): void {
    if (quitHandlerRegistered) return;

    quitHandlerRegistered = true;
    app.on("before-quit", (event) => {
      if (!pendingInstall) return;

      pendingInstall = false;
      event.preventDefault();
      const existingAction = activeOperation;
      void track(
        (async () => {
          await existingAction;
          if (params.adapter.getUpdateState().type === "downloaded") await applyUpdate();
          else app.quit();
        })(),
      ).catch(() => app.quit());
    });
  }

  params.adapter.onStateChange((state) => {
    settleDownload?.(state);
    if (state.type === "available" && params.autoDownload && !action) {
      void track(downloadUpdate()).catch(() => {});
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
    async settled() {
      while (pending.size > 0) await Promise.allSettled(pending);
    },
    downloadUpdate: () => track(downloadUpdate()),
    applyUpdate: () => track(applyUpdate()),
  };
}
