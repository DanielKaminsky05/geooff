import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import {
  attachServerClock,
  getClockOffset,
  resetServerClock,
  serverNow,
  subscribeClockOffset,
  syncServerClock,
} from "./serverClock";
import type { GameSocket } from "./socket";
import ScoreBar from "../components/ScoreBar";
import TurnTimer from "../components/TurnTimer";

/** The device clock is this far BEHIND the server. */
const SKEW = 7_000;

/**
 * Fake socket whose server clock is `Date.now() + SKEW`. Each time_sync takes
 * `latencies[i]` ms round-trip (split evenly each way); a null latency never
 * answers (→ socket.io's timeout error).
 */
function createClockSocket(latencies: Array<number | null> = [0]) {
  const handlers = new Map<string, Set<() => void>>();
  let call = 0;
  const socket = {
    connected: false,
    on(ev: string, cb: () => void) {
      if (!handlers.has(ev)) handlers.set(ev, new Set());
      handlers.get(ev)!.add(cb);
      return socket;
    },
    off(ev: string, cb: () => void) {
      handlers.get(ev)?.delete(cb);
      return socket;
    },
    timeout(ms: number) {
      return {
        emit(ev: string, ack: (err: Error | null, t?: number) => void) {
          expect(ev).toBe("time_sync");
          const latency = latencies[Math.min(call++, latencies.length - 1)];
          if (latency == null) {
            setTimeout(() => ack(new Error("timeout")), ms);
            return;
          }
          setTimeout(() => {
            const stamped = Date.now() + SKEW;
            setTimeout(() => ack(null, stamped), latency / 2);
          }, latency / 2);
        },
      };
    },
    fire(ev: string) {
      socket.connected = ev === "connect";
      for (const cb of [...(handlers.get(ev) ?? [])]) cb();
    },
    get calls() {
      return call;
    },
  };
  return socket;
}

const asSocket = (s: ReturnType<typeof createClockSocket>) => s as unknown as GameSocket;

beforeEach(() => {
  vi.useFakeTimers();
  resetServerClock();
});

afterEach(() => {
  resetServerClock();
  vi.useRealTimers();
});

describe("serverClock", () => {
  it("defaults to the local clock before any sync", () => {
    expect(getClockOffset()).toBe(0);
    expect(serverNow()).toBe(Date.now());
  });

  it("estimates the offset from the lowest-RTT sample", async () => {
    // Asymmetric slow samples would mis-estimate; the 20 ms one is exact.
    const s = createClockSocket([400, 20, 900, 300]);
    s.connected = true;
    const done = syncServerClock(asSocket(s), 4);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await done).toBe(SKEW);
    expect(s.calls).toBe(4);
    expect(serverNow()).toBe(Date.now() + SKEW);
  });

  it("ignores timed-out samples and keeps offset 0 if none succeed", async () => {
    const s = createClockSocket([null]);
    s.connected = true;
    const done = syncServerClock(asSocket(s), 2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await done).toBeNull();
    expect(getClockOffset()).toBe(0);
  });

  it("syncs on connect and again on reconnect, notifying subscribers", async () => {
    const s = createClockSocket([10]);
    const detach = attachServerClock(asSocket(s));
    const seen = vi.fn();
    const unsub = subscribeClockOffset(seen);

    s.fire("connect");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(getClockOffset()).toBe(SKEW);
    expect(seen).toHaveBeenCalledTimes(1);
    const first = s.calls;
    expect(first).toBeGreaterThanOrEqual(3);

    s.fire("disconnect");
    resetServerClock();
    s.fire("connect");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(s.calls).toBe(first * 2);
    expect(getClockOffset()).toBe(SKEW);

    unsub();
    detach();
  });

  it("abandons a sync interrupted by a disconnect", async () => {
    const s = createClockSocket([100]);
    const detach = attachServerClock(asSocket(s));
    s.fire("connect");
    await vi.advanceTimersByTimeAsync(150); // first sample answered
    s.fire("disconnect");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(getClockOffset()).toBe(0);
    detach();
  });
});

describe("countdowns on a skewed device clock", () => {
  async function synced() {
    const s = createClockSocket([30]);
    const detach = attachServerClock(asSocket(s));
    s.fire("connect");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(getClockOffset()).toBe(SKEW);
    return detach;
  }

  const props = { scores: {}, total: 196, category: "Countries" };

  it("ScoreBar shows the server-correct remaining time", async () => {
    const detach = await synced();
    // Server says the round ends 60 s from ITS now; the device is 7 s behind,
    // so naive Date.now() math would show 1:07.
    const endsAt = Date.now() + SKEW + 60_000;
    render(<ScoreBar {...props} endsAt={endsAt} />);
    expect(screen.getByTestId("timer").textContent).toBe("1:00");
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByTestId("timer").textContent).toBe("0:30");
    detach();
  });

  it("ScoreBar corrects itself when the offset arrives after mount", async () => {
    const endsAt = Date.now() + SKEW + 60_000;
    render(<ScoreBar {...props} endsAt={endsAt} />);
    expect(screen.getByTestId("timer").textContent).toBe("1:07"); // unsynced
    const s = createClockSocket([0]);
    const detach = attachServerClock(asSocket(s));
    await act(async () => {
      s.fire("connect");
      await vi.advanceTimersByTimeAsync(10); // < one 250 ms tick: the offset change itself re-renders
    });
    expect(screen.getByTestId("timer").textContent).toBe("1:00");
    detach();
  });

  it("ScoreBar stops ticking once it reaches 0", async () => {
    const detach = await synced();
    render(<ScoreBar {...props} endsAt={Date.now() + SKEW + 1_000} />);
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    expect(screen.getByTestId("timer").textContent).toBe("0:00");
    expect(vi.getTimerCount()).toBe(0);
    detach();
  });

  it("TurnTimer shows the server-correct seconds", async () => {
    const detach = await synced();
    render(<TurnTimer endsAt={Date.now() + SKEW + 10_000} />);
    expect(screen.getByTestId("turn-timer").textContent).toBe("10");
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(screen.getByTestId("turn-timer").textContent).toBe("6");
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByTestId("turn-timer").textContent).toBe("0");
    expect(vi.getTimerCount()).toBe(0);
    detach();
  });
});
