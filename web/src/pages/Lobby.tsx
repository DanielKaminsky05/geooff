import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSocket } from "../lib/socket";
import { useSession, defaultName } from "../lib/session";
import { useSocketEvents } from "../lib/useSocketEvents";
import GlitchWordmark from "../components/GlitchWordmark";
import { slotColor } from "../lib/colors";
import { CATEGORY_LABELS } from "../lib/geo";
import {
  TIME_LIMIT_MIN_SECONDS,
  TIME_LIMIT_MAX_SECONDS,
  TURN_SECONDS_MIN,
  TURN_SECONDS_MAX,
  LIVES_MIN,
  LIVES_MAX,
  MAX_PLAYERS,
  type RoomState,
  type PlayerPublic,
  type PlayerSlot,
  type CategoryId,
  type GameMode,
} from "../lib/protocol";

const SEAT_SLOTS: PlayerSlot[] = ["p1", "p2", "p3", "p4"];

const PRESETS = [
  { label: "1 min", seconds: 60 },
  { label: "3 min", seconds: 180 },
  { label: "5 min", seconds: 300 },
  { label: "10 min", seconds: 600 },
  { label: "15 min", seconds: 900 },
].filter(
  (p) => p.seconds >= TIME_LIMIT_MIN_SECONDS && p.seconds <= TIME_LIMIT_MAX_SECONDS,
);

const TURN_PRESETS = [5, 10, 15, 30, 60].filter(
  (s) => s >= TURN_SECONDS_MIN && s <= TURN_SECONDS_MAX,
);

const LIVES_PRESETS = Array.from(
  { length: LIVES_MAX - LIVES_MIN + 1 },
  (_, i) => LIVES_MIN + i,
);

const MODES: { value: GameMode; label: string }[] = [
  { value: "race", label: "Race" },
  { value: "last_standing", label: "Last Standing" },
  { value: "gauntlet", label: "Gauntlet" },
  { value: "showdown", label: "Showdown" },
];

/**
 * Errors that mean we never got a seat in this room — only these replace the
 * lobby with an error screen, and only before we've been seated. Everything
 * else (not_ready, not_host, locked, …) is a transient inline notice.
 */
const FATAL_JOIN_ERRORS = new Set(["room_not_found", "room_full", "in_progress", "not_joinable"]);

/** How long a recoverable error notice stays on screen. */
const NOTICE_MS = 4000;

/** How long "Copied!" shows after sharing the room link. */
const COPIED_MS = 1500;

/** Category picker order (labels come from the shared geo table). */
const CATEGORY_ORDER: CategoryId[] = [
  "countries",
  "us-states",
  "europe",
  "africa",
  "asia",
  "middle-east",
  "americas",
];
const CATEGORIES = CATEGORY_ORDER.map((value) => ({ value, label: CATEGORY_LABELS[value] }));

