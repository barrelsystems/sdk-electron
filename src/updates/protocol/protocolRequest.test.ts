import { afterEach, describe, expect, it, vi } from "vitest";
import { postProtocolRequest } from "./protocolRequest.js";

describe("postProtocolRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const baseParams = {
    url: "https://ingest.example.com/check-in",
    credential: "cred",
    body: { hello: "world" },
    timeoutMs: 10_000,
    label: "check-in",
  };

  it("POSTs the body as JSON with a bearer-credential header, and returns the parsed response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ protocolVersion: 1, updateEligibility: "{}", signature: "sig" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await postProtocolRequest(baseParams);

    expect(result).toEqual({ protocolVersion: 1, updateEligibility: "{}", signature: "sig" });
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe(baseParams.url);
    expect(call[1].method).toBe("POST");
    expect(call[1].headers).toMatchObject({ authorization: "Bearer cred" });
    expect(JSON.parse(call[1].body as string)).toEqual(baseParams.body);
  });

  it("fails open (undefined) on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    expect(await postProtocolRequest(baseParams)).toBeUndefined();
  });

  it("fails open (undefined) on a response with an unrecognized protocolVersion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ protocolVersion: 2, updateEligibility: "{}", signature: "sig" }),
      }),
    );
    expect(await postProtocolRequest(baseParams)).toBeUndefined();
  });

  it("fails open (undefined) on a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await postProtocolRequest(baseParams)).toBeUndefined();
  });

  it("aborts and fails open once the timeout elapses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }),
    );

    const result = await postProtocolRequest({ ...baseParams, timeoutMs: 5 });
    expect(result).toBeUndefined();
  });
});
