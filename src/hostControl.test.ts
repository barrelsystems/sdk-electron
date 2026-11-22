import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterState, Policy } from "./types.js";

const appOn = vi.fn();
const appQuit = vi.fn();
const checkPreAction = vi.hoisted(() => vi.fn<(params: unknown) => Promise<Policy | undefined>>());

vi.mock("electron", () => ({ app: { on: appOn, quit: appQuit } }));
vi.mock("./protocol/preActionCheck.js", () => ({ checkPreAction }));

function stubPolicy(type: "current" | "held"): void {
  checkPreAction.mockResolvedValue({ type, issuedAt: "2026-01-01T00:00:00Z", environment: "test" });
}

function createFakeAdapter({
  initialState = { type: "idle" },
  targetVersion = undefined,
}: {
  initialState?: AdapterState;
  targetVersion?: string | undefined;
} = {}) {
  let state = initialState;
  let listener: ((state: AdapterState) => void) | undefined;

  return {
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
    getAdapterState: () => state,
    getLastUpdateError: () => undefined,
    getTargetVersion: () => targetVersion,
    onStateChange: (newListener: (state: AdapterState) => void) => {
      listener = newListener;
    },
    emit(newState: AdapterState) {
      state = newState;
      listener?.(newState);
    },
  };
}

function captureBeforeQuitHandler(): (event: { preventDefault: () => void }) => void {
  const call = appOn.mock.calls.find(([event]) => event === "before-quit");
  if (call === undefined) throw new Error("before-quit was never registered");
  return call[1] as (event: { preventDefault: () => void }) => void;
}

