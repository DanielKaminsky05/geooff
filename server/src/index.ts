/**
 * geooff game server — Express HTTP + typed Socket.IO.
 *
 * The server is authoritative: it validates answers, owns the countdown and the
 * round timer (via `endsAt`), and never sends the answer list to clients.
 */

import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import cors from "cors";
import { Server, type Socket } from "socket.io";

import {
  COUNTDOWN_SECONDS,
  RECONNECT_GRACE_SECONDS,
  clampTimeLimit,
  type ClientToServerEvents,
  type GamePhase,
  type ServerToClientEvents,
} from "./protocol.js";
import {
  rooms,
  createRoom,
  addSecondPlayer,
  roomStateOf,
  seatToPublic,
  scoresOf,
  clearRoomTimers,
  deleteRoom,
  type Room,
  type Seat,
} from "./rooms.js";
import {
  buildLookup,
  buildCanonicalNames,
  scoreGuess,
  determineWinner,
  allIsoCodes,
  total,
} from "./matching.js";

const PORT = Number(process.env.PORT ?? 3001);

export interface GeooffServer {
  app: Express;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  httpServer: HttpServer;
}

/**
 * Build the Express app + HTTP server + Socket.IO server and wire up every
 * handler. Does NOT call `.listen()` — the caller decides when/where to bind.
 * This lets tests spin the whole stack up on an ephemeral port.
 */
