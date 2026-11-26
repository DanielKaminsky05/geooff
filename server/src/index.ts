/**
 * geofight game server — Express HTTP + typed Socket.IO.
 *
 * The server is authoritative: it validates answers, owns the countdown and the
 * round timer (via `endsAt`), and never sends the answer list to clients.
 */

// Load server/.env (Supabase creds, Phase 2) before anything reads process.env.
// No-ops when the file is absent, so CI/offline need no credentials.
import "dotenv/config";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import cors from "cors";
import { Server, type DefaultEventsMap, type Socket } from "socket.io";

import {
  COUNTDOWN_SECONDS,
  RECONNECT_GRACE_SECONDS,
  MAX_PLAYERS,
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
  addPlayer,
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
  resolveAfterLeave,
  type LastStandingDeps,
} from "./lastStanding.js";
import {
  isShowdown,
  beginShowdown,
  handleShowdownSubmit,
  resolveShowdownAfterLeave,
  type ShowdownDeps,
} from "./showdown.js";
import {
  KNOWN_CATEGORIES,
  lookupFor,
  canonicalFor,
  totalFor,
  allIdsFor,
} from "./sets.js";
import { buildPromptPool } from "./prompts.js";
import { registerDailyRoutes } from "./daily/routes.js";
import { makeSupabaseRunsRepo } from "./daily/supabaseRunsRepo.js";
import { REVEAL_MS_DEFAULT, voteSkipReveal } from "./reveal.js";
import {
  MAX_ANSWER_LENGTH,
  parseAck,
  parseCreateRoom,
  parseJoinRoom,
  parseSetReady,
  parseUpdateSettings,
  parseSubmitAnswer,
} from "./validate.js";
import {
  TokenBucket,
  DEFAULT_ANSWER_LIMIT,
  DEFAULT_EVENT_LIMIT,
  type BucketConfig,
} from "./rateLimit.js";

const PORT = Number(process.env.PORT ?? 3001);

const GAME_MODES: readonly GameMode[] = ["race", "last_standing", "gauntlet", "showdown"];

/** Timing overrides, mainly so tests don't have to wait on real-world timers. */
export interface CreateServerOptions {
  /** Milliseconds per countdown tick (default 1000). */
  countdownTickMs?: number;
  /** Reconnect grace window in milliseconds (default RECONNECT_GRACE_SECONDS * 1000). */
  graceMs?: number;
  /** last_standing per-turn timeout in ms (default settings.turnSeconds * 1000). */
  turnMsOverride?: number;
  /** showdown per-round duration in ms (default settings.turnSeconds * 1000). */
  roundMsOverride?: number;
  /** showdown pause between rounds in ms (legacy alias for revealMsOverride). */
  interRoundMsOverride?: number;
  /** end-of-prompt reveal pause in ms, gauntlet + showdown (default 10000). */
  revealMsOverride?: number;
  /** race round duration in ms (default settings.timeLimitSeconds * 1000). */
  raceMsOverride?: number;
  /**
   * Per-socket token-bucket limits. `answer` covers submit_answer; `events`
   * covers every other client event. `false` disables that limiter.
   */
  rateLimits?: { answer?: BucketConfig | false; events?: BucketConfig | false };
  /** Clock for the rate limiters (default Date.now) — tests inject a fake one. */
  now?: () => number;
}

/** Per-socket server state: which seat (if any) this socket currently holds. */
export interface SocketData {
  roomCode?: string;
  playerId?: string;
}

/** Max size of a single incoming Socket.IO message (all our payloads are tiny). */
export const MAX_HTTP_BUFFER_SIZE = 16 * 1024;

export type GeofightIO = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  DefaultEventsMap,
  SocketData
>;

export interface GeofightServer {
  app: Express;
  io: GeofightIO;
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
  const roundMsOverride = options.roundMsOverride;
  // The reveal pause (gauntlet + showdown) holds the game on the end-of-prompt
  // reveal. `interRoundMsOverride` is kept as a legacy alias for existing tests.
  const revealMs = options.revealMsOverride ?? options.interRoundMsOverride ?? REVEAL_MS_DEFAULT;
  const raceMsOverride = options.raceMsOverride;
  const answerLimit = options.rateLimits?.answer ?? DEFAULT_ANSWER_LIMIT;
  const eventLimit = options.rateLimits?.events ?? DEFAULT_EVENT_LIMIT;
  const now = options.now ?? Date.now;

