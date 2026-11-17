import { type AddressInfo } from "node:net";
import { io as ioClient, type Socket } from "socket.io-client";
import { createServer, type GeooffServer } from "../../src/index.js";
import { rooms } from "../../src/rooms.js";

export interface TestServer extends GeooffServer {
  url: string;
  close: () => Promise<void>;
}

/** Boot the real server on an ephemeral port. */
export async function startTestServer(): Promise<TestServer> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.httpServer.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;

  const close = async (): Promise<void> => {
    // Clear any in-memory rooms this test created so state can't leak.
    for (const room of [...rooms.values()]) {
      if (room.roundTimer) clearTimeout(room.roundTimer);
      if (room.countdownTimer) clearInterval(room.countdownTimer);
      for (const t of room.graceTimers.values()) clearTimeout(t);
    }
    rooms.clear();
    await new Promise<void>((resolve) => {
      server.io.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      server.httpServer.close(() => resolve());
    });
  };

  return { ...server, url, close };
}

/** Open a connected socket.io-client to the test server. */
export function connectClient(url: string): Socket {
  return ioClient(url, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });
}

/** Resolve on the next occurrence of `event`, rejecting after a timeout. */
export function awaitEvent<T = any>(
  socket: Socket,
  event: string,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for "${event}"`));
    }, timeoutMs);
    const handler = (payload: T) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

/** Assert that `event` does NOT fire within `ms`. Resolves if silent. */
export function expectNoEvent(socket: Socket, event: string, ms = 250): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const handler = (payload: unknown) => {
      socket.off(event, handler);
      reject(new Error(`unexpected "${event}": ${JSON.stringify(payload)}`));
    };
    socket.on(event, handler);
    setTimeout(() => {
      socket.off(event, handler);
      resolve();
    }, ms);
  });
}

export type { Socket };