export default function Lobby() {
  // Server room codes are uppercase; normalize so a hand-typed /room/abc123
  // still matches the server's code in token/seat comparisons.
  const code = (useParams().code ?? "").toUpperCase();
  const socket = useSocket();
  const navigate = useNavigate();
  const { playerName, setPlayerName, identity, setIdentity, identityRef } = useSession();

  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Recoverable error shown inline; `id` restarts the dismiss timer on repeats.
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(null);

  // Refs survive StrictMode's simulated unmount/remount, so they let us emit
  // join_room exactly once per (socket, code) for this Lobby instance, and
  // remember whether the server has already seated us in this room.
  const joinSentRef = useRef<{ socket: unknown; code: string } | null>(null);
  const joinedCodeRef = useRef<string | null>(null);
  // Set when we leave on purpose (Leave / Back to home) or head into the game,
  // so the unmount safety net below doesn't emit leave_room a second time or
  // drop our seat on the way into the match.
  const exitHandledRef = useRef(false);
  const mountedRef = useRef(false);

  // Name to join with: the saved name, else one stable generated default.
  const [fallbackName] = useState(defaultName);
  const joinName = playerName.trim() || fallbackName;

  /** (Re)claim our seat. Only offers a reconnect token that belongs to this room. */
  function join() {
    const current = identityRef.current;
    const reconnectToken =
      current && (!current.roomCode || current.roomCode === code) ? current.reconnectToken : undefined;
    socket.emit("join_room", { code, playerName: joinName, reconnectToken });
  }

  function goToGame() {
    exitHandledRef.current = true;
    navigate(`/game/${code}`);
  }

  useSocketEvents({
    joined: (payload) => {
      setError(null);
      setIdentity({
        playerId: payload.playerId,
        slot: payload.slot,
        reconnectToken: payload.reconnectToken,
        roomCode: payload.state.code,
      });
      if (payload.state.code === code) joinedCodeRef.current = code;
      setRoom(payload.state);
    },
    room_state: (state) => {
      setError(null);
      setRoom(state);
    },
    error_msg: (payload) => {
      // A duplicate join (e.g. a stray re-emit) can bounce off our own seat as
      // room_full; that's not fatal once we're already seated in this room.
      const seated = joinedCodeRef.current === code;
      if (payload.code === "room_full" && seated) return;
      if (!seated && FATAL_JOIN_ERRORS.has(payload.code)) {
        setError(payload.message);
      } else {
        setNotice((prev) => ({ id: (prev?.id ?? 0) + 1, message: payload.message }));
      }
    },
    countdown: goToGame,
    game_started: goToGame,
    // (Re)claim our seat whenever the socket (re)connects — covers an initial
    // join_room emitted before the connection was ready, or a transport
    // reconnect. This page is the sole owner of that rejoin while it's shown.
    connect: join,
  });

  // Join on mount (create flow already joined, but re-emitting with the
  // reconnect token is harmless / supports direct-link joins, reconnects and
  // returning here after a rematch). Once per (socket, code), even under
  // StrictMode's double effect.
  const joinOnce = useEffectEvent(() => {
    if (!playerName.trim()) setPlayerName(joinName);
    const sent = joinSentRef.current;
    if (!sent || sent.socket !== socket || sent.code !== code) {
      joinSentRef.current = { socket, code };
      join();
    }
  });
  useEffect(() => {
    joinOnce();
  }, [socket, code]);

  // If the room is already playing (e.g. rejoin), jump to the game.
  useEffect(() => {
    if (room && (room.phase === "playing" || room.phase === "countdown")) {
      exitHandledRef.current = true;
      navigate(`/game/${code}`);
    }
  }, [room, navigate, code]);

  // Auto-dismiss the inline notice.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  // Leaving the lobby any other way (browser back, an in-app link) must free
  // our seat too, or a ghost player lingers in the room. The check is deferred
  // a microtask so StrictMode's simulated unmount/remount doesn't trigger it.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      queueMicrotask(() => {
        if (mountedRef.current || exitHandledRef.current) return;
        exitHandledRef.current = true;
        socket.emit("leave_room");
      });
    };
  }, [socket]);

  const me = useMemo(
    () => room?.players.find((p) => p.id === identity?.playerId),
    [room, identity],
  );
  const isHost = room != null && identity != null && room.hostId === identity.playerId;
  const bothReady =
    room != null && room.players.length >= 2 && room.players.every((p) => p.ready);
  const alone = room != null && room.players.length === 1;
  const solo = room?.solo === true;
  const mode = room?.settings.mode ?? "race";
  const categoryId = room?.settings.categoryId ?? "countries";
  // Gauntlet/Showdown are country-sets only — US states have no prompt pool.
  const promptAvailable = categoryId !== "us-states";
  // Modes this room can pick: Last Standing + Showdown are versus-only (and
  // Showdown also needs a prompt pool); Gauntlet works solo but needs a pool;
  // Race is always available.
  const availableModes = MODES.filter((m) =>
    m.value === "last_standing"
      ? !solo
      : m.value === "gauntlet"
        ? promptAvailable
        : m.value === "showdown"
          ? !solo && promptAvailable
          : true,
  );
  // Render the server's mode as-is (it resets to Race itself when a category
  // change makes the mode unavailable). If it's momentarily outside the
  // available set, still show it — selected but disabled — rather than
  // pretending it's Race.
  const modeOptions = availableModes.some((m) => m.value === mode)
    ? availableModes
    : [...availableModes, ...MODES.filter((m) => m.value === mode)];
  const effectiveMode = mode;
  // Last Standing, Gauntlet, and Showdown all use the per-turn/round clock.
  const turnBased =
    effectiveMode === "last_standing" ||
    effectiveMode === "gauntlet" ||
    effectiveMode === "showdown";
  // All versus modes now seat up to MAX_PLAYERS.
  const seatCount = MAX_PLAYERS;

  // `copied` is a counter so a repeat copy restarts the reset timer; the
  // effect's cleanup also clears it if we leave the lobby mid-way.
  const [copied, setCopied] = useState(0);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(0), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);
  async function copyCode() {
    try {
      const url = `${window.location.origin}/room/${code}`;
      await navigator.clipboard.writeText(url);
      if (mountedRef.current) setCopied((n) => n + 1);
    } catch {
      /* clipboard may be unavailable */
    }
  }

  function leave() {
    exitHandledRef.current = true;
    socket.emit("leave_room");
    setIdentity(null);
    navigate("/");
  }

  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-accent">{error}</p>
        <button
          onClick={leave}
          className="rounded-xl bg-surface-raised px-5 py-3 font-semibold"
        >
          Back to home
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-bold">
          <GlitchWordmark className="text-sm sm:text-base" />
          <span className="font-semibold text-muted">{solo ? "solo" : "lobby"}</span>
        </h1>
        <button
          onClick={leave}
          className="text-sm text-muted hover:text-foreground"
        >
          Leave
        </button>
      </header>

      <div role="status" aria-live="polite" className="empty:hidden">
        {notice && (
          <p className="rounded-xl border border-accent bg-surface px-4 py-3 text-sm text-accent">
            {notice.message}
          </p>
        )}
      </div>

      {/* Room code / share + seats are versus-only; solo has neither. */}
      {!solo && (
        <>
          <section className="rounded-xl border border-border bg-surface p-5">
            <p className="text-sm text-muted">Room code</p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="text-3xl font-bold tracking-widest">{code}</span>
              <button
                type="button"
                onClick={copyCode}
                className="rounded-lg bg-surface-raised px-4 py-2 text-sm font-semibold transition hover:brightness-125"
              >
                <span aria-live="polite">{copied ? "Copied!" : "Share link"}</span>
              </button>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3">
            {SEAT_SLOTS.slice(0, seatCount).map((slot, i) => (
              <PlayerCard
                key={slot}
                player={room?.players.find((p) => p.slot === slot)}
                colorVar={slotColor(slot)}
                label={`Player ${i + 1}`}
              />
            ))}
          </section>
        </>
      )}

      {/* Settings (host-only controls, read-only for guest) */}
      <section className="rounded-xl border border-border bg-surface p-5">
        {/* Mode picker — shown when the room has a real choice (solo offers
            Race + Gauntlet; versus adds Last Standing). */}
        {modeOptions.length > 1 && (
          <>
            <p className="mb-2 text-sm font-semibold text-muted">Mode</p>
            <div className="mb-4 flex flex-wrap gap-2">
              {modeOptions.map((m) => {
                const active = effectiveMode === m.value;
                const available = availableModes.includes(m);
                return (
                  <button
                    key={m.value}
                    type="button"
                    aria-pressed={active}
                    disabled={!isHost || !available}
                    onClick={() => socket.emit("update_settings", { mode: m.value })}
                    className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                      active
                        ? "border-foreground bg-surface-raised text-foreground"
                        : "border-border bg-surface text-muted hover:text-foreground hover:brightness-125"
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <p className="mb-2 text-sm font-semibold text-muted">Set</p>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => {
            const active = categoryId === c.value;
            return (
              <button
                key={c.value}
                type="button"
                aria-pressed={active}
                disabled={!isHost}
                onClick={() => socket.emit("update_settings", { categoryId: c.value })}
                className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? "border-foreground bg-surface-raised text-foreground"
                    : "border-border bg-surface text-muted hover:text-foreground hover:brightness-125"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        {turnBased ? (
          <>
            <p className="mt-4 mb-2 text-sm font-semibold text-muted">
              {effectiveMode === "showdown" ? "Round time" : "Turn time"}
            </p>
            <div className="flex flex-wrap gap-2">
              {TURN_PRESETS.map((s) => {
                const active = room?.settings.turnSeconds === s;
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={active}
                    disabled={!isHost}
                    onClick={() => socket.emit("update_settings", { turnSeconds: s })}
                    className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                      active
                        ? "border-foreground bg-surface-raised text-foreground"
                        : "border-border bg-surface text-muted hover:text-foreground hover:brightness-125"
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {s}s
                  </button>
                );
              })}
            </div>

            {/* Lives: Gauntlet and Showdown use hearts; Last Standing is sudden death. */}
            {(effectiveMode === "gauntlet" || effectiveMode === "showdown") && (
              <>
                <p className="mt-4 mb-2 text-sm font-semibold text-muted">Lives</p>
                <div className="flex flex-wrap gap-2">
                  {LIVES_PRESETS.map((n) => {
                    const active = room?.settings.lives === n;
                    return (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={active}
                        disabled={!isHost}
                        onClick={() => socket.emit("update_settings", { lives: n })}
                        className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                          active
                            ? "border-foreground bg-surface-raised text-foreground"
                            : "border-border bg-surface text-muted hover:text-foreground hover:brightness-125"
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <p className="mt-4 mb-2 text-sm font-semibold text-muted">Time limit</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => {
                const active = room?.settings.timeLimitSeconds === p.seconds;
                return (
                  <button
                    key={p.seconds}
                    type="button"
                    aria-pressed={active}
                    disabled={!isHost}
                    onClick={() => socket.emit("update_settings", { timeLimitSeconds: p.seconds })}
                    className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                      active
                        ? "border-foreground bg-surface-raised text-foreground"
                        : "border-border bg-surface text-muted hover:text-foreground hover:brightness-125"
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {!isHost && (
          <p className="mt-3 text-xs text-muted">Only the host can change settings.</p>
        )}
      </section>

      {/* Start */}
      <section className="mt-auto flex flex-col gap-3">
        {solo ? (
          <button
            onClick={() => socket.emit("start_game")}
            className="rounded-xl bg-accent px-6 py-4 text-lg font-semibold text-background transition hover:brightness-110"
          >
            Start
          </button>
        ) : (
          <>
            <button
              onClick={() => socket.emit("set_ready", { ready: !me?.ready })}
              disabled={!me}
              className={`rounded-xl border px-6 py-4 text-lg font-semibold transition disabled:opacity-50 ${
                me?.ready
                  ? "border-border bg-surface text-muted hover:brightness-125"
                  : "border-foreground bg-surface-raised text-foreground hover:brightness-125"
              }`}
            >
              {me?.ready ? "Not ready" : "Ready up"}
            </button>

            {isHost && (
              <button
                onClick={() => socket.emit("start_game")}
                disabled={!bothReady}
                className="rounded-xl bg-accent px-6 py-4 text-lg font-semibold text-background transition hover:brightness-110 disabled:opacity-40"
              >
                {bothReady
                  ? "Start game"
                  : alone
                    ? "Waiting for a player…"
                    : "Waiting for everyone to ready up…"}
              </button>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function PlayerCard({
  player,
  colorVar,
  label,
}: {
  player?: PlayerPublic;
  colorVar: string;
  label: string;
}) {
  return (
    <div
      className="rounded-xl border bg-surface p-4"
      style={{ borderColor: player ? colorVar : "var(--color-border)" }}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ background: colorVar }} />
        <span className="text-xs text-muted">{label}</span>
      </div>
      <p className="mt-2 truncate text-lg font-semibold" style={{ color: player ? colorVar : undefined }}>
        {player?.name ?? "Waiting…"}
      </p>
      <p className="mt-1 text-sm">
        {player ? (
          // Icon + word (not colour alone) for the ready state.
          player.ready ? (
            <span className="font-semibold text-foreground">
              <span aria-hidden="true">✓ </span>Ready
            </span>
          ) : (
            <span className="text-muted">
              <span aria-hidden="true">○ </span>Not ready
            </span>
          )
        ) : (
          <span className="text-muted">Empty seat</span>
        )}
      </p>
    </div>
  );
}