  /* ---------------------------------------------------------------- */
  /* HTTP (Express)                                                    */
  /* ---------------------------------------------------------------- */

  const app = express();
  // Trust one proxy hop (Fly's edge) so `req.ip` is the real client IP — the
  // Daily Trek answer route rate-limits per IP, which only works with the true
  // address. Local/direct connections are unaffected (no X-Forwarded-For).
  app.set("trust proxy", 1);
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

  // Daily Trek — stateless REST (GET /daily, POST /daily/answer, /daily/finish).
  // Phase 2: a Supabase repo persists finished runs for a real percentile; it's
  // `null` when Supabase is unconfigured, degrading to the synthetic percentile.
  registerDailyRoutes(app, { runsRepo: makeSupabaseRunsRepo() });

  const httpServer = createHttpServer(app);

  /* ---------------------------------------------------------------- */
  /* Socket.IO                                                         */
  /* ---------------------------------------------------------------- */

  const io: GeofightIO = new Server(httpServer, {
    cors: { origin: true },
    maxHttpBufferSize: MAX_HTTP_BUFFER_SIZE,
  });

  type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;

  /**
   * Find the room + seat for a connected socket via `socket.data` (O(seats in
   * one room), not a scan of every room). The seat must still list this socket
   * as its live connection — a seat taken over by a reconnect from another
   * socket, or removed from its room (leave, endGame's disconnected-seat sweep,
   * grace expiry, room deletion), no longer belongs to this socket; the stale
   * binding is then cleared.
   */
  function seatForSocket(socket: GameSocket): { room: Room; seat: Seat } | null {
    const { roomCode, playerId } = socket.data;
    if (roomCode === undefined || playerId === undefined) return null;
    const room = rooms.get(roomCode);
    const seat = room?.players.find((p) => p.id === playerId);
    if (!room || !seat || seat.socketId !== socket.id) {
      unbindSeat(socket);
      return null;
    }
    return { room, seat };
  }

  /** Attach `socket` to `seat` (both directions). */
  function bindSeat(socket: GameSocket, room: Room, seat: Seat): void {
    seat.socketId = socket.id;
    socket.data.roomCode = room.code;
    socket.data.playerId = seat.id;
  }

  /** Forget the socket's seat binding (optionally only if it is `seat`). */
  function unbindSeat(socket: GameSocket, seat?: Seat): void {
    if (seat && socket.data.playerId !== seat.id) return;
    socket.data.roomCode = undefined;
    socket.data.playerId = undefined;
  }

  function otherSeat(room: Room, seat: Seat): Seat | undefined {
    return room.players.find((p) => p.id !== seat.id);
  }

  /**
   * Snapshot for one viewer. Showdown snapshots are viewer-specific (only the
   * viewer's own answers); every other mode is the same for everyone.
   */
  function stateFor(room: Room, viewerId: string): ReturnType<typeof roomStateOf> {
    return roomStateOf(room, { viewerId });
  }

  function broadcastRoomState(room: Room): void {
    if (!isShowdown(room)) {
      io.to(room.code).emit("room_state", roomStateOf(room));
      return;
    }
    // Showdown: never broadcast everyone's boards — send each seat its own view.
    for (const seat of room.players) {
      if (seat.socketId) io.to(seat.socketId).emit("room_state", stateFor(room, seat.id));
    }
  }

  function emitError(socket: GameSocket, code: string, message: string): void {
    socket.emit("error_msg", { code, message });
  }

  function badPayload(socket: GameSocket): void {
    emitError(socket, "bad_payload", "Malformed request.");
  }

  /**
   * Run a timer/deferred callback so a throw can't escape to the top level and
   * crash the whole process (which would drop EVERY connected player at once,
   * not just this room). Errors are logged and contained.
   */
  function guard(label: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error(`timer error (${label}):`, err);
    }
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

