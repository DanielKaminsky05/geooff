import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localDailyStore } from "./DailyStore";
import type { DailyRunResult } from "../../lib/protocol";

function makeResult(overrides: Partial<DailyRunResult> = {}): DailyRunResult {
  return {
    runId: "run-1",
    dailyDate: "2030-01-01",
    journey: "medium",
    points: 120,
    perPrompt: [],
    gold: 60,
    outcome: "arrived",
    playerId: null,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * A Storage double backed by a Map, optionally throwing on getItem/setItem.
 * We swap the whole `localStorage` global (via vi.stubGlobal) rather than
 * spying a method, because jsdom's native Storage methods aren't reliably
 * overridable with vi.spyOn across environments (CI vs. local) — a spy that
 * silently no-ops lets writes succeed and makes the resilience tests flaky.
 */
function throwingStorage(opts: { getItem?: boolean; setItem?: boolean } = {}): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => {
      if (opts.getItem) throw new Error("blocked");
      return store.has(k) ? store.get(k)! : null;
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => {
      if (opts.setItem) throw new Error("quota");
      store.set(k, String(v));
    },
  };
}

describe("one-and-done invariant", () => {
  it("recordFinished marks the date played AND stores the result", () => {
    const result = makeResult({ dailyDate: "2030-02-02" });
    localDailyStore.recordFinished(result);

    expect(localDailyStore.isPlayedToday("2030-02-02")).toBe(true);
    expect(localDailyStore.getResult("2030-02-02")).toEqual(result);
  });

  it("markPlayed is a no-op when no result is stored (partial-write safety)", () => {
    // No saveResult beforehand.
    localDailyStore.markPlayed("2030-03-03");
    expect(localDailyStore.isPlayedToday("2030-03-03")).toBe(false);
  });

  it("markPlayed locks the date once a result is present", () => {
    const result = makeResult({ dailyDate: "2030-04-04" });
    localDailyStore.saveResult(result);
    expect(localDailyStore.isPlayedToday("2030-04-04")).toBe(false);

    localDailyStore.markPlayed("2030-04-04");
    expect(localDailyStore.isPlayedToday("2030-04-04")).toBe(true);
  });
});

describe("saveResult / getResult", () => {
  it("round-trips the result for a given date", () => {
    const result = makeResult({ dailyDate: "2030-05-05", points: 999 });
    localDailyStore.saveResult(result);
    expect(localDailyStore.getResult("2030-05-05")).toEqual(result);
  });

  it("returns null for a different date", () => {
    localDailyStore.saveResult(makeResult({ dailyDate: "2030-05-05" }));
    expect(localDailyStore.getResult("2030-06-06")).toBeNull();
  });

  it("reports not-played for a date that was never saved", () => {
    expect(localDailyStore.isPlayedToday("2030-07-07")).toBe(false);
  });
});

describe("addGold / getWallet", () => {
  it("starts at zero", () => {
    expect(localDailyStore.getWallet()).toBe(0);
  });

  it("banking gold increases the wallet and returns the new balance", () => {
    expect(localDailyStore.addGold(50)).toBe(50);
    expect(localDailyStore.addGold(25)).toBe(75);
    expect(localDailyStore.getWallet()).toBe(75);
  });

  it("clamps negative amounts to no decrease", () => {
    localDailyStore.addGold(40);
    expect(localDailyStore.addGold(-100)).toBe(40);
    expect(localDailyStore.getWallet()).toBe(40);
  });

  it("rounds fractional amounts", () => {
    expect(localDailyStore.addGold(10.4)).toBe(10);
    expect(localDailyStore.addGold(0.6)).toBe(11);
  });
});

describe("getPlayerId", () => {
  it("returns a stable, non-empty id across calls (persisted)", () => {
    const first = localDailyStore.getPlayerId();
    const second = localDailyStore.getPlayerId();
    expect(first).toBeTruthy();
    expect(typeof first).toBe("string");
    expect(second).toBe(first);
  });
});

describe("resilience when localStorage throws", () => {
  it("getWallet returns the fallback when getItem throws", () => {
    vi.stubGlobal("localStorage", throwingStorage({ getItem: true }));
    expect(localDailyStore.getWallet()).toBe(0);
  });

  it("isPlayedToday returns false when getItem throws", () => {
    vi.stubGlobal("localStorage", throwingStorage({ getItem: true }));
    expect(localDailyStore.isPlayedToday("2030-01-01")).toBe(false);
  });

  it("getResult returns null when getItem throws", () => {
    vi.stubGlobal("localStorage", throwingStorage({ getItem: true }));
    expect(localDailyStore.getResult("2030-01-01")).toBeNull();
  });

  it("addGold does not throw when setItem throws", () => {
    vi.stubGlobal("localStorage", throwingStorage({ setItem: true }));
    expect(() => localDailyStore.addGold(10)).not.toThrow();
  });

  it("recordFinished does not throw when setItem throws, and keeps the invariant (not locked without a stored result)", () => {
    vi.stubGlobal("localStorage", throwingStorage({ setItem: true }));
    const result = makeResult({ dailyDate: "2030-08-08" });
    expect(() => localDailyStore.recordFinished(result)).not.toThrow();
    // The write silently failed, so the date must not read as locked.
    expect(localDailyStore.isPlayedToday("2030-08-08")).toBe(false);
  });

  it("getPlayerId returns a non-empty id even when localStorage throws", () => {
    vi.stubGlobal("localStorage", throwingStorage({ getItem: true, setItem: true }));
    const id = localDailyStore.getPlayerId();
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
  });

  it("saveAnswers/getAnswers round-trips the reveal, keyed per date", () => {
    const answers = {
      "starts-with-i": [
        { iso: "in", name: "India" },
        { iso: "iq", name: "Iraq" },
      ],
      "flag-animal": [{ iso: "lk", name: "Sri Lanka" }],
    };
    localDailyStore.saveAnswers("2030-09-09", answers);
    expect(localDailyStore.getAnswers("2030-09-09")).toEqual(answers);
    // A different date has no stored answers.
    expect(localDailyStore.getAnswers("2030-09-10")).toBeNull();
  });

  it("getAnswers returns null (does not throw) when getItem throws", () => {
    vi.stubGlobal("localStorage", throwingStorage({ getItem: true }));
    expect(localDailyStore.getAnswers("2030-01-01")).toBeNull();
  });
});