export function createServer(): GeooffServer {
  // Build lookups once per server.
  const lookup = buildLookup();
  const canonicalNames = buildCanonicalNames();

  /* ---------------------------------------------------------------- */
  /* HTTP (Express)                                                    */
  /* ---------------------------------------------------------------- */

  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/rooms/:code", (req, res) => {
    const code = String(req.params.code).toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      res.json({ exists: false, status: null as GamePhase | null, playerCount: 0 });
      return;
    }
    res.json({ exists: true, status: room.phase, playerCount: room.players.length });
  });

  const httpServer = createHttpServer(app);

  /* ---------------------------------------------------------------- */
  /* Socket.IO                                                         */
  /* ---------------------------------------------------------------- */

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: true },
  });

  type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

  /** Find the room + seat for a connected socket. */
  function seatForSocket(socket: GameSocket): { room: Room; seat: Seat } | null {
    for (const room of rooms.values()) {
      const seat = room.players.find((p) => p.socketId === socket.id);
      if (seat) return { room, seat };
    }
    return null;
  }

  function otherSeat(room: Room, seat: Seat): Seat | undefined {
    return room.players.find((p) => p.id !== seat.id);
  }

  function broadcastRoomState(room: Room): void {
    io.to(room.code).emit("room_state", roomStateOf(room));
  }

  function emitError(socket: GameSocket, code: string, message: string): void {
    socket.emit("error_msg", { code, message });
  }

  /** End the match: compute winner + missed sets, emit game_over, tidy timers. */
  function endGame(room: Room): void {
    clearRoomTimers(room);
    room.phase = "ended";
    room.endsAt = undefined;

    const winnerId = determineWinner(
      room.players.map((p) => ({ playerId: p.id, score: p.score })),
    );

    const missedByPlayer: Record<string, string[]> = {};
    for (const seat of room.players) {
      missedByPlayer[seat.id] = allIsoCodes.filter((iso) => !seat.filled.has(iso));
    }

    io.to(room.code).emit("game_over", {
      winnerId,
      scores: scoresOf(room),
      missedByPlayer,
    });
  }

  function startCountdownAndGame(room: Room): void {
    room.phase = "countdown";
    broadcastRoomState(room);

    let remaining = COUNTDOWN_SECONDS;
    io.to(room.code).emit("countdown", { seconds: remaining });

    room.countdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        io.to(room.code).emit("countdown", { seconds: remaining });
        return;
      }
      // Countdown finished — begin play.
      if (room.countdownTimer) clearInterval(room.countdownTimer);
      room.countdownTimer = undefined;

      room.phase = "playing";
      room.endsAt = Date.now() + room.settings.timeLimitSeconds * 1000;
      io.to(room.code).emit("game_started", {
        categoryId: room.settings.categoryId,
        total,
        endsAt: room.endsAt,
      });
      broadcastRoomState(room);

      room.roundTimer = setTimeout(() => {
        endGame(room);
      }, room.settings.timeLimitSeconds * 1000);
    }, 1000);
  }

  /** Reset seats for a rematch back to lobby. */
  function resetForRematch(room: Room): void {
    clearRoomTimers(room);
    room.phase = "lobby";
    room.endsAt = undefined;
    for (const seat of room.players) {
      seat.score = 0;
      seat.ready = false;
      seat.rematchRequested = false;
      seat.filled = new Set();
    }
  }

  /** Wrap a payload handler so a thrown error can't crash the process. */
  function safe<T>(socket: GameSocket, fn: (payload: T) => void) {
    return (payload: T) => {
      try {
        fn(payload);
      } catch (err) {
        console.error("handler error:", err);
        emitError(socket, "internal", "Something went wrong handling that request.");
      }
    };
  }

  /** Wrap a no-payload handler so a thrown error can't crash the process. */
  function safe0(socket: GameSocket, fn: () => void) {
    return () => {
      try {
        fn();
      } catch (err) {
        console.error("handler error:", err);
        emitError(socket, "internal", "Something went wrong handling that request.");
      }
    };
  }

  /** Remove a seat from a lobby/ended room and clean up an empty room. */
  function handleLeave(socket: GameSocket, room: Room, seat: Seat): void {
    room.players = room.players.filter((p) => p.id !== seat.id);
    socket.leave(room.code);
    io.to(room.code).emit("player_left", { playerId: seat.id });

    if (room.players.length === 0) {
      deleteRoom(room);
      return;
    }
    // Reassign host if the host left.
    if (room.hostId === seat.id) {
      room.hostId = room.players[0].id;
    }
    broadcastRoomState(room);
  }

  io.on("connection", (socket: GameSocket) => {
    socket.on(
      "create_room",
      safe(socket, (payload: { playerName: string }) => {
        const name = (payload?.playerName ?? "Player 1").toString().slice(0, 40) || "Player 1";
        const { room, seat } = createRoom(name);
        seat.socketId = socket.id;
        socket.join(room.code);
        socket.emit("joined", {
          playerId: seat.id,
          slot: seat.slot,
          reconnectToken: seat.reconnectToken,
          state: roomStateOf(room),
        });
      }),
    );

    socket.on(
      "join_room",
      safe(socket, (payload: { code: string; playerName: string; reconnectToken?: string }) => {
        const code = (payload?.code ?? "").toString().toUpperCase();
        const name = (payload?.playerName ?? "Player 2").toString().slice(0, 40) || "Player 2";
        const room = rooms.get(code);
        if (!room) {
          emitError(socket, "room_not_found", `No room with code ${code}.`);
          return;
        }

        // Reconnection path: token matches a (typically disconnected) seat.
        if (payload?.reconnectToken) {
          const seat = room.players.find((p) => p.reconnectToken === payload.reconnectToken);
          if (seat) {
            const grace = room.graceTimers.get(seat.id);
            if (grace) {
              clearTimeout(grace);
              room.graceTimers.delete(seat.id);
            }
            seat.socketId = socket.id;
            seat.connected = true;
            socket.join(room.code);
            socket.emit("joined", {
              playerId: seat.id,
              slot: seat.slot,
              reconnectToken: seat.reconnectToken,
              state: roomStateOf(room),
            });
            const other = otherSeat(room, seat);
            if (other?.socketId) {
              io.to(other.socketId).emit("opponent_reconnected", { playerId: seat.id });
            }
            broadcastRoomState(room);
            return;
          }
          // Token did not match; fall through to normal join if space allows.
        }

        if (room.players.length >= 2) {
          emitError(socket, "room_full", "That room is already full.");
          return;
        }

        const seat = addSecondPlayer(room, name);
        seat.socketId = socket.id;
        socket.join(room.code);
        socket.emit("joined", {
          playerId: seat.id,
          slot: seat.slot,
          reconnectToken: seat.reconnectToken,
          state: roomStateOf(room),
        });
        socket.to(room.code).emit("player_joined", { player: seatToPublic(seat) });
        broadcastRoomState(room);
      }),
    );

    socket.on(
      "set_ready",
      safe(socket, (payload: { ready: boolean }) => {
        const ctx = seatForSocket(socket);
        if (!ctx) return;
        ctx.seat.ready = Boolean(payload?.ready);
        io.to(ctx.room.code).emit("player_ready", {
          playerId: ctx.seat.id,
          ready: ctx.seat.ready,
        });
        broadcastRoomState(ctx.room);
      }),
    );

    socket.on(
      "update_settings",
      safe(socket, (payload: { timeLimitSeconds?: number; categoryId?: "countries" }) => {
        const ctx = seatForSocket(socket);
        if (!ctx) return;
        const { room, seat } = ctx;
        if (room.hostId !== seat.id) {
          emitError(socket, "not_host", "Only the host can change settings.");
          return;
        }
        if (room.phase !== "lobby") {
          emitError(socket, "locked", "Settings are locked once the round starts.");
          return;
        }
        if (payload?.timeLimitSeconds !== undefined) {
          room.settings.timeLimitSeconds = clampTimeLimit(payload.timeLimitSeconds);
        }
        if (payload?.categoryId) {
          room.settings.categoryId = payload.categoryId;
        }
        broadcastRoomState(room);
      }),
    );

    socket.on(
      "start_game",
      safe0(socket, () => {
        const ctx = seatForSocket(socket);
        if (!ctx) return;
        const { room, seat } = ctx;
        if (room.hostId !== seat.id) {
          emitError(socket, "not_host", "Only the host can start the game.");
          return;
        }
        if (room.phase !== "lobby") {
          emitError(socket, "bad_phase", "The game has already started.");
          return;
        }
        if (room.players.length < 2) {
          emitError(socket, "need_two", "Need two players to start.");
          return;
        }
        if (!room.players.every((p) => p.ready)) {
          emitError(socket, "not_ready", "Both players must be ready.");
          return;
        }
        startCountdownAndGame(room);
      }),
    );

    socket.on(
      "submit_answer",
      safe(socket, (payload: { text: string }) => {
        const ctx = seatForSocket(socket);
        if (!ctx) return;
        const { room, seat } = ctx;
        if (room.phase !== "playing") {
          socket.emit("answer_result", { accepted: false, reason: "not_playing" });
          return;
        }
        const outcome = scoreGuess(payload?.text ?? "", seat.filled, lookup, canonicalNames);
        switch (outcome.kind) {
          case "accepted": {
            seat.score += 1;
            socket.emit("answer_result", {
              accepted: true,
              canonical: outcome.canonical,
              isoCode: outcome.iso,
            });
            io.to(room.code).emit("score_update", { scores: scoresOf(room) });
            const other = otherSeat(room, seat);
            if (other?.socketId) {
              io.to(other.socketId).emit("opponent_progress", {
                playerId: seat.id,
                isoCode: outcome.iso,
              });
            }
            // End early if this player named every country.
            if (seat.filled.size >= total) {
              endGame(room);
            }
            break;
          }
          case "duplicate":
            socket.emit("answer_result", { accepted: false, reason: "duplicate" });
            break;
          case "empty":
            socket.emit("answer_result", { accepted: false, reason: "empty" });
            break;
          default:
            socket.emit("answer_result", { accepted: false, reason: "wrong" });
        }
      }),
    );

    socket.on(
      "give_up",
      safe0(socket, () => {
        const ctx = seatForSocket(socket);
        if (!ctx) return;
        if (ctx.room.phase !== "playing" && ctx.room.phase !== "countdown") return;
        endGame(ctx.room);
      }),
    );

    socket.on(
      "request_rematch",
      safe0(socket, () => {
        const ctx = seatForSocket(socket);
        if (!ctx) return;
        const { room, seat } = ctx;
        if (room.phase !== "ended") return;
        seat.rematchRequested = true;
        io.to(room.code).emit("rematch_requested", { playerId: seat.id });
        if (room.players.length === 2 && room.players.every((p) => p.rematchRequested)) {
          resetForRematch(room);
          broadcastRoomState(room);
          io.to(room.code).emit("rematch_start");
        }
      }),
    );

    socket.on(
      "leave_room",
      safe0(socket, () => {
        const ctx = seatForSocket(socket);
        if (!ctx) return;
        handleLeave(socket, ctx.room, ctx.seat);
      }),
    );

    socket.on("disconnect", () => {
      try {
        const ctx = seatForSocket(socket);
        if (!ctx) return;
        const { room, seat } = ctx;
        seat.connected = false;
        seat.socketId = null;

        if (room.phase === "lobby" || room.phase === "ended") {
          // Seat is disposable outside of a live match.
          handleLeave(socket, room, seat);
          return;
        }

        // Live match: keep the game running, start a grace timer.
        const other = otherSeat(room, seat);
        if (other?.socketId) {
          io.to(other.socketId).emit("opponent_disconnected", {
            playerId: seat.id,
            graceSeconds: RECONNECT_GRACE_SECONDS,
          });
        }
        const timer = setTimeout(() => {
          room.graceTimers.delete(seat.id);
          if (seat.connected) return; // reconnected in time
          // Grace expired mid-match → present player wins (handled by scores).
          if (room.phase === "playing" || room.phase === "countdown") {
            endGame(room);
          }
        }, RECONNECT_GRACE_SECONDS * 1000);
        room.graceTimers.set(seat.id, timer);
      } catch (err) {
        console.error("disconnect error:", err);
      }
    });
  });

  return { app, io, httpServer };
}

/* ------------------------------------------------------------------ */
/* Main-module guard: only bind a port when run directly.             */
/* ------------------------------------------------------------------ */

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === new URL(`file://${process.argv[1]}`).href
      || fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const { httpServer } = createServer();
  httpServer.listen(PORT, () => {
    console.log(`geooff server listening on http://localhost:${PORT} (${total} countries loaded)`);
  });
}
