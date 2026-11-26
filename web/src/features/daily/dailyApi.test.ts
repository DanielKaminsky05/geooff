import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDailySet, postAnswer, postFinish, RateLimitedError } from "./dailyApi";
import { FIXTURE_DAILY_SET, todayIso } from "./contract";
import type { DailyAnswerRes, DailyFinishRes } from "./contract";

function mockFetch(impl: (input: string, init?: RequestInit) => Partial<Response> | Promise<Partial<Response>>) {
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => impl(input, init) as Response));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchDailySet", () => {
  it("returns the server set on success", async () => {
    const serverSet = { ...FIXTURE_DAILY_SET, dailyDate: "2030-01-01" };
    mockFetch(() => ({ ok: true, status: 200, json: async () => serverSet }));
    const set = await fetchDailySet();
    expect(set.dailyDate).toBe("2030-01-01");
  });

  it("falls back to the fixture on HTTP failure (and warns)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFetch(() => ({ ok: false, status: 500, json: async () => ({}) }));
    const set = await fetchDailySet();
    // Fixture content, re-stamped with today so the one-and-done lock stays correct.
    expect(set).toEqual({ ...FIXTURE_DAILY_SET, dailyDate: todayIso() });
    expect(warn).toHaveBeenCalled();
  });

  it("falls back to the fixture on a network error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const set = await fetchDailySet();
    expect(set).toEqual({ ...FIXTURE_DAILY_SET, dailyDate: todayIso() });
  });
});

describe("postAnswer", () => {
  it("returns the parsed answer response", async () => {
    const body: DailyAnswerRes = { valid: true, iso: "BR", name: "Brazil", points: 10, promptTotal: 42 };
    mockFetch(() => ({ ok: true, status: 200, json: async () => body }));
    const res = await postAnswer({ dailyDate: "d", promptId: "p", answer: "brazil" });
    expect(res).toEqual(body);
  });

  it("throws RateLimitedError on a 429 (soft slow-down, not a crash)", async () => {
    mockFetch(() => ({ ok: false, status: 429, json: async () => ({}) }));
    await expect(
      postAnswer({ dailyDate: "d", promptId: "p", answer: "x" }),
    ).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("throws on other HTTP failures", async () => {
    mockFetch(() => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(
      postAnswer({ dailyDate: "d", promptId: "p", answer: "x" }),
    ).rejects.toThrow();
  });
});

describe("postFinish", () => {
  it("returns the reconciled result + percentile", async () => {
    const body: DailyFinishRes = {
      percentile: 73,
      result: {
        runId: "r",
        dailyDate: "d",
        journey: "medium",
        points: 120,
        perPrompt: [],
        gold: 60,
        outcome: "arrived",
        playerId: null,
      },
    };
    mockFetch(() => ({ ok: true, status: 200, json: async () => body }));
    const res = await postFinish({ result: body.result });
    expect(res.percentile).toBe(73);
    expect(res.result.outcome).toBe("arrived");
  });
});