    if (deleteIfAbandoned(room)) return;
    // Grace timers were just cleared, so a seat that dropped mid-match would sit
    // in the ended room forever (blocking every rematch). Drop those seats now;
    // their client will find the room gone / seat missing and head home.
    // (Swept seats have socketId === null, so no live socket is bound to them;
    // seatForSocket also rejects any stale socket.data pointing at them.)
    const gone = room.players.filter((p) => !p.connected);
    if (gone.length === 0) return;
    room.players = room.players.filter((p) => p.connected);
    for (const seat of gone) io.to(room.code).emit("player_left", { playerId: seat.id });
    if (!room.players.some((p) => p.id === room.hostId)) room.hostId = room.players[0].id;
    broadcastRoomState(room);
  }

  /** Dependencies passed to the last_standing turn machinery. */
  const lsDeps: LastStandingDeps = {
    io,
    endGame,
    otherSeat,
    turnDurationMs: (room) => turnMsOverride ?? room.settings.turnSeconds * 1000,
    revealMs,
    broadcastState: (room) => broadcastRoomState(room),
  };

  /** Dependencies passed to the showdown round machinery. */
  const showdownDeps: ShowdownDeps = {
    io,
    endGame,
    roundDurationMs: (room) => roundMsOverride ?? room.settings.turnSeconds * 1000,
    revealMs,
  };

  function startCountdownAndGame(room: Room): void {
    room.phase = "countdown";
    broadcastRoomState(room);

    let remaining = COUNTDOWN_SECONDS;
    io.to(room.code).emit("countdown", { seconds: remaining });

    room.countdownTimer = setInterval(() => guard("countdown", () => {
      remaining -= 1;
      if (remaining > 0) {
        io.to(room.code).emit("countdown", { seconds: remaining });
        return;
      }
      // Countdown finished — begin play.
      if (room.countdownTimer) clearInterval(room.countdownTimer);
      room.countdownTimer = undefined;

      room.phase = "playing";
      const raceMs = raceMsOverride ?? room.settings.timeLimitSeconds * 1000;
      room.endsAt = Date.now() + raceMs;
      io.to(room.code).emit("game_started", {
        categoryId: room.settings.categoryId,
        mode: room.settings.mode,
        total: totalFor(room.settings.categoryId),
        endsAt: room.endsAt,
      });
      if (isShowdown(room)) {
        // Showdown manages its own per-round clocks; drop the game-level one.
        room.endsAt = undefined;
        beginShowdown(showdownDeps, room);
        broadcastRoomState(room);
      } else if (isTurnBased(room)) {
        // Turn-based (last_standing / gauntlet): no shared round clock — begin
        // turn 1 (lives + first turn; gauntlet also seeds the opening prompt).
        beginFirstTurn(lsDeps, room);
        broadcastRoomState(room);
      } else {
        broadcastRoomState(room);
        room.roundTimer = setTimeout(
          () => guard("roundTimer", () => endGame(room)),
          raceMs,
        );
      }
    }), countdownTickMs);
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
      // Gauntlet/showdown snapshots read the per-prompt board, so clear it too
      // or the rematch lobby would still show last game's answers.
      seat.filledThisPrompt = undefined;
    }
  }

  /** Multiplayer rematch: once every remaining seat (2+) has asked, go to lobby. */
  function maybeStartRematch(room: Room): void {
    if (room.phase !== "ended") return;
    if (room.players.length < 2 || !room.players.every((p) => p.rematchRequested)) return;
    resetForRematch(room);
    broadcastRoomState(room);
    io.to(room.code).emit("rematch_start");
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
    unbindSeat(socket, seat);
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
    // The leaver may have been the last holdout on a pending rematch.
    maybeStartRematch(room);
  }

  /**
   * Voluntarily leave a room in any phase. During countdown/playing this is a
   * forfeit: the match ends with the remaining player as winner, then the seat
   * is removed.
   */
  function leaveRoom(socket: GameSocket, room: Room, seat: Seat): void {
    const live = room.phase === "countdown" || room.phase === "playing";
    // A 2-player duel (race or turn-based) forfeits to the remaining player.
    if (live && room.players.length <= 2) {
      // Stop the leaver from receiving the old room's game_over.
      socket.leave(room.code);
      seat.connected = false;
      seat.socketId = null;
      unbindSeat(socket, seat);
      const other = otherSeat(room, seat);
      endGame(room, other?.id);
      // endGame drops disconnected seats (incl. this one) itself; only tidy up
      // here if the seat is somehow still listed.
      if (room.players.includes(seat)) handleLeave(socket, room, seat);
      return;
    }
    // 3+ players: drop the seat and play on. Turn-based / showdown games then
    // re-resolve (advance the turn / end if only one survivor remains).
    const turnBasedLive = live && isTurnBased(room);
    const showdownLive = live && isShowdown(room);
    const leftId = seat.id;
    const leftSlot = seat.slot;
    handleLeave(socket, room, seat);
    if (turnBasedLive && rooms.has(room.code)) resolveAfterLeave(lsDeps, room, leftId, leftSlot);
    if (showdownLive && rooms.has(room.code)) resolveShowdownAfterLeave(showdownDeps, room);
  }

  io.on("connection", (socket: GameSocket) => {
    // Per-socket rate limits: answers get their own (tighter) bucket; every
    // other event shares a looser one. Over-limit packets are dropped before
    // any handler runs (so nothing is scored) and the client is told why.
    const answerBucket = answerLimit ? new TokenBucket(answerLimit, now) : null;
    const eventBucket = eventLimit ? new TokenBucket(eventLimit, now) : null;
    socket.use(([event], next) => {
      const bucket = event === "submit_answer" ? answerBucket : eventBucket;
      if (bucket && !bucket.take()) {
        emitError(socket, "rate_limited", "Slow down: too many requests.");
        return; // drop the packet
      }
      next();
    });

    // Clock sync: answer with the server's wall clock so the client can
    // estimate its offset and count down to our epoch-ms deadlines correctly
    // even when the device clock is skewed. Rate-limited by the generic bucket.
    socket.on(
      "time_sync",
      safe(socket, (raw: unknown) => {
        const ack = parseAck<[serverNow: number]>(raw);
        if (!ack) return badPayload(socket);
        ack(Date.now());
      }),
    );

    socket.on(
      "create_room",
      safe(socket, (raw: unknown) => {
        const payload = parseCreateRoom(raw);
        if (!payload) return badPayload(socket);
        // A socket holds at most one seat: vacate any previous room first.
        const prev = seatForSocket(socket);
        if (prev) leaveRoom(socket, prev.room, prev.seat);
        const { room, seat } = createRoom(payload.playerName);
        if (payload.solo) {
          // Private solo room: flagged solo and never joinable by a second player.
          room.solo = true;
          room.joinable = false;
        }
        bindSeat(socket, room, seat);
        socket.join(room.code);
        socket.emit("joined", {
          playerId: seat.id,
          slot: seat.slot,
          reconnectToken: seat.reconnectToken,
          state: stateFor(room, seat.id),
        });
      }),
    );

    socket.on(
      "join_room",
      safe(socket, (raw: unknown) => {
        const payload = parseJoinRoom(raw);
        if (!payload) return badPayload(socket);
        const { code, playerName: name } = payload;
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
            state: stateFor(room, prev.seat.id),
          });
          socket.emit("room_state", stateFor(room, prev.seat.id));
          return;
        }
        if (prev) {
          // Seated in a different room: vacate it before joining this one.
          leaveRoom(socket, prev.room, prev.seat);
        }

        // Reconnection path: token matches a (typically disconnected) seat.
        if (payload.reconnectToken) {
          const seat = room.players.find((p) => p.reconnectToken === payload.reconnectToken);
          if (seat) {
            const grace = room.graceTimers.get(seat.id);
            if (grace) {
              clearTimeout(grace);
              room.graceTimers.delete(seat.id);
            }
            bindSeat(socket, room, seat);
            seat.connected = true;
            socket.join(room.code);
            socket.emit("joined", {
              playerId: seat.id,
              slot: seat.slot,
              reconnectToken: seat.reconnectToken,
              state: stateFor(room, seat.id),
            });
            socket.to(room.code).emit("opponent_reconnected", { playerId: seat.id });
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
        if (room.players.length >= MAX_PLAYERS) {
          emitError(socket, "room_full", "That room is already full.");
          return;
        }
        // New seats only in the lobby (e.g. a solo round can't be joined mid-way).
        if (room.phase !== "lobby") {
          emitError(socket, "in_progress", "That game is already in progress.");
          return;
        }

        const seat = addPlayer(room, name);
        bindSeat(socket, room, seat);
        socket.join(room.code);
        socket.emit("joined", {
          playerId: seat.id,
          slot: seat.slot,
          reconnectToken: seat.reconnectToken,
          state: stateFor(room, seat.id),
        });
        socket.to(room.code).emit("player_joined", { player: seatToPublic(seat) });
        broadcastRoomState(room);
      }),
    );

    socket.on(
      "set_ready",
      safe(socket, (raw: unknown) => {
        const payload = parseSetReady(raw);
        if (!payload) return badPayload(socket);
        const ctx = seatForSocket(socket);
        if (!ctx) return;
        ctx.seat.ready = payload.ready;
        io.to(ctx.room.code).emit("player_ready", {
          playerId: ctx.seat.id,
          ready: ctx.seat.ready,
        });
        broadcastRoomState(ctx.room);
      }),
    );

    socket.on(
      "update_settings",
      safe(socket, (raw: unknown) => {
        const payload = parseUpdateSettings(raw);
        if (!payload) return badPayload(socket);
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
        const categoryId = payload.categoryId as CategoryId | undefined;
        if (categoryId !== undefined && !KNOWN_CATEGORIES.includes(categoryId)) {
          emitError(socket, "bad_category", "Unknown category.");
          return;
        }
        const mode = payload.mode as GameMode | undefined;
        if (mode !== undefined && !GAME_MODES.includes(mode)) {
          emitError(socket, "bad_mode", "Unknown mode.");
          return;
        }
        // Last Standing and Showdown are multiplayer-only. Gauntlet works solo
        // too (you race the prompts yourself).
        if ((mode === "last_standing" || mode === "showdown") && room.solo) {
          emitError(socket, "needs_two", "That mode needs a second player.");
          return;
        }
        if (payload.timeLimitSeconds !== undefined) {
          room.settings.timeLimitSeconds = clampTimeLimit(payload.timeLimitSeconds);
        }
        if (categoryId) {
          room.settings.categoryId = categoryId;
        }
        if (mode) {
          // Switching into Showdown defaults the round clock to 30s (the host can
          // still change it); other transitions keep the existing turn time.
          if (mode === "showdown" && room.settings.mode !== "showdown") {
            room.settings.turnSeconds = 30;
          }
          room.settings.mode = mode;
        }
        if (payload.turnSeconds !== undefined) {
          room.settings.turnSeconds = clampTurnSeconds(payload.turnSeconds);
        }
        if (payload.lives !== undefined) {
          room.settings.lives = clampLives(payload.lives);
        }
        // Gauntlet/Showdown need a prompt pool; a category without one (e.g.
        // us-states) leaves them unplayable, so fall back to race.
        if (
          (room.settings.mode === "gauntlet" || room.settings.mode === "showdown") &&
          buildPromptPool(room.settings.categoryId).length === 0
        ) {
          room.settings.mode = "race";
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
        // Last Standing and Showdown need a real opponent; Gauntlet works solo.
        if ((room.settings.mode === "last_standing" || room.settings.mode === "showdown") && solo) {
          emitError(socket, "needs_two", "That mode needs a second player.");
          return;
        }
        // Gauntlet and Showdown need a prompt pool (country sets only).
        if (
          (room.settings.mode === "gauntlet" || room.settings.mode === "showdown") &&
          buildPromptPool(room.settings.categoryId).length === 0
        ) {
          emitError(socket, "no_prompts", "That mode isn't available for this set.");
          return;
        }
        if (!solo && !room.players.every((p) => p.ready)) {
          emitError(socket, "not_ready", "Everyone must be ready.");
          return;
        }
        room.solo = solo;
        startCountdownAndGame(room);
      }),
    );

    socket.on(
      "submit_answer",
      safe(socket, (raw: unknown) => {
        const payload = parseSubmitAnswer(raw);
        if (!payload) return badPayload(socket);
        const ctx = seatForSocket(socket);
        if (!ctx) return;
        const { room, seat } = ctx;
        if (room.phase !== "playing") {
          socket.emit("answer_result", { accepted: false, reason: "not_playing" });
          return;
        }
        // Held on the end-of-prompt reveal: no answers until play resumes.
        if (room.revealEndsAt !== undefined) {
          socket.emit("answer_result", { accepted: false, reason: "not_playing" });
          return;
        }
        const { text } = payload;
        // No real answer is anywhere near this long: reject as wrong before
        // spending any time normalizing it (and without any mode side effects).
        if (text.length > MAX_ANSWER_LENGTH) {
          socket.emit("answer_result", { accepted: false, reason: "wrong" });
          return;
        }
        if (isShowdown(room)) {
          handleShowdownSubmit(showdownDeps, room, seat, socket, text);
          return;
        }
        if (isGauntlet(room)) {
          handleGauntletSubmit(lsDeps, room, seat, socket, text);
          return;
        }
        if (isLastStanding(room)) {
          lastStandingSubmit(lsDeps, room, seat, socket, text);
          return;
        }
        const categoryId = room.settings.categoryId;
        const outcome = scoreGuess(
          text,
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
            // Broadcast progress to everyone ELSE in the room (race renders every
            // player's map live, not just one opponent's).
            socket.to(room.code).emit("opponent_progress", {
              playerId: seat.id,
              isoCode: outcome.iso,
              // Self-healing: send the FULL named set so a client that missed
              // an earlier event repairs by replacing rather than appending.
              filled: [...seat.filled],
            });
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
        // Giving up is a solo-only action; in multiplayer it would let one
        // player end everyone's match (leave_room is the forfeit path there).
        if (!(ctx.room.solo && ctx.room.players.length === 1)) {
          emitError(socket, "not_solo", "Giving up is only available in solo games.");
          return;
        }
        if (ctx.room.phase !== "playing" && ctx.room.phase !== "countdown") return;
        endGame(ctx.room);
      }),
    );

    socket.on(
      "skip_reveal",
      safe0(socket, () => {
        const ctx = seatForSocket(socket);
        if (!ctx) return;
        const { room, seat } = ctx;
        if (room.phase !== "playing" || room.revealEndsAt === undefined) return;
        // The reveal advances early once every connected, in-game player votes.
        const eligible = room.players
          .filter((p) => p.connected && (room.lives?.[p.id] ?? 0) > 0)
          .map((p) => p.id);
        voteSkipReveal(io, room, seat.id, eligible);
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
        maybeStartRematch(room);
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
        // Surface connected:false (+ turn.pausedMs if the clock froze).
        broadcastRoomState(room);
        // Notify everyone else in the room (any of up to 3 other racers).
        socket.to(room.code).emit("opponent_disconnected", {
          playerId: seat.id,
          graceSeconds,
        });
        const timer = setTimeout(() => guard("grace", () => {
          room.graceTimers.delete(seat.id);
          if (seat.connected) return; // reconnected in time
          if (room.phase === "playing" || room.phase === "countdown") {
            if (room.players.length > 2) {
              // 3+ seats: drop the no-show. Race plays on; turn-based / showdown
              // re-resolve (advance the turn, or end if one survivor remains).
              const turnBasedLive = isTurnBased(room);
              const showdownLive = isShowdown(room);
              const leftId = seat.id;
              const leftSlot = seat.slot;
              handleLeave(socket, room, seat);
              if (turnBasedLive && rooms.has(room.code)) {
                resolveAfterLeave(lsDeps, room, leftId, leftSlot);
              }
              if (showdownLive && rooms.has(room.code)) resolveShowdownAfterLeave(showdownDeps, room);
            } else {
              // Duel → the present (connected) player wins, regardless of score.
              // If nobody is present, fall back to score.
              const present = room.players.find((p) => p.id !== seat.id && p.connected);
              endGame(room, present?.id);
            }
          } else {
            deleteIfAbandoned(room);
          }
        }), graceMs);
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
  // Last-resort safety net: a single stray throw / rejection must NOT take down
  // the whole server (which would drop every connected player at once). Log it
  // loudly and keep serving; per-room timers are already individually guarded.
  process.on("uncaughtException", (err) => {
    console.error("[uncaughtException] keeping server alive:", err);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection] keeping server alive:", reason);
  });

  const { httpServer } = createServer();
  httpServer.listen(PORT, () => {
    console.log(
      `geofight server listening on http://localhost:${PORT} (${totalFor("countries")} countries loaded)`,
    );
  });
}
