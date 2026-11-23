import { useEffect, useLayoutEffect, useRef } from "react";
import type { ServerToClientEvents } from "./protocol";
import { useSocket } from "./socket";

/**
 * Handlers for typed server events plus socket.io's own connection lifecycle
 * events. Every entry is optional.
 */
export type SocketEventHandlers = {
  [E in keyof ServerToClientEvents]?: ServerToClientEvents[E];
} & {
  connect?: () => void;
  disconnect?: (reason: string) => void;
};

type AnyHandler = (...args: unknown[]) => void;
interface LooseSocket {
  on(event: string, cb: AnyHandler): unknown;
  off(event: string, cb: AnyHandler): unknown;
}

/**
 * Subscribe to a map of socket events for the lifetime of the component.
 *
 * The handlers are read through a ref, so they always see the latest render's
 * props/state without resubscribing. Subscriptions only change when the socket
 * or the SET of event names changes (not when a handler's identity changes).
 */
export function useSocketEvents(handlers: SocketEventHandlers): void {
  const socket = useSocket() as unknown as LooseSocket;
  const handlersRef = useRef(handlers);
  // Layout effects run before passive ones, so the ref is current before the
  // subscription effect (and any event it delivers) can read it.
  useLayoutEffect(() => {
    handlersRef.current = handlers;
  });

  const eventKey = Object.keys(handlers).sort().join("\n");

  useEffect(() => {
    const events = eventKey ? eventKey.split("\n") : [];
    const bound = events.map((event) => {
      const listener: AnyHandler = (...args) => {
        const fn = handlersRef.current[event as keyof SocketEventHandlers] as AnyHandler | undefined;
        fn?.(...args);
      };
      socket.on(event, listener);
      return [event, listener] as const;
    });
    return () => {
      for (const [event, listener] of bound) socket.off(event, listener);
    };
  }, [socket, eventKey]);
}
