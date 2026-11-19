import { afterEach, describe, expect, it, vi } from "vitest";
import { sendCheckIn, type CheckInParams } from "./checkIn.js";

const baseParams: CheckInParams = {
  baseUrl: "https://ingest.example.com",
  credential: "cred",
  installationId: "11111111-1111-1111-1111-111111111111",
  sdkVersion: "0.0.1",
  observedVersion: "1.0.0",
  platform: "darwin",
  arch: "arm64",
  osVersion: "24.0.0",
  attributes: {},
  adapterState: { type: "idle" },
  bufferedFacts: [],
};

describe("sendCheckIn", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the parsed response on success", async () => {
    const mockResponse = { protocolVersion: 1, policy: "{}", signature: "sig" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockResponse) }),
    );

    expect(await sendCheckIn(baseParams)).toEqual(mockResponse);
  });

  it("sends protocolVersion, a fresh eventId, and an empty bufferedFacts", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);

    await sendCheckIn(baseParams);
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(call[1].body as string);
    expect(body.protocolVersion).toBe(1);
    expect(body.bufferedFacts).toEqual([]);
    expect(typeof body.eventId).toBe("string");
  });

  it("sends an adapterState fact verbatim", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);

    const bufferedFacts: CheckInParams["bufferedFacts"] = [
      {
        kind: "adapterState",
        state: { type: "checking" },
        firstObservedAt: "2026-01-01T00:00:00.000Z",
        lastObservedAt: "2026-01-01T00:00:00.000Z",
        occurrenceCount: 1,
      },
    ];

    await sendCheckIn({ ...baseParams, bufferedFacts });
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(call[1].body as string);
    expect(body.bufferedFacts).toEqual(bufferedFacts);
  });

  it("flattens an updateError fact's failure fields onto the wire shape the backend expects", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);

    const bufferedFacts: CheckInParams["bufferedFacts"] = [
      {
        kind: "updateError",
        failure: {
          phase: "download",
          failureMode: "manifest-unreachable",
          title: "Update server unreachable",
          platform: "electron-updater",
          platformCode: "ENOTFOUND",
        },
        firstObservedAt: "2026-01-01T00:00:00.000Z",
        lastObservedAt: "2026-01-01T00:00:00.000Z",
        occurrenceCount: 1,
      },
    ];

    await sendCheckIn({ ...baseParams, bufferedFacts });
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(call[1].body as string);
    // The backend's schema has no `failure`/`title`/`platform` fields --
    // nesting them (the internal, on-disk shape) made every check-in after
    // a buffered update error fail its own schema validation.
    expect(body.bufferedFacts).toEqual([
      {
        kind: "updateError",
        phase: "download",
        failureMode: "manifest-unreachable",
        platformCode: "ENOTFOUND",
        firstObservedAt: "2026-01-01T00:00:00.000Z",
        lastObservedAt: "2026-01-01T00:00:00.000Z",
        occurrenceCount: 1,
      },
    ]);
  });

  it("fails open (undefined) on a non-2xx response, without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);

    expect(await sendCheckIn(baseParams)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails open (undefined) on a network error, without retrying", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    expect(await sendCheckIn(baseParams)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds attributes before sending", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);

    await sendCheckIn({ ...baseParams, attributes: { key: "x".repeat(300) } });
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(call[1].body as string);
    expect(Buffer.byteLength(body.attributes.key, "utf8")).toBeLessThanOrEqual(256);
  });

  it("fails open (undefined) on a response with an unrecognized protocolVersion", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ protocolVersion: 2, policy: "{}", signature: "sig" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await sendCheckIn(baseParams)).toBeUndefined();
  });
});
