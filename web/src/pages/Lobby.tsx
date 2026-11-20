import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSocket } from "../lib/socket";
import { useSession, defaultName } from "../lib/session";
import GlitchWordmark from "../components/GlitchWordmark";
import { slotColor } from "../lib/colors";
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
];

const CATEGORIES: { value: CategoryId; label: string }[] = [
  { value: "countries", label: "Countries" },
  { value: "us-states", label: "US states" },
  { value: "europe", label: "Europe" },
  { value: "africa", label: "Africa" },
  { value: "asia", label: "Asia" },
  { value: "middle-east", label: "Middle East" },
  { value: "americas", label: "Americas" },
];

export default function Lobby() {
  const { code = "" } = useParams();
  const socket = useSocket();
  const navigate = useNavigate();
  const { playerName, setPlayerName, identity, setIdentity, identityRef } = useSession();

  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs survive StrictMode's simulated unmount/remount, so they let us emit
  // join_room exactly once per (socket, code) for this Lobby instance, and
  // remember whether the server has already seated us in this room.
  const joinSentRef = useRef<{ socket: unknown; code: string } | null>(null);
  const joinedCodeRef = useRef<string | null>(null);

  // Join on mount (create flow already joined, but re-emitting with the
  // reconnect token is harmless / supports direct-link joins, reconnects and
  // returning here after a rematch).
  useEffect(() => {
    const name = playerName.trim() || defaultName();
    if (!playerName.trim()) setPlayerName(name);

    function joinTokenFor() {
      const current = identityRef.current;
      // Only offer a reconnect token that belongs to this room.
      return current && (!current.roomCode || current.roomCode === code)
        ? current.reconnectToken
        : undefined;
    }
    function onJoined(payload: {
      playerId: string;
      slot: PlayerSlot;
      reconnectToken: string;
      state: RoomState;
    }) {
      setError(null);
      setIdentity({
        playerId: payload.playerId,
        slot: payload.slot,
        reconnectToken: payload.reconnectToken,
        roomCode: payload.state.code,
      });
      if (payload.state.code === code) joinedCodeRef.current = code;
      setRoom(payload.state);
    }
    function onRoomState(state: RoomState) {
      setError(null);
      setRoom(state);
    }
    function onConnect() {
      // (Re)claim our seat whenever the socket (re)connects — covers an initial
      // join_room that was emitted before the connection was ready, or a socket
      // reconnect, so joining by code works without needing a manual refresh.
      socket.emit("join_room", { code, playerName: name, reconnectToken: joinTokenFor() });
    }
    function onError(payload: { code: string; message: string }) {
      // A duplicate join (e.g. a stray re-emit) can bounce off our own seat as
      // room_full; that's not fatal once we're already seated in this room.
      if (payload.code === "room_full" && joinedCodeRef.current === code) return;
      setError(payload.message);
    }
    function goToGame() {
      navigate(`/game/${code}`);
    }

    socket.on("joined", onJoined);
    socket.on("room_state", onRoomState);
    socket.on("error_msg", onError);
    socket.on("countdown", goToGame);
    socket.on("game_started", goToGame);
    socket.on("connect", onConnect);

    const sent = joinSentRef.current;
    if (!sent || sent.socket !== socket || sent.code !== code) {
      joinSentRef.current = { socket, code };
      socket.emit("join_room", { code, playerName: name, reconnectToken: joinTokenFor() });
    }

    return () => {
      socket.off("joined", onJoined);
      socket.off("room_state", onRoomState);
      socket.off("error_msg", onError);
      socket.off("countdown", goToGame);
      socket.off("game_started", goToGame);
      socket.off("connect", onConnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, code]);

  // If the room is already playing (e.g. rejoin), jump to the game.
  useEffect(() => {
    if (room && (room.phase === "playing" || room.phase === "countdown")) {
      navigate(`/game/${code}`);
    }
  }, [room, navigate, code]);

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
  // Gauntlet is country-sets only — US states have no prompt pool.
  const gauntletAvailable = categoryId !== "us-states";
  // Modes this room can pick: Last Standing is versus-only; Gauntlet works solo
  // too but needs a prompt pool; Race is always available.
  const availableModes = MODES.filter((m) =>
    m.value === "last_standing" ? !solo : m.value === "gauntlet" ? gauntletAvailable : true,
  );
  const effectiveMode = availableModes.some((m) => m.value === mode) ? mode : "race";
  // Both Last Standing and Gauntlet use the per-turn clock + lives pickers.
  const turnBased = effectiveMode === "last_standing" || effectiveMode === "gauntlet";
  // All versus modes now seat up to MAX_PLAYERS.
  const seatCount = MAX_PLAYERS;

  const [copied, setCopied] = useState(false);
  async function copyCode() {
    try {
      const url = `${window.location.origin}/room/${code}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable */
    }
  }

  function leave() {
    socket.emit("leave_room");
    setIdentity(null);
    navigate("/");
  }

  function backHome() {
    setIdentity(null);
    navigate("/");
  }

  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-accent">{error}</p>
        <button
          onClick={backHome}
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

      {/* Room code / share + seats are versus-only; solo has neither. */}
      {!solo && (
        <>
          <section className="rounded-xl border border-border bg-surface p-5">
            <p className="text-sm text-muted">Room code</p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="text-3xl font-bold tracking-widest">{code}</span>
              <button
                onClick={copyCode}
                className="rounded-lg bg-surface-raised px-4 py-2 text-sm font-semibold transition hover:brightness-125"
              >
                {copied ? "Copied!" : "Share link"}
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
        {availableModes.length > 1 && (
          <>
            <p className="mb-2 text-sm font-semibold text-muted">Mode</p>
            <div className="mb-4 flex flex-wrap gap-2">
              {availableModes.map((m) => {
                const active = effectiveMode === m.value;
                return (
                  <button
                    key={m.value}
                    disabled={!isHost}
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
            <p className="mt-4 mb-2 text-sm font-semibold text-muted">Turn time</p>
            <div className="flex flex-wrap gap-2">
              {TURN_PRESETS.map((s) => {
                const active = room?.settings.turnSeconds === s;
                return (
                  <button
                    key={s}
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

            {/* Lives are Gauntlet-only; Last Standing is sudden death. */}
            {effectiveMode === "gauntlet" && (
              <>
                <p className="mt-4 mb-2 text-sm font-semibold text-muted">Lives</p>
                <div className="flex flex-wrap gap-2">
                  {LIVES_PRESETS.map((n) => {
                    const active = room?.settings.lives === n;
                    return (
                      <button
                        key={n}
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
        <span className="h-3 w-3 rounded-full" style={{ background: colorVar }} />
        <span className="text-xs text-muted">{label}</span>
      </div>
      <p className="mt-2 truncate text-lg font-semibold" style={{ color: player ? colorVar : undefined }}>
        {player?.name ?? "Waiting…"}
      </p>
      <p className="mt-1 text-sm">
        {player ? (
          player.ready ? (
            <span className="text-foreground">Ready</span>
          ) : (
            <span className="text-muted">Not ready</span>
          )
        ) : (
          <span className="text-muted">Empty seat</span>
        )}
      </p>
    </div>
  );
}
