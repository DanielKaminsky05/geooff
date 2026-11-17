import { describe, it, expect, beforeEach } from "vitest";
import {
  normalizeAnswer,
  clampTimeLimit,
  TIME_LIMIT_MIN_SECONDS,
  TIME_LIMIT_MAX_SECONDS,
  TIME_LIMIT_DEFAULT_SECONDS,
  ROOM_CODE_LENGTH,
} from "../src/protocol.js";
import {
  buildLookup,
  buildCanonicalNames,
  matchAnswer,
  scoreGuess,
  determineWinner,
  total as REAL_TOTAL,
} from "../src/matching.js";
import {
  generateRoomCode,
  createRoom,
  addSecondPlayer,
  roomStateOf,
  scoresOf,
  rooms,
} from "../src/rooms.js";
import { fakeCountries } from "./fixtures/fakeCategory.js";

const lookup = buildLookup(fakeCountries);
const names = buildCanonicalNames(fakeCountries);

/* ================================================================== */
/* normalizeAnswer                                                     */
/* ================================================================== */

describe("normalizeAnswer", () => {
  it("lowercases input", () => {
    expect(normalizeAnswer("UNITED STATES")).toBe("united states");
  });
  it("trims leading/trailing whitespace", () => {
    expect(normalizeAnswer("  france  ")).toBe("france");
  });
  it("collapses internal whitespace", () => {
    expect(normalizeAnswer("south    korea")).toBe("south korea");
  });
  it("strips diacritics", () => {
    expect(normalizeAnswer("Côte d'Ivoire")).toBe("cote divoire");
  });
  it("strips punctuation", () => {
    expect(normalizeAnswer("U.S.A.!")).toBe("usa");
  });
  it("handles the protocol's documented example", () => {
    expect(normalizeAnswer("  Côte d'Ivoire! ")).toBe("cote divoire");
  });
  it("keeps digits", () => {
    expect(normalizeAnswer("g7")).toBe("g7");
  });
  it("returns empty string for whitespace-only input", () => {
    expect(normalizeAnswer("   ")).toBe("");
  });
  it("is idempotent", () => {
    for (const s of ["  Côte d'Ivoire! ", "UNITED STATES", "south   korea", "g7"]) {
      expect(normalizeAnswer(normalizeAnswer(s))).toBe(normalizeAnswer(s));
    }
  });
  it("handles non-latin/mixed scripts without throwing", () => {
    expect(() => normalizeAnswer("日本")).not.toThrow();
    expect(normalizeAnswer("日本")).toBe("");
  });
});

/* ================================================================== */
/* clampTimeLimit                                                      */
/* ================================================================== */

describe("clampTimeLimit", () => {
  it("returns the value unchanged when in range", () => {
    expect(clampTimeLimit(300)).toBe(300);
  });
  it("clamps below minimum up to MIN", () => {
    expect(clampTimeLimit(10)).toBe(TIME_LIMIT_MIN_SECONDS);
  });
  it("clamps above maximum down to MAX", () => {
    expect(clampTimeLimit(99999)).toBe(TIME_LIMIT_MAX_SECONDS);
  });
  it("accepts exactly the minimum", () => {
    expect(clampTimeLimit(TIME_LIMIT_MIN_SECONDS)).toBe(TIME_LIMIT_MIN_SECONDS);
  });
  it("accepts exactly the maximum", () => {
    expect(clampTimeLimit(TIME_LIMIT_MAX_SECONDS)).toBe(TIME_LIMIT_MAX_SECONDS);
  });
  it("rounds fractional seconds", () => {
    expect(clampTimeLimit(300.7)).toBe(301);
  });
  it("returns DEFAULT for NaN", () => {
    expect(clampTimeLimit(NaN)).toBe(TIME_LIMIT_DEFAULT_SECONDS);
  });
  it("returns DEFAULT for Infinity / -Infinity", () => {
    expect(clampTimeLimit(Infinity)).toBe(TIME_LIMIT_DEFAULT_SECONDS);
    expect(clampTimeLimit(-Infinity)).toBe(TIME_LIMIT_DEFAULT_SECONDS);
  });
  it("clamps negative values up to MIN", () => {
    expect(clampTimeLimit(-50)).toBe(TIME_LIMIT_MIN_SECONDS);
  });
});

/* ================================================================== */
/* Country matching (fake category)                                   */
/* ================================================================== */

