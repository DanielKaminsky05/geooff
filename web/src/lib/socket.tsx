import { createContext, useContext, useEffect, useMemo } from "react";
import { io, Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "./protocol";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const WS_URL = import.meta.env.VITE_WS_URL ?? "http://localhost:3001";

const SocketContext = createContext<GameSocket | null>(null);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const socket = useMemo<GameSocket>(
    () =>
      io(WS_URL, {
        autoConnect: true,
        transports: ["websocket"],
      }),
    [],
  );

  useEffect(() => {
    return () => {
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
