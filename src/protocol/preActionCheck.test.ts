import { afterEach, describe, expect, it, vi } from "vitest";
import type { Policy } from "../types.js";

const verifyAndParsePolicy = vi.hoisted(() =>
  vi.fn<(response: unknown, key: string) => Policy | undefined>(),
);
vi.mock("./policy.js", () => ({ verifyAndParsePolicy }));

describe("checkPreAction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  const baseParams = {
    connection: {
      baseUrl: "https://ingest.example.com",
      credential: "cred",
      installationId: "11111111-1111-1111-1111-111111111111",
    },
    stage: "pre-download" as const,
    trustedKeyPem: "trusted-key-pem",
  };

  it("sends protocolVersion, installationId, and stage -- nothing else", async () => {
    const { checkPreAction } = await import("./preActionCheck.js");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);

    await checkPreAction(baseParams);

    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe("https://ingest.example.com/pre-action-check");
    const body = JSON.parse(call[1].body as string);
    expect(body).toEqual({
      protocolVersion: 1,
      installationId: baseParams.connection.installationId,
      stage: "pre-download",
    });
  });

  it("returns whatever policy.js's verification resolves to", async () => {
    const { checkPreAction } = await import("./preActionCheck.js");
    verifyAndParsePolicy.mockReturnValue({
      type: "held",
      issuedAt: "2026-01-01T00:00:00Z",
      environment: "production",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ protocolVersion: 1, policy: "{}", signature: "sig" }),
      }),
    );

    const result = await checkPreAction(baseParams);
    expect(result).toMatchObject({ type: "held" });
  });

  it("fails open (undefined) on a non-2xx response, without retrying", async () => {
    const { checkPreAction } = await import("./preActionCheck.js");
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);

    expect(await checkPreAction(baseParams)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails open (undefined) on a network error, without retrying", async () => {
    const { checkPreAction } = await import("./preActionCheck.js");
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    expect(await checkPreAction(baseParams)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails open (undefined) on a response with an unrecognized protocolVersion", async () => {
    const { checkPreAction } = await import("./preActionCheck.js");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ protocolVersion: 2, policy: "{}", signature: "sig" }),
      }),
    );

    expect(await checkPreAction(baseParams)).toBeUndefined();
    expect(verifyAndParsePolicy).not.toHaveBeenCalled();
  });

  it("verifies against the caller-supplied trusted key, not a hardcoded one", async () => {
    const { checkPreAction } = await import("./preActionCheck.js");
    verifyAndParsePolicy.mockReturnValue({
      type: "current",
      issuedAt: "2026-01-01T00:00:00Z",
      environment: "production",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ protocolVersion: 1, policy: "{}", signature: "sig" }),
      }),
    );

    await checkPreAction({ ...baseParams, trustedKeyPem: "a-rotated-key-pem" });

    expect(verifyAndParsePolicy).toHaveBeenCalledWith(expect.anything(), "a-rotated-key-pem");
  });

  it("fails open (undefined) when policy.js's verification rejects the response", async () => {
    const { checkPreAction } = await import("./preActionCheck.js");
    verifyAndParsePolicy.mockReturnValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ protocolVersion: 1, policy: "{}", signature: "sig" }),
      }),
    );

    expect(await checkPreAction(baseParams)).toBeUndefined();
  });
});
