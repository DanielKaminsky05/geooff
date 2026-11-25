import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSocket } from "../lib/socket";
import { useSession, defaultName } from "../lib/session";
import OutlineMap from "../components/OutlineMap";
import JournalVignette from "../components/JournalVignette";
import type { PlayerSlot } from "../lib/protocol";

/** Give up on "Starting…" if the server hasn't answered create_room by then. */
const CREATE_TIMEOUT_MS = 10_000;

export default function Home() {
  const socket = useSocket();
  const navigate = useNavigate();
  const { playerName, setPlayerName, setIdentity } = useSession();
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState<"versus" | "solo" | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const creatingRef = useRef(creating);
  useEffect(() => {
    creatingRef.current = creating;
  }, [creating]);

  useEffect(() => {
    function onJoined(payload: {
      playerId: string;
      slot: PlayerSlot;
      reconnectToken: string;
      state: { code: string };
    }) {
      setIdentity({
        playerId: payload.playerId,
        slot: payload.slot,
        reconnectToken: payload.reconnectToken,
        roomCode: payload.state.code,
      });
      // Both flows land in /room/:code; the lobby renders a solo setup or the
      // multiplayer lobby depending on the room's `solo` flag.
      navigate(`/room/${payload.state.code}`);
    }
    function onError(payload: { code: string; message: string }) {
      setCreating(null);
      setCreateError(payload.message);
    }
    function onConnectError() {
      // Only relevant while a create is pending; otherwise ignore blips.
      if (!creatingRef.current) return;
      setCreating(null);
      setCreateError("Couldn't reach the server. Please try again.");
    }
    socket.on("joined", onJoined);
    socket.on("error_msg", onError);
    socket.on("connect_error", onConnectError);
    return () => {
      socket.off("joined", onJoined);
      socket.off("error_msg", onError);
      socket.off("connect_error", onConnectError);
    };
  }, [socket, navigate, setIdentity]);

  // Fallback: if neither joined nor an error arrives, stop "Starting…".
  useEffect(() => {
    if (!creating) return;
    const t = setTimeout(() => {
      setCreating(null);
      setCreateError("The server didn't respond. Please try again.");
    }, CREATE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [creating]);

  function handleCreate(solo: boolean) {
    const name = playerName.trim() || defaultName();
    setPlayerName(name);
    setCreateError(null);
    setCreating(solo ? "solo" : "versus");
    socket.emit("create_room", { playerName: name, solo });
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    const name = playerName.trim() || defaultName();
    setPlayerName(name);
    navigate(`/room/${trimmed}`);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-9 px-6 py-16">
      {/* Walnut cover framing the whole page. */}
      <div aria-hidden className="journal-frame" />

      {/* Faint solid-outline world map filling the journal page. */}
      <div aria-hidden className="home-bg">
        <OutlineMap />
      </div>

      {/* Masthead: an illustrated landscape plate taped to the page, with the
          wordmark below the scene and a red wax seal in the corner. */}
      <header className="relative flex flex-col items-center">
        <div className="journal-plate relative">
          <span aria-hidden className="tape tape-tl" />
          <span aria-hidden className="tape tape-tr" />
          <div className="plate-scene">
            <JournalVignette />
          </div>
          <div className="plate-caption">
            <h1 className="font-display text-2xl leading-none tracking-wide text-foreground sm:text-[1.7rem]">
              GEOFIGHT
            </h1>
            <p className="plate-sub">— a world to name —</p>
          </div>
          <span aria-hidden className="wax-seal" />
        </div>
        <p className="mt-5 text-[0.7rem] tracking-[0.25em] text-muted uppercase sm:text-xs">
          geography against friends
        </p>
      </header>

      <div className="flex w-full max-w-sm flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-semibold text-muted">
          Your name
          <input
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Enter a name"
            maxLength={24}
            className="rounded-lg border border-border bg-surface px-4 py-3 text-base text-foreground shadow-[0_1px_0_rgba(58,47,35,0.12)] outline-none focus:border-accent"
          />
        </label>

        <button
          type="button"
          onClick={() => handleCreate(false)}
          disabled={creating != null}
          className="rounded-lg border border-foreground/70 bg-surface-raised px-6 py-4 text-lg font-semibold text-foreground shadow-[0_1px_0_rgba(58,47,35,0.18)] transition hover:bg-surface disabled:opacity-60"
        >
          {creating === "versus" ? "Starting lobby…" : "Start a lobby"}
        </button>

        <button
          type="button"
          onClick={() => handleCreate(true)}
          disabled={creating != null}
          className="rounded-lg border border-border bg-surface px-6 py-3 font-semibold text-foreground shadow-[0_1px_0_rgba(58,47,35,0.12)] transition hover:bg-surface-raised disabled:opacity-60"
        >
          {creating === "solo" ? "Starting…" : "Play solo"}
        </button>

        {createError && (
          <p role="alert" className="text-center text-sm font-semibold text-accent">
            {createError}
          </p>
        )}

        <form className="flex gap-2" onSubmit={handleJoin}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ROOM CODE"
            maxLength={6}
            className="flex-1 rounded-lg border border-border bg-surface px-4 py-3 text-center text-lg uppercase tracking-widest text-foreground placeholder:tracking-normal placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={code.length === 0}
            className="rounded-lg border border-foreground/70 bg-surface-raised px-5 py-3 font-semibold text-foreground shadow-[0_1px_0_rgba(58,47,35,0.18)] transition hover:bg-surface disabled:opacity-40"
          >
            Join
          </button>
        </form>
      </div>
    </main>
  );
}
