import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSocket } from "../lib/socket";
import { useSession, defaultName } from "../lib/session";

export default function Home() {
  const socket = useSocket();
  const navigate = useNavigate();
  const { playerName, setPlayerName, setIdentity } = useSession();
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState<"versus" | "solo" | null>(null);
  const soloRef = useRef(false);

  useEffect(() => {
    function onJoined(payload: {
      playerId: string;
      slot: "p1" | "p2";
      reconnectToken: string;
      state: { code: string };
    }) {
      setIdentity({
        playerId: payload.playerId,
        slot: payload.slot,
        reconnectToken: payload.reconnectToken,
        roomCode: payload.state.code,
      });
      // Solo: the lobby starts the round as soon as it has seated us.
      const url = `/room/${payload.state.code}`;
      if (soloRef.current) navigate(url, { state: { autoStartSolo: true } });
      else navigate(url);
    }
    socket.on("joined", onJoined);
    return () => {
      socket.off("joined", onJoined);
    };
  }, [socket, navigate, setIdentity]);

  function handleCreate(solo = false) {
    const name = playerName.trim() || defaultName();
    setPlayerName(name);
    soloRef.current = solo;
    setCreating(solo ? "solo" : "versus");
    socket.emit("create_room", { playerName: name });
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
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 px-6 py-16">
      <header className="text-center">
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
          geo
          <span className="text-player1">off</span>
        </h1>
        <p className="mt-3 max-w-md text-muted">
          Two players, one map. Race to name more countries of the world and see
          who knows the globe better.
        </p>
      </header>

      <div className="flex w-full max-w-sm flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-muted">
          Your name
          <input
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Enter a name"
            maxLength={24}
            className="rounded-xl border border-border bg-surface px-4 py-3 text-base text-foreground outline-none focus:border-player1"
          />
        </label>

        <button
          type="button"
          onClick={() => handleCreate()}
          disabled={creating != null}
          className="rounded-xl bg-player1 px-6 py-4 text-lg font-semibold text-background transition hover:brightness-110 disabled:opacity-60"
        >
          {creating === "versus" ? "Creating…" : "Create a game"}
        </button>

        <button
          type="button"
          onClick={() => handleCreate(true)}
          disabled={creating != null}
          className="rounded-xl border border-border bg-surface px-6 py-3 font-semibold transition hover:brightness-125 disabled:opacity-60"
        >
          {creating === "solo" ? "Starting…" : "Play solo"}
        </button>

        <div className="flex items-center gap-3 text-sm text-muted">
          <span className="h-px flex-1 bg-border" />
          or join
          <span className="h-px flex-1 bg-border" />
        </div>

        <form className="flex gap-2" onSubmit={handleJoin}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ROOM CODE"
            maxLength={6}
            className="flex-1 rounded-xl border border-border bg-surface px-4 py-3 text-center text-lg uppercase tracking-widest placeholder:tracking-normal placeholder:text-muted focus:border-player1 focus:outline-none"
          />
          <button
            type="submit"
            disabled={code.length === 0}
            className="rounded-xl bg-surface-raised px-5 py-3 font-semibold transition hover:brightness-125 disabled:opacity-40"
          >
            Join
          </button>
        </form>
      </div>

      <footer className="text-xs text-muted">
        First to name the most countries wins.
      </footer>
    </main>
  );
}