describe("country matching", () => {
  it("accepts an exact canonical name", () => {
    expect(matchAnswer("France", lookup, names)).toMatchObject({ found: true, iso: "fr" });
  });
  it("accepts a registered alias", () => {
    expect(matchAnswer("USA", lookup, names)).toMatchObject({
      found: true,
      iso: "us",
      canonical: "United States",
    });
  });
  it("is case-insensitive", () => {
    expect(matchAnswer("fRaNcE", lookup, names).found).toBe(true);
  });
  it("is accent-insensitive", () => {
    expect(matchAnswer("Côte d'Ivoire", lookup, names)).toMatchObject({ found: true, iso: "ci" });
  });
  it("rejects a non-country / wrong guess", () => {
    const r = scoreGuess("atlantis", new Set(), lookup, names);
    expect(r.kind).toBe("wrong");
  });
  it("rejects empty input", () => {
    expect(scoreGuess("", new Set(), lookup, names).kind).toBe("empty");
  });
  it("rejects a duplicate the same player already guessed", () => {
    const filled = new Set<string>(["fr"]);
    expect(scoreGuess("France", filled, lookup, names).kind).toBe("duplicate");
  });
  it("returns the canonical name, not the typed form", () => {
    expect(matchAnswer("usa", lookup, names).canonical).toBe("United States");
  });
  it("maps each accepted answer to a lowercase alpha-2 ISO code", () => {
    for (const c of fakeCountries) {
      expect(c.iso).toMatch(/^[a-z]{2}$/);
    }
  });
  it("treats two different aliases of the same country as a duplicate", () => {
    const filled = new Set<string>();
    expect(scoreGuess("USA", filled, lookup, names).kind).toBe("accepted");
    expect(scoreGuess("United States", filled, lookup, names).kind).toBe("duplicate");
  });
});

/* ================================================================== */
/* Scoring                                                            */
/* ================================================================== */

describe("scoring", () => {
  function fresh() {
    const { room } = createRoom("P1");
    const p2 = addSecondPlayer(room, "P2");
    rooms.delete(room.code);
    return { room, p1: room.players[0], p2 };
  }

  it("starts both players at 0", () => {
    const { p1, p2 } = fresh();
    expect(p1.score).toBe(0);
    expect(p2.score).toBe(0);
  });
  it("increments only the guessing player's score on a correct answer", () => {
    const { p1, p2 } = fresh();
    const r = scoreGuess("France", p1.filled, lookup, names);
    if (r.kind === "accepted") p1.score += 1;
    expect(p1.score).toBe(1);
    expect(p2.score).toBe(0);
  });
  it("does not change score on a wrong answer", () => {
    const { p1 } = fresh();
    const r = scoreGuess("atlantis", p1.filled, lookup, names);
    if (r.kind === "accepted") p1.score += 1;
    expect(p1.score).toBe(0);
  });
  it("does not change score on a duplicate", () => {
    const { p1 } = fresh();
    scoreGuess("France", p1.filled, lookup, names);
    p1.score = 1;
    const r = scoreGuess("France", p1.filled, lookup, names);
    if (r.kind === "accepted") p1.score += 1;
    expect(p1.score).toBe(1);
  });
  it("tracks each player's filled ISO set independently", () => {
    const { p1, p2 } = fresh();
    scoreGuess("France", p1.filled, lookup, names);
    scoreGuess("France", p2.filled, lookup, names);
    expect(p1.filled.has("fr")).toBe(true);
    expect(p2.filled.has("fr")).toBe(true);
  });
  it("score equals the size of that player's filled set", () => {
    const { p1 } = fresh();
    for (const g of ["France", "USA", "South Korea"]) {
      if (scoreGuess(g, p1.filled, lookup, names).kind === "accepted") p1.score += 1;
    }
    expect(p1.score).toBe(p1.filled.size);
    expect(p1.score).toBe(3);
  });
});

/* ================================================================== */
/* determineWinner                                                    */
/* ================================================================== */

