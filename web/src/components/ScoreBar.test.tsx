import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import ScoreBar from "./ScoreBar";
import type { PlayerPublic } from "../lib/protocol";

const p1: PlayerPublic = {
  id: "a",
  slot: "p1",
  name: "Alice",
  connected: true,
  ready: true,
  score: 0,
};
const p2: PlayerPublic = {
  id: "b",
  slot: "p2",
  name: "Bob",
  connected: true,
  ready: true,
  score: 0,
};

describe("ScoreBar", () => {
  it("renders both players' names and counts", () => {
    render(
      <ScoreBar
        p1={p1}
        p2={p2}
        scores={{ a: 12, b: 7 }}
        total={196}
        endsAt={Date.now() + 60_000}
        category="Countries"
      />,
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    // total shown for each player
    expect(screen.getAllByText("/ 196")).toHaveLength(2);
    expect(screen.getByText("Countries")).toBeInTheDocument();
  });

  it("in gauntlet shows countries left (total − score), not score/total", () => {
    render(
      <ScoreBar
        p1={p1}
        p2={p2}
        scores={{ a: 12, b: 7 }}
        total={196}
        endsAt={Date.now() + 60_000}
        category="Countries"
        gauntlet
        lastStanding
        lives={{ a: 5, b: 5 }}
        maxLives={5}
      />,
    );
    // 196 − 12 = 184 left; 196 − 7 = 189 left. No "/ 196".
    expect(screen.getByText("184")).toBeInTheDocument();
    expect(screen.getByText("189")).toBeInTheDocument();
    expect(screen.getAllByText("left")).toHaveLength(2);
    expect(screen.queryByText("/ 196")).toBeNull();
  });

  it("renders each player's name in their slot color", () => {
    render(
      <ScoreBar
        p1={p1}
        p2={p2}
        scores={{ a: 0, b: 0 }}
        total={196}
        endsAt={Date.now() + 60_000}
        category="Countries"
      />,
    );
    const alice = screen.getByText("Alice");
    const bob = screen.getByText("Bob");
    expect(alice.getAttribute("style")).toContain("var(--color-player1)");
    expect(bob.getAttribute("style")).toContain("var(--color-player2)");
  });

  it("renders a dash when there is no active round", () => {
    render(
      <ScoreBar
        p1={p1}
        p2={p2}
        scores={{ a: 0, b: 0 }}
        total={196}
        endsAt={null}
        category="Countries"
      />,
    );
    expect(screen.getByTestId("timer").textContent).toBe("—:—");
  });

  describe("countdown (fake timers)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("reflects the time remaining to endsAt", () => {
      vi.useFakeTimers();
      const now = Date.now();
      render(
        <ScoreBar
          p1={p1}
          p2={p2}
          scores={{ a: 0, b: 0 }}
          total={196}
          endsAt={now + 120_000}
          category="Countries"
        />,
      );
      expect(screen.getByTestId("timer").textContent).toBe("2:00");

      act(() => {
        vi.setSystemTime(now + 60_000);
        vi.advanceTimersByTime(300);
      });
      expect(screen.getByTestId("timer").textContent).toBe("1:00");
    });

    it("shows the correct time immediately when endsAt arrives after mount", () => {
      vi.useFakeTimers();
      const mountedAt = Date.now();
      const props = { p1, p2, scores: { a: 0, b: 0 }, total: 196, category: "Countries" };
      const { rerender } = render(<ScoreBar {...props} endsAt={null} />);

      // Countdown takes 4s before the round's endsAt is known.
      vi.setSystemTime(mountedAt + 4_000);
      rerender(<ScoreBar {...props} endsAt={mountedAt + 4_000 + 300_000} />);
      expect(screen.getByTestId("timer").textContent).toBe("5:00");
    });

    it("does not go negative and turns coral under 30s", () => {
      vi.useFakeTimers();
      const now = Date.now();
      render(
        <ScoreBar
          p1={p1}
          p2={p2}
          scores={{ a: 0, b: 0 }}
          total={196}
          endsAt={now + 20_000}
          category="Countries"
        />,
      );
      const timer = screen.getByTestId("timer");
      // Under 30s → coral accent color.
      expect(timer.getAttribute("style")).toContain("var(--color-accent)");

      act(() => {
        vi.setSystemTime(now + 40_000); // past endsAt
        vi.advanceTimersByTime(300);
      });
      expect(timer.textContent).toBe("0:00");
    });
  });
});
