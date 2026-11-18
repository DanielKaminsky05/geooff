/**
 * geofight game server — Express HTTP + typed Socket.IO.
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
  clampTurnSeconds,
  clampLives,
  type CategoryId,
  type ClientToServerEvents,
  type GameMode,
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
  clearTurnRuntime,
  deleteRoom,
  type Room,
  type Seat,
} from "./rooms.js";
import { scoreGuess, determineWinner } from "./matching.js";
import {
  isLastStanding,
  isGauntlet,
  isTurnBased,
  beginFirstTurn,
  handleSubmit as lastStandingSubmit,
  handleGauntletSubmit,
  pauseTurnForDisconnect,
  resumeTurnOnReconnect,
  type LastStandingDeps,
} from "./lastStanding.js";
import {
  KNOWN_CATEGORIES,
  lookupFor,
  canonicalFor,
  totalFor,
  allIdsFor,
} from "./sets.js";

const PORT = Number(process.env.PORT ?? 3001);

/** Timing overrides, mainly so tests don't have to wait on real-world timers. */
export interface CreateServerOptions {
  /** Milliseconds per countdown tick (default 1000). */
  countdownTickMs?: number;
  /** Reconnect grace window in milliseconds (default RECONNECT_GRACE_SECONDS * 1000). */
  graceMs?: number;
  /** last_standing per-turn timeout in ms (default settings.turnSeconds * 1000). */
  turnMsOverride?: number;
}

export interface GeofightServer {
  app: Express;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  httpServer: HttpServer;
}

/**
 * Build the Express app + HTTP server + Socket.IO server and wire up every
 * handler. Does NOT call `.listen()` — the caller decides when/where to bind.
 * This lets tests spin the whole stack up on an ephemeral port.
 */