describe("startHostControl", () => {
  beforeEach(() => {
    appOn.mockClear();
    appQuit.mockClear();
    checkPreAction.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads automatically on 'available' when autoDownload is on and the Policy isn't held", async () => {
    const { startHostControl } = await import("./hostControl.js");
    stubPolicy("current");
    const adapter = createFakeAdapter();

    startHostControl({
      connection: {
        baseUrl: "https://ingest.example.com",
        credential: "cred",
        installationId: "id",
      },
      autoDownload: true,
      adapter,
      getTrustedKeyPem: () => "trusted-key-pem",
      recordVersionExpectation: vi.fn(),
      clearVersionExpectation: vi.fn(),
    });

    adapter.emit({ type: "available" });
    await vi.waitFor(() => expect(adapter.downloadUpdate).toHaveBeenCalledTimes(1));
  });

  it("never downloads when autoDownload is off", async () => {
    const { startHostControl } = await import("./hostControl.js");
    stubPolicy("current");
    const adapter = createFakeAdapter();

    startHostControl({
      connection: {
        baseUrl: "https://ingest.example.com",
        credential: "cred",
        installationId: "id",
      },
      autoDownload: false,
      adapter,
      getTrustedKeyPem: () => "trusted-key-pem",
      recordVersionExpectation: vi.fn(),
      clearVersionExpectation: vi.fn(),
    });

    adapter.emit({ type: "available" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(adapter.downloadUpdate).not.toHaveBeenCalled();
  });

  it("does not download when a fresh pre-action-check reports a Hold", async () => {
    const { startHostControl } = await import("./hostControl.js");
    stubPolicy("held");
    const adapter = createFakeAdapter();

    startHostControl({
      connection: {
        baseUrl: "https://ingest.example.com",
        credential: "cred",
        installationId: "id",
      },
      autoDownload: true,
      adapter,
      getTrustedKeyPem: () => "trusted-key-pem",
      recordVersionExpectation: vi.fn(),
      clearVersionExpectation: vi.fn(),
    });

    adapter.emit({ type: "available" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(adapter.downloadUpdate).not.toHaveBeenCalled();
  });

  it("on natural quit, installs a downloaded update once pre-apply check clears it", async () => {
    const { startHostControl } = await import("./hostControl.js");
    stubPolicy("current");
    const adapter = createFakeAdapter();

    startHostControl({
      connection: {
        baseUrl: "https://ingest.example.com",
        credential: "cred",
        installationId: "id",
      },
      autoDownload: true,
      adapter,
      getTrustedKeyPem: () => "trusted-key-pem",
      recordVersionExpectation: vi.fn(),
      clearVersionExpectation: vi.fn(),
    });

    adapter.emit({ type: "downloaded" });
    const preventDefault = vi.fn();
    captureBeforeQuitHandler()({ preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(adapter.quitAndInstall).toHaveBeenCalledTimes(1));
    expect(appQuit).not.toHaveBeenCalled();
  });

  it("records the version-expectation marker right before quitAndInstall(), on natural quit", async () => {
    const { startHostControl } = await import("./hostControl.js");
    stubPolicy("current");
    const adapter = createFakeAdapter({ initialState: { type: "idle" }, targetVersion: "2.0.0" });
    const recordVersionExpectation = vi.fn();

    startHostControl({
      connection: {
        baseUrl: "https://ingest.example.com",
        credential: "cred",
        installationId: "id",
      },
      autoDownload: true,
      adapter,
      getTrustedKeyPem: () => "trusted-key-pem",
      recordVersionExpectation,
      clearVersionExpectation: vi.fn(),
    });

    adapter.emit({ type: "downloaded" });
    captureBeforeQuitHandler()({ preventDefault: vi.fn() });

    await vi.waitFor(() => expect(adapter.quitAndInstall).toHaveBeenCalledTimes(1));
    expect(recordVersionExpectation).toHaveBeenCalledExactlyOnceWith("2.0.0");
  });

  it("awaits the version-expectation write before calling quitAndInstall() -- never fire-and-forget", async () => {
    const { startHostControl } = await import("./hostControl.js");
    stubPolicy("current");
    const adapter = createFakeAdapter({ initialState: { type: "idle" }, targetVersion: "2.0.0" });
    let resolveWrite: () => void = () => {};
    const recordVersionExpectation = vi.fn(
      () => new Promise<void>((resolve) => (resolveWrite = resolve)),
    );

    startHostControl({
      connection: {
        baseUrl: "https://ingest.example.com",
        credential: "cred",
        installationId: "id",
      },
      autoDownload: true,
      adapter,
      getTrustedKeyPem: () => "trusted-key-pem",
      recordVersionExpectation,
      clearVersionExpectation: vi.fn(),
    });

    adapter.emit({ type: "downloaded" });
    captureBeforeQuitHandler()({ preventDefault: vi.fn() });

    await vi.waitFor(() => expect(recordVersionExpectation).toHaveBeenCalledTimes(1));
    expect(adapter.quitAndInstall).not.toHaveBeenCalled();

    resolveWrite();
    await vi.waitFor(() => expect(adapter.quitAndInstall).toHaveBeenCalledTimes(1));
  });

  it("clears the version expectation when this session's own code already classified the apply failure", async () => {
    const { startHostControl } = await import("./hostControl.js");
    stubPolicy("current");
    const adapter = createFakeAdapter({ initialState: { type: "idle" }, targetVersion: "2.0.0" });
    const clearVersionExpectation = vi.fn();

    startHostControl({
      connection: {
        baseUrl: "https://ingest.example.com",
        credential: "cred",
        installationId: "id",
      },
      autoDownload: true,
      adapter,
      getTrustedKeyPem: () => "trusted-key-pem",
      recordVersionExpectation: vi.fn(),
      clearVersionExpectation,
    });

    adapter.emit({ type: "downloaded" });
    captureBeforeQuitHandler()({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(adapter.quitAndInstall).toHaveBeenCalledTimes(1));

    // Simulates the adapter's own 'error' listener classifying a real,
    // synchronous install failure right after quitAndInstall() was called.
    adapter.emit({
      type: "failed",
      category: "updater",
      code: "install-write-failed",
      platformCode: "EACCES",
    });

    expect(clearVersionExpectation).toHaveBeenCalledTimes(1);
  });

  it("never records a version expectation when the adapter has no target version", async () => {
    const { startHostControl } = await import("./hostControl.js");
    stubPolicy("current");
    const adapter = createFakeAdapter({ initialState: { type: "idle" } });
    const recordVersionExpectation = vi.fn();

    startHostControl({
      connection: {
        baseUrl: "https://ingest.example.com",
        credential: "cred",
        installationId: "id",
      },
      autoDownload: true,
      adapter,
      getTrustedKeyPem: () => "trusted-key-pem",
      recordVersionExpectation,
      clearVersionExpectation: vi.fn(),
    });

    adapter.emit({ type: "downloaded" });
    captureBeforeQuitHandler()({ preventDefault: vi.fn() });

    await vi.waitFor(() => expect(adapter.quitAndInstall).toHaveBeenCalledTimes(1));
    expect(recordVersionExpectation).not.toHaveBeenCalled();
  });

  it("on natural quit, a Hold since the last check-in lets the app quit without installing", async () => {
    const { startHostControl } = await import("./hostControl.js");
    stubPolicy("held");
    const adapter = createFakeAdapter();

    startHostControl({
      connection: {
        baseUrl: "https://ingest.example.com",
        credential: "cred",
        installationId: "id",
      },
      autoDownload: true,
      adapter,
      getTrustedKeyPem: () => "trusted-key-pem",
      recordVersionExpectation: vi.fn(),
      clearVersionExpectation: vi.fn(),
    });

    adapter.emit({ type: "downloaded" });
    captureBeforeQuitHandler()({ preventDefault: vi.fn() });

    await vi.waitFor(() => expect(appQuit).toHaveBeenCalledTimes(1));
    expect(adapter.quitAndInstall).not.toHaveBeenCalled();
  });

  it("applyUpdate() is a no-op when nothing has downloaded yet", async () => {
    const { startHostControl } = await import("./hostControl.js");
    const adapter = createFakeAdapter({ initialState: { type: "idle" } });

    const control = startHostControl({
      connection: {
        baseUrl: "https://ingest.example.com",
        credential: "cred",
        installationId: "id",
      },
      autoDownload: true,
      adapter,
      getTrustedKeyPem: () => "trusted-key-pem",
      recordVersionExpectation: vi.fn(),
      clearVersionExpectation: vi.fn(),
    });

    control.applyUpdate();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(adapter.quitAndInstall).not.toHaveBeenCalled();
  });

  it("applyUpdate() installs immediately once something is downloaded, ahead of natural quit", async () => {
    const { startHostControl } = await import("./hostControl.js");
    stubPolicy("current");
    const adapter = createFakeAdapter({ initialState: { type: "downloaded" } });

    const control = startHostControl({
      connection: {
        baseUrl: "https://ingest.example.com",
        credential: "cred",
        installationId: "id",
      },
      autoDownload: true,
      adapter,
      getTrustedKeyPem: () => "trusted-key-pem",
      recordVersionExpectation: vi.fn(),
      clearVersionExpectation: vi.fn(),
    });

    control.applyUpdate();
    await vi.waitFor(() => expect(adapter.quitAndInstall).toHaveBeenCalledTimes(1));
  });

  it("records the version-expectation marker right before quitAndInstall(), on a host-triggered applyUpdate()", async () => {
    const { startHostControl } = await import("./hostControl.js");
    stubPolicy("current");
    const adapter = createFakeAdapter({
      initialState: { type: "downloaded" },
      targetVersion: "2.0.0",
    });
    const recordVersionExpectation = vi.fn();

    const control = startHostControl({
      connection: {
        baseUrl: "https://ingest.example.com",
        credential: "cred",
        installationId: "id",
      },
      autoDownload: true,
      adapter,
      getTrustedKeyPem: () => "trusted-key-pem",
      recordVersionExpectation,
      clearVersionExpectation: vi.fn(),
    });

    control.applyUpdate();
    await vi.waitFor(() => expect(adapter.quitAndInstall).toHaveBeenCalledTimes(1));
    expect(recordVersionExpectation).toHaveBeenCalledExactlyOnceWith("2.0.0");
  });

  it("applyUpdate(), triggered after a natural 'downloaded' transition, installs only once -- quitAndInstall()'s own quit sequence must not re-trigger the before-quit interceptor", async () => {
    const { startHostControl } = await import("./hostControl.js");
    stubPolicy("current");
    const adapter = createFakeAdapter();

    const control = startHostControl({
      connection: {
        baseUrl: "https://ingest.example.com",
        credential: "cred",
        installationId: "id",
      },
      autoDownload: true,
      adapter,
      getTrustedKeyPem: () => "trusted-key-pem",
      recordVersionExpectation: vi.fn(),
      clearVersionExpectation: vi.fn(),
    });

    // Arms pendingInstall and the before-quit interceptor, exactly as a real
    // natural-quit flow would before a host calls applyUpdate() early.
    adapter.emit({ type: "downloaded" });

    control.applyUpdate();
    await vi.waitFor(() => expect(adapter.quitAndInstall).toHaveBeenCalledTimes(1));

    // quitAndInstall() triggers Electron's own quit sequence, which would
    // fire this same before-quit handler again in a real app.
    const preventDefault = vi.fn();
    captureBeforeQuitHandler()({ preventDefault });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(preventDefault).not.toHaveBeenCalled();
    expect(adapter.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("downloadUpdate() is a no-op when nothing is available yet", async () => {
    const { startHostControl } = await import("./hostControl.js");
    const adapter = createFakeAdapter({ initialState: { type: "idle" } });

    const control = startHostControl({
      connection: {
        baseUrl: "https://ingest.example.com",
        credential: "cred",
        installationId: "id",
      },
      autoDownload: false,
      adapter,
      getTrustedKeyPem: () => "trusted-key-pem",
      recordVersionExpectation: vi.fn(),
      clearVersionExpectation: vi.fn(),
    });

    control.downloadUpdate();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(adapter.downloadUpdate).not.toHaveBeenCalled();
  });

  it("downloadUpdate() triggers a download once an update is available, even with autoDownload off", async () => {
    const { startHostControl } = await import("./hostControl.js");
    stubPolicy("current");
    const adapter = createFakeAdapter({ initialState: { type: "available" } });

    const control = startHostControl({
      connection: {
        baseUrl: "https://ingest.example.com",
        credential: "cred",
        installationId: "id",
      },
      autoDownload: false,
      adapter,
      getTrustedKeyPem: () => "trusted-key-pem",
      recordVersionExpectation: vi.fn(),
      clearVersionExpectation: vi.fn(),
    });

    control.downloadUpdate();
    await vi.waitFor(() => expect(adapter.downloadUpdate).toHaveBeenCalledTimes(1));
  });

  it("downloadUpdate() does not download when a fresh pre-action-check reports a Hold", async () => {
    const { startHostControl } = await import("./hostControl.js");
    stubPolicy("held");
    const adapter = createFakeAdapter({ initialState: { type: "available" } });

    const control = startHostControl({
      connection: {
        baseUrl: "https://ingest.example.com",
        credential: "cred",
        installationId: "id",
      },
      autoDownload: false,
      adapter,
      getTrustedKeyPem: () => "trusted-key-pem",
      recordVersionExpectation: vi.fn(),
      clearVersionExpectation: vi.fn(),
    });

    control.downloadUpdate();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(adapter.downloadUpdate).not.toHaveBeenCalled();
  });
});
