import { createContext, useContext, useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "./protocol";
import { attachServerClock } from "./serverClock";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const WS_URL = import.meta.env.VITE_WS_URL ?? "http://localhost:3001";

const SocketContext = createContext<GameSocket | null>(null);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  // Created once, but NOT connected here: connecting in the effect body (and
  // disconnecting in its cleanup) keeps the socket alive across StrictMode's
  // simulated mount -> cleanup -> mount cycle.
  const [socket] = useState<GameSocket>(() =>
    io(WS_URL, {
      autoConnect: false,
      // Prefer websocket, but keep polling as a fallback: iOS Safari drops
      // websockets when the tab is backgrounded / the phone locks, and some
      // mobile networks block the upgrade — without a fallback the client can
      // fail to reconnect at all. (Single backend instance, so polling is safe.)
      transports: ["websocket", "polling"],
    }),
  );

  useEffect(() => {
    // Estimate the server clock offset on every (re)connect so countdowns to
    // the server's epoch-ms deadlines are right even on a skewed device clock.
    const detachClock = attachServerClock(socket);
    socket.connect();
    return () => {
      detachClock();
      socket.disconnect();
    };
  }, [socket]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

/** Returns the shared typed socket.io client. */
export function useSocket(): GameSocket {
  const socket = useContext(SocketContext);
  if (!socket) {
    throw new Error("useSocket must be used within a <SocketProvider>");
  }
  return socket;
}