export function createServer(options: CreateServerOptions = {}): GeofightServer {
  const countdownTickMs = options.countdownTickMs ?? 1000;
  const graceMs = options.graceMs ?? RECONNECT_GRACE_SECONDS * 1000;
  const graceSeconds = Math.max(1, Math.ceil(graceMs / 1000));
  const turnMsOverride = options.turnMsOverride;

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

  /** Delete the room if no seat has a live connection (prevents leaks). */
  function deleteIfAbandoned(room: Room): boolean {
    if (room.players.some((p) => p.connected)) return false;
    deleteRoom(room);
    return true;
  }

  /**
   * End the match: compute winner + missed sets, emit game_over, tidy timers.
   * `forcedWinnerId` overrides the score-based winner (forfeits). Deletes the
   * room afterwards if nobody is connected any more.
   */
  function endGame(room: Room, forcedWinnerId?: string | null): void {
    clearRoomTimers(room);
    clearTurnRuntime(room);
    room.phase = "ended";
    room.endsAt = undefined;

    // `undefined` → score-based winner; an explicit `null` → no winner (e.g.
    // solo survival over), which must not fall through to determineWinner.
    const winnerId =
      forcedWinnerId !== undefined
        ? forcedWinnerId
        : determineWinner(room.players.map((p) => ({ playerId: p.id, score: p.score })));

    const allIds = allIdsFor(room.settings.categoryId);
    const missedByPlayer: Record<string, string[]> = {};
    for (const seat of room.players) {
      missedByPlayer[seat.id] = allIds.filter((iso) => !seat.filled.has(iso));
    }

    io.to(room.code).emit("game_over", {
      winnerId,
      scores: scoresOf(room),
      missedByPlayer,
    });

    deleteIfAbandoned(room);
  }

  /** Dependencies passed to the last_standing turn machinery. */
  const lsDeps: LastStandingDeps = {
    io,
    endGame,
    otherSeat,
    turnDurationMs: (room) => turnMsOverride ?? room.settings.turnSeconds * 1000,
  };

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
        mode: room.settings.mode,
        total: totalFor(room.settings.categoryId),
        endsAt: room.endsAt,
      });
      if (isTurnBased(room)) {
        // Turn-based (last_standing / gauntlet): no shared round clock — begin
        // turn 1 (lives + first turn; gauntlet also seeds the opening prompt).
        beginFirstTurn(lsDeps, room);
        broadcastRoomState(room);
      } else {
        broadcastRoomState(room);
        room.roundTimer = setTimeout(() => {
          endGame(room);
        }, room.settings.timeLimitSeconds * 1000);
      }
    }, countdownTickMs);
  }

  /** Reset seats for a rematch back to lobby. */
  function resetForRematch(room: Room): void {
    clearRoomTimers(room);
    clearTurnRuntime(room);
    room.phase = "lobby";
    room.endsAt = undefined;
    room.solo = false;
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
    const pending = room.graceTimers.get(seat.id);
    if (pending) {
      clearTimeout(pending);
      room.graceTimers.delete(seat.id);
    }
    io.to(room.code).emit("player_left", { playerId: seat.id });

    // Empty, or only disconnected seats left (nobody can ever act) → delete.
    if (deleteIfAbandoned(room)) return;
    // Reassign host if the host left.
    if (room.hostId === seat.id) {
      room.hostId = room.players[0].id;
    }
    broadcastRoomState(room);
  }

  /**
   * Voluntarily leave a room in any phase. During countdown/playing this is a
   * forfeit: the match ends with the remaining player as winner, then the seat
   * is removed.
   */
  function leaveRoom(socket: GameSocket, room: Room, seat: Seat): void {
    if (room.phase === "countdown" || room.phase === "playing") {
      // Stop the leaver from receiving the old room's game_over.
      socket.leave(room.code);
      seat.connected = false;
      seat.socketId = null;
      const other = otherSeat(room, seat);
      endGame(room, other?.id);
    }
    handleLeave(socket, room, seat);
  }

  io.on("connection", (socket: GameSocket) => {
    socket.on(
      "create_room",
      safe(socket, (payload: { playerName: string; solo?: boolean }) => {
        const name = (payload?.playerName ?? "Player 1").toString().slice(0, 40) || "Player 1";
        // A socket holds at most one seat: vacate any previous room first.
        const prev = seatForSocket(socket);
        if (prev) leaveRoom(socket, prev.room, prev.seat);
        const { room, seat } = createRoom(name);
        if (payload?.solo) {
          // Private solo room: flagged solo and never joinable by a second player.
          room.solo = true;
          room.joinable = false;
        }
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

        const prev = seatForSocket(socket);
        if (prev && prev.room === room) {
          // Already seated here (e.g. duplicate emit under React StrictMode):
          // idempotent — just resend the seat + snapshot.
          socket.join(room.code);
          socket.emit("joined", {
            playerId: prev.seat.id,
            slot: prev.seat.slot,
            reconnectToken: prev.seat.reconnectToken,
            state: roomStateOf(room),
          });
          socket.emit("room_state", roomStateOf(room));
          return;
        }
        if (prev) {
          // Seated in a different room: vacate it before joining this one.
          leaveRoom(socket, prev.room, prev.seat);
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
            // last_standing: resume a paused turn clock for the returning player.
            resumeTurnOnReconnect(lsDeps, room, seat);
            broadcastRoomState(room);
            return;
          }
          // Token did not match; fall through to normal join if space allows.
        }

        // Private solo sessions are never joinable by a second player.
        if (!room.joinable) {
          emitError(socket, "not_joinable", "That game can't be joined.");
          return;
        }
        if (room.players.length >= 2) {
          emitError(socket, "room_full", "That room is already full.");
          return;
        }
        // New seats only in the lobby (e.g. a solo round can't be joined mid-way).
        if (room.phase !== "lobby") {
          emitError(socket, "in_progress", "That game is already in progress.");
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
      safe(socket, (payload: {
        timeLimitSeconds?: number;
        categoryId?: CategoryId;
        mode?: GameMode;
        turnSeconds?: number;
        lives?: number;
      }) => {
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
        if (
          payload?.categoryId !== undefined &&
          !KNOWN_CATEGORIES.includes(payload.categoryId as CategoryId)
        ) {
          emitError(socket, "bad_category", "Unknown category.");
          return;
        }
        if (
          payload?.mode !== undefined &&
          payload.mode !== "race" &&
          payload.mode !== "last_standing" &&
          payload.mode !== "gauntlet"
        ) {
          emitError(socket, "bad_mode", "Unknown mode.");
          return;
        }
        // Last Standing and Gauntlet are multiplayer-only; a private solo room
        // can never host either (both need a second player to alternate turns).
        if (
          (payload?.mode === "last_standing" || payload?.mode === "gauntlet") &&
          room.solo
        ) {
          emitError(socket, "needs_two", "That mode needs a second player.");
          return;
        }
        if (payload?.timeLimitSeconds !== undefined) {
          room.settings.timeLimitSeconds = clampTimeLimit(payload.timeLimitSeconds);
        }
        if (payload?.categoryId) {
          room.settings.categoryId = payload.categoryId;
        }
        if (payload?.mode) {
          room.settings.mode = payload.mode;
        }
        if (payload?.turnSeconds !== undefined) {
          room.settings.turnSeconds = clampTurnSeconds(payload.turnSeconds);
        }
        if (payload?.lives !== undefined) {
          room.settings.lives = clampLives(payload.lives);
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
        // A lone host starts a solo round straight away (no ready-up needed).
        const solo = room.players.length === 1;
        // Last Standing and Gauntlet are multiplayer-only — they need a real
        // opponent to alternate turns.
        if ((room.settings.mode === "last_standing" || room.settings.mode === "gauntlet") && solo) {
          emitError(socket, "needs_two", "That mode needs a second player.");
          return;
        }
        if (!solo && !room.players.every((p) => p.ready)) {
          emitError(socket, "not_ready", "Both players must be ready.");
          return;
        }
        room.solo = solo;
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
        if (isGauntlet(room)) {
          handleGauntletSubmit(lsDeps, room, seat, socket, payload?.text ?? "");
          return;
        }
        if (isLastStanding(room)) {
          lastStandingSubmit(lsDeps, room, seat, socket, payload?.text ?? "");
          return;
        }
        const categoryId = room.settings.categoryId;
        const outcome = scoreGuess(
          payload?.text ?? "",
          seat.filled,
          lookupFor(categoryId),
          canonicalFor(categoryId),
        );
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
            // End early if this player named every item in the set.
            if (seat.filled.size >= totalFor(categoryId)) {
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
        // Solo: "play again" restarts immediately, skipping the lobby.
        if (room.solo && room.players.length === 1) {
          resetForRematch(room);
          room.solo = true;
          startCountdownAndGame(room);
          return;
        }
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
        leaveRoom(socket, ctx.room, ctx.seat);
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
        // last_standing: if the CURRENT player left, pause their turn clock so
        // no life bleeds while they are inside the reconnect grace window.
        pauseTurnForDisconnect(room, seat);
        const other = otherSeat(room, seat);
        if (other?.socketId) {
          io.to(other.socketId).emit("opponent_disconnected", {
            playerId: seat.id,
            graceSeconds,
          });
        }
        const timer = setTimeout(() => {
          room.graceTimers.delete(seat.id);
          if (seat.connected) return; // reconnected in time
          if (room.phase === "playing" || room.phase === "countdown") {
            // Grace expired mid-match → the present (connected) player wins,
            // regardless of score. If nobody is present, fall back to score.
            const present = room.players.find((p) => p.id !== seat.id && p.connected);
            endGame(room, present?.id);
          } else {
            deleteIfAbandoned(room);
          }
        }, graceMs);
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
    console.log(
      `geofight server listening on http://localhost:${PORT} (${totalFor("countries")} countries loaded)`,
    );
  });
}
