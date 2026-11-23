/**
 * Server clock estimate.
 *
 * The server sends absolute epoch-ms deadlines (`endsAt`), so counting down
 * with the device's `Date.now()` is wrong by however far the device clock is
 * skewed. On every socket connect we do a few `time_sync` round-trips and keep
 * the offset from the lowest-RTT sample (NTP-style: the server stamped its
 * clock roughly half-way through the round-trip):
 *
 *   offset = serverNow + rtt / 2 - localNowAtReceive
 *
 * `serverNow()` = `Date.now() + offset`. The offset is 0 until the first sync
 * completes, i.e. the old behaviour.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { GameSocket } from "./socket";

/** Round-trips per sync; the lowest-RTT sample wins. */
export const SYNC_SAMPLES = 4;
/** Give up on a single sample after this long (old server / dead link). */
export const SYNC_TIMEOUT_MS = 3000;

let offset = 0;
const listeners = new Set<() => void>();

/** Estimated server wall clock, in epoch ms. */
export function serverNow(): number {
  return Date.now() + offset;
}

/** Current estimate of (server clock − local clock), in ms. */
export function getClockOffset(): number {
  return offset;
}

/** Subscribe to offset changes; returns an unsubscribe function. */
export function subscribeClockOffset(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function setOffset(next: number): void {
  if (next === offset) return;
  offset = next;
  for (const fn of [...listeners]) fn();
}

/** Test-only: reset to the unsynced state. */
export function resetServerClock(): void {
  setOffset(0);
}

function sample(socket: GameSocket): Promise<{ rtt: number; offset: number } | null> {
  return new Promise((resolve) => {
    const sentAt = Date.now();
    socket.timeout(SYNC_TIMEOUT_MS).emit("time_sync", (err: Error | null, server: number) => {
      const receivedAt = Date.now();
      if (err || typeof server !== "number" || !Number.isFinite(server)) {
        resolve(null);
        return;
      }
      const rtt = Math.max(0, receivedAt - sentAt);
      resolve({ rtt, offset: server + rtt / 2 - receivedAt });
    });
  });
}

/**
 * Run `samples` sequential time_sync round-trips and adopt the offset of the
 * lowest-RTT one. `isCurrent` lets a caller abandon a sync made stale by a
 * disconnect. Resolves to the adopted offset, or null if no sample succeeded.
 */
export async function syncServerClock(
  socket: GameSocket,
  samples = SYNC_SAMPLES,
  isCurrent: () => boolean = () => true,
): Promise<number | null> {
  let best: { rtt: number; offset: number } | null = null;
  for (let i = 0; i < samples; i++) {
    if (!isCurrent() || !socket.connected) return null;
    const s = await sample(socket);
    if (s && (!best || s.rtt < best.rtt)) best = s;
  }
  if (!best || !isCurrent()) return null;
  setOffset(Math.round(best.offset));
  return offset;
}

/**
 * Sync on every connect (including socket.io's automatic reconnects).
 * Returns a detach function.
 */
export function attachServerClock(socket: GameSocket): () => void {
  let generation = 0;
  const onConnect = () => {
    const mine = ++generation;
    void syncServerClock(socket, SYNC_SAMPLES, () => mine === generation);
  };
  const onDisconnect = () => {
    generation++;
  };
  socket.on("connect", onConnect);
  socket.on("disconnect", onDisconnect);
  if (socket.connected) onConnect();
  return () => {
    generation++;
    socket.off("connect", onConnect);
    socket.off("disconnect", onDisconnect);
  };
}

/**
 * Time remaining until the server deadline `endsAt`, in ms rounded UP to whole
 * seconds and clamped at 0 (0 when `endsAt` is null). Re-renders every 250 ms
 * while running, stops ticking once the deadline passes, and re-renders
 * immediately when the clock offset changes. `paused` stops the ticking.
 *
 * Whole seconds keep the store snapshot stable between renders (React requires
 * getSnapshot to return the same value until something changes), and are all
 * the countdown UIs display anyway.
 */
export function useServerCountdown(endsAt: number | null, paused = false): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      let id: ReturnType<typeof setInterval> | undefined;
      const running = endsAt != null && !paused;
      const stop = () => {
        if (id !== undefined) clearInterval(id);
        id = undefined;
      };
      const start = () => {
        if (!running || id !== undefined || endsAt - serverNow() <= 0) return;
        id = setInterval(() => {
          onChange();
          if (endsAt - serverNow() <= 0) stop();
        }, 250);
      };
      start();
      const unsubOffset = subscribeClockOffset(() => {
        onChange();
        start(); // a new offset may have moved the deadline back into the future
      });
      return () => {
        stop();
        unsubOffset();
      };
    },
    [endsAt, paused],
  );
  const getSnapshot = () =>
    endsAt == null ? 0 : Math.max(0, Math.ceil((endsAt - serverNow()) / 1000)) * 1000;
  return useSyncExternalStore(subscribe, getSnapshot);
}
