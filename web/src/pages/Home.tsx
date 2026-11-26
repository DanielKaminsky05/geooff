import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSocket } from "../lib/socket";
import { useSession, defaultName } from "../lib/session";
import OutlineMap from "../components/OutlineMap";
import GlitchWordmark from "../components/GlitchWordmark";
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
  // Daily Trek entry: zoom the atlas in + fade the UI, then navigate.
  const [diving, setDiving] = useState(false);
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

  /** Enter the Daily Trek with a short zoom-into-the-map transition (skipped for
   *  reduced-motion users, who navigate straight there). */
  function startDaily() {
    if (diving) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      navigate("/daily");
      return;
    }
    setDiving(true);
    window.setTimeout(() => navigate("/daily"), 620);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-9 overflow-hidden px-6 py-16">
      {/* Walnut cover framing the whole page. */}
      <div aria-hidden className="journal-frame" />

      {/* Faint solid-outline world map filling the journal page. On a Daily Trek
          it zooms in to carry the eye onto the map before the route loads. */}
      <div
        aria-hidden
        className="home-bg"
        style={{
          transform: diving ? "scale(2.6)" : "scale(1)",
          transition: "transform 620ms cubic-bezier(0.4, 0, 0.2, 1)",
          willChange: "transform",
        }}
      >
        <OutlineMap />
      </div>

      {/* Masthead: the red GEOFIGHT wordmark standing directly on the atlas,
          with a stitched rule and the tagline below. */}
      <header
        className="relative flex flex-col items-center"
        style={{
          opacity: diving ? 0 : 1,
          transform: diving ? "scale(0.96)" : "scale(1)",
          transition: "opacity 380ms ease, transform 620ms ease",
        }}
      >
        <h1 className="leading-none">
          <GlitchWordmark className="text-3xl tracking-wide sm:text-4xl" />
        </h1>
        <hr aria-hidden className="stitch mt-4 w-40" />
        <p className="mt-3 inline-block rounded-full border border-accent/40 bg-surface/85 px-3.5 py-1 text-[0.7rem] font-semibold tracking-[0.25em] text-accent uppercase shadow-[0_1px_0_rgba(58,47,35,0.12)] sm:text-xs">
          geography against friends
        </p>
      </header>

      <div
        className="flex w-full max-w-sm flex-col gap-4"
        style={{
          opacity: diving ? 0 : 1,
          transform: diving ? "scale(0.96)" : "scale(1)",
          transition: "opacity 380ms ease, transform 620ms ease",
          pointerEvents: diving ? "none" : undefined,
        }}
      >
        <button
          type="button"
          onClick={startDaily}
          className="group rounded-lg border border-accent/50 bg-surface-raised px-6 py-4 text-left shadow-[0_1px_0_rgba(58,47,35,0.18)] transition hover:bg-surface"
        >
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-lg font-semibold text-accent">Daily Trek</span>
            <span className="text-[0.7rem] font-semibold tracking-[0.2em] text-muted uppercase">
              New
            </span>
          </span>
          <span className="mt-0.5 block text-sm text-muted">
            Today&rsquo;s journey — five prompts, one run, chase the gold.
          </span>
        </button>

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
