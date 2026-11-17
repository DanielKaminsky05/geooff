import type { ReactNode } from "react";
import { act } from "react";
import { vi } from "vitest";
import type { Identity } from "../lib/session";

/**
 * Reusable fake Socket.IO client for frontend tests.
 *  - `emit` is a vi.fn() so tests can assert outgoing events.
 *  - `__server(event, payload)` pushes a server→client event to all handlers
 *    registered via `on`.
 *  - `__emitted` lists outgoing { event, payload } in order.
 */
export interface MockSocket {
  on: (event: string, cb: (...args: unknown[]) => void) => MockSocket;
  off: (event: string, cb?: (...args: unknown[]) => void) => MockSocket;
  emit: ReturnType<typeof vi.fn>;
  __server: (event: string, payload?: unknown) => void;
  __emitted: Array<{ event: string; payload: unknown }>;
  __lastEmit: (event: string) => unknown;
}

export function createMockSocket(): MockSocket {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const emitted: Array<{ event: string; payload: unknown }> = [];

  const emit = vi.fn((event: string, payload?: unknown) => {
    emitted.push({ event, payload });
    return socket;
  });

  const socket: MockSocket = {
    on(event, cb) {
      handlers.set(event, [...(handlers.get(event) ?? []), cb]);
      return socket;
    },
    off(event, cb) {
      if (!cb) {
        handlers.delete(event);
      } else {
        handlers.set(event, (handlers.get(event) ?? []).filter((h) => h !== cb));
      }
      return socket;
    },
    emit,
    __server(event, payload) {
      act(() => {
        (handlers.get(event) ?? []).forEach((cb) => cb(payload));
      });
    },
    __emitted: emitted,
    __lastEmit(event) {
      for (let i = emitted.length - 1; i >= 0; i--) {
        if (emitted[i].event === event) return emitted[i].payload;
      }
      return undefined;
    },
  };

  return socket;
}

/* ------------------------------------------------------------------ */
/* Provider mocks                                                      */
/* ------------------------------------------------------------------ */

/**
 * A stand-in SocketProvider that injects the mock socket. Tests call
 * `vi.mock("../lib/socket", ...)` and point `useSocket` at the shared mock;
 * this component just renders children.
 */
export function MockSocketProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function makeIdentity(overrides: Partial<Identity> = {}): Identity {
  return {
    playerId: "p1-id",
    slot: "p1",
    reconnectToken: "tok-1",
    ...overrides,
  };
}