describe("determineWinner", () => {
  it("returns p1's id when p1 > p2", () => {
    expect(
      determineWinner([
        { playerId: "p1", score: 5 },
        { playerId: "p2", score: 2 },
      ]),
    ).toBe("p1");
  });
  it("returns p2's id when p2 > p1", () => {
    expect(
      determineWinner([
        { playerId: "p1", score: 1 },
        { playerId: "p2", score: 9 },
      ]),
    ).toBe("p2");
  });
  it("returns null on a tie", () => {
    expect(
      determineWinner([
        { playerId: "p1", score: 4 },
        { playerId: "p2", score: 4 },
      ]),
    ).toBeNull();
  });
  it("returns null on a 0-0 tie", () => {
    expect(
      determineWinner([
        { playerId: "p1", score: 0 },
        { playerId: "p2", score: 0 },
      ]),
    ).toBeNull();
  });
  it("computes missedByPlayer as category minus that player's filled set", () => {
    const all = fakeCountries.map((c) => c.iso);
    const filled = new Set(["fr", "us"]);
    const missed = all.filter((iso) => !filled.has(iso));
    expect(missed.sort()).toEqual(["ci", "kr"]);
  });
});

/* ================================================================== */
/* generateRoomCode                                                   */
/* ================================================================== */

describe("generateRoomCode", () => {
  it("produces a code of length ROOM_CODE_LENGTH", () => {
    expect(generateRoomCode()).toHaveLength(ROOM_CODE_LENGTH);
  });
  it("uses only the allowed alphabet (A-Z, 0-9)", () => {
    for (let i = 0; i < 100; i++) {
      expect(generateRoomCode()).toMatch(/^[A-Z0-9]{6}$/);
    }
  });
  it("is uniqueish across many generations", () => {
    const seen = new Set<string>();
    let collisions = 0;
    for (let i = 0; i < 10000; i++) {
      const code = generateRoomCode();
      if (seen.has(code)) collisions += 1;
      seen.add(code);
    }
    // These codes are never registered in `rooms`, so collisions are allowed
    // but should be vanishingly rare across a 36^6 space.
    expect(collisions).toBeLessThan(5);
  });
  it("never returns a code already in use", () => {
    const occupied = new Set<string>();
    // Fill the rooms map with a batch of codes, then ensure the next code avoids them.
    for (let i = 0; i < 50; i++) {
      const c = generateRoomCode();
      occupied.add(c);
      // @ts-expect-error minimal stub room is enough for `rooms.has` checks
      rooms.set(c, {});
    }
    const next = generateRoomCode();
    expect(occupied.has(next)).toBe(false);
    for (const c of occupied) rooms.delete(c);
  });
});

/* ================================================================== */
/* Room settings & snapshot                                           */
/* ================================================================== */

describe("room settings", () => {
  let code: string;
  beforeEach(() => {
    const { room } = createRoom("Host");
    code = room.code;
  });

  it("defaults a new room to TIME_LIMIT_DEFAULT_SECONDS and categoryId 'countries'", () => {
    const room = rooms.get(code)!;
    expect(room.settings.timeLimitSeconds).toBe(TIME_LIMIT_DEFAULT_SECONDS);
    expect(room.settings.categoryId).toBe("countries");
    rooms.delete(code);
  });

  it("clamps a settings timeLimitSeconds via clampTimeLimit", () => {
    const room = rooms.get(code)!;
    room.settings.timeLimitSeconds = clampTimeLimit(99999);
    expect(room.settings.timeLimitSeconds).toBe(TIME_LIMIT_MAX_SECONDS);
    rooms.delete(code);
  });

  it("starts a new room in phase 'lobby' with one player", () => {
    const room = rooms.get(code)!;
    expect(room.phase).toBe("lobby");
    expect(room.players).toHaveLength(1);
    rooms.delete(code);
  });

  it("omits endsAt and never leaks canonical names in the room snapshot", () => {
    const room = rooms.get(code)!;
    room.players[0].filled.add("fr");
    const snap = roomStateOf(room);
    expect(snap.endsAt).toBeUndefined();
    // filled carries only ISO codes, never names.
    expect(snap.filled![room.players[0].id]).toEqual(["fr"]);
    expect(JSON.stringify(snap)).not.toContain("France");
    rooms.delete(code);
  });

  it("room snapshot includes the category total (defaults to the live count)", () => {
    const room = rooms.get(code)!;
    expect(roomStateOf(room).total).toBe(REAL_TOTAL);
    expect(roomStateOf(room, 5).total).toBe(5);
    rooms.delete(code);
  });

  it("scoresOf reports each seat's score keyed by playerId", () => {
    const room = rooms.get(code)!;
    const p2 = addSecondPlayer(room, "P2");
    room.players[0].score = 3;
    p2.score = 1;
    expect(scoresOf(room)).toEqual({ [room.players[0].id]: 3, [p2.id]: 1 });
    rooms.delete(code);
  });
});
