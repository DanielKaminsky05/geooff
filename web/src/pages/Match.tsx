import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSocket } from "../lib/socket";
import { useSession } from "../lib/session";
import type { PlayerPublic, RoomState } from "../lib/protocol";
import WorldMap from "../components/WorldMap";
import ScoreBar from "../components/ScoreBar";
import CountryInput from "../components/CountryInput";

interface GameOver {
  winnerId: string | null;
  scores: Record<string, number>;
}

export default function Match() {
  const { code = "" } = useParams();
  const socket = useSocket();
  const navigate = useNavigate();
  const { identity, playerName, identityRef } = useSession();

  const [room, setRoom] = useState<RoomState | null>(null);
  const [total, setTotal] = useState<number>(0);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});

  const [myFilled, setMyFilled] = useState<Set<string>>(() => new Set());
  const [oppFilled, setOppFilled] = useState<Set<string>>(() => new Set());

  const [clearSignal, setClearSignal] = useState(0);
  const [rejectSignal, setRejectSignal] = useState(0);
  const [rejectMsg, setRejectMsg] = useState<string | null>(null);

  const [gameOver, setGameOver] = useState<GameOver | null>(null);
  const [rematchRequested, setRematchRequested] = useState(false);
  const [showOpponent, setShowOpponent] = useState(false); // mobile toggle

  const myId = identity?.playerId ?? null;
  const myIdRef = useRef<string | null>(myId);
  myIdRef.current = myId;

  useEffect(() => {
    function onRoomState(state: RoomState) {
      setRoom(state);
      if (state.total != null) setTotal(state.total);
      if (state.endsAt != null) setEndsAt(state.endsAt);
      // Rehydrate filled maps from snapshot if present.
      if (state.filled && myIdRef.current) {
        const mine = state.filled[myIdRef.current];
        if (mine) setMyFilled(new Set(mine));
        for (const [pid, isos] of Object.entries(state.filled)) {
          if (pid !== myIdRef.current) setOppFilled(new Set(isos));
        }
      }
    }
    function onGameStarted(p: { total: number; endsAt: number }) {
      setTotal(p.total);
      setEndsAt(p.endsAt);
      setGameOver(null);
      setMyFilled(new Set());
      setOppFilled(new Set());
      setScores({});
      setRematchRequested(false);
    }
    function onAnswerResult(p: {
      accepted: boolean;
      isoCode?: string;
      reason?: string;
    }) {
      if (p.accepted) {
        if (p.isoCode) {
          setMyFilled((prev) => {
            const next = new Set(prev);
            next.add(p.isoCode as string);
            return next;
          });
        }
        setClearSignal((n) => n + 1);
        setRejectMsg(null);
      } else {
        setRejectSignal((n) => n + 1);
        setRejectMsg(
          p.reason === "duplicate"
            ? "Already named"
            : p.reason === "wrong"
              ? "Not a match"
              : null,
        );
      }
    }
    function onScoreUpdate(p: { scores: Record<string, number> }) {
      setScores(p.scores);
    }
    function onOpponentProgress(p: { playerId: string; isoCode: string }) {
      if (p.playerId === myIdRef.current) return;
      setOppFilled((prev) => {
        const next = new Set(prev);
        next.add(p.isoCode);
        return next;
      });
    }
    function onGameOver(p: GameOver) {
      setGameOver({ winnerId: p.winnerId, scores: p.scores });
      setScores(p.scores);
      setEndsAt(null);
    }
    function onRematchStart() {
      navigate(`/room/${code}`);
    }
    function onRematchRequested() {
      setRematchRequested(true);
    }

    socket.on("room_state", onRoomState);
    socket.on("game_started", onGameStarted);
    socket.on("answer_result", onAnswerResult);
    socket.on("score_update", onScoreUpdate);
    socket.on("opponent_progress", onOpponentProgress);
    socket.on("game_over", onGameOver);
    socket.on("rematch_start", onRematchStart);
    socket.on("rematch_requested", onRematchRequested);

    // Ensure we're subscribed (covers hard refresh onto /game/:code).
    if (!room) {
      socket.emit("join_room", {
        code,
        playerName: playerName || "Player",
        reconnectToken: identityRef.current?.reconnectToken,
      });
    }

    return () => {
      socket.off("room_state", onRoomState);
      socket.off("game_started", onGameStarted);
      socket.off("answer_result", onAnswerResult);
      socket.off("score_update", onScoreUpdate);
      socket.off("opponent_progress", onOpponentProgress);
      socket.off("game_over", onGameOver);
      socket.off("rematch_start", onRematchStart);
      socket.off("rematch_requested", onRematchRequested);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, code]);

  const p1 = room?.players.find((p) => p.slot === "p1");
  const p2 = room?.players.find((p) => p.slot === "p2");
  const me = room?.players.find((p) => p.id === myId);
  const opponent = room?.players.find((p) => p.id !== myId);

  const myColor =
    me?.slot === "p2" ? "var(--color-player2)" : "var(--color-player1)";
  const oppColor =
    me?.slot === "p2" ? "var(--color-player1)" : "var(--color-player2)";

  const effectiveScores = useMemo(() => {
    const s = { ...scores };
    for (const p of room?.players ?? []) {
      if (s[p.id] == null) s[p.id] = p.score ?? 0;
    }
    return s;
  }, [scores, room]);

  function handleSubmit(text: string) {
    socket.emit("submit_answer", { text });
  }

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      {/* 1. Score bar */}
      <ScoreBar
        p1={p1}
        p2={p2}
        scores={effectiveScores}
        total={total}
        endsAt={endsAt}
        category="Countries"
      />

      {/* 2. Maps */}
      <section className="relative min-h-0 flex-1">
        {/* Desktop: side by side */}
        <div className="hidden h-full md:grid md:grid-cols-2">
          <MapPane
            title={`You${me ? ` · ${me.name}` : ""}`}
            colorVar={myColor}
            filled={myFilled}
            borderRight
          />
          <MapPane
            title={`Opponent${opponent ? ` · ${opponent.name}` : ""}`}
            colorVar={oppColor}
            filled={oppFilled}
          />
        </div>

        {/* Mobile: single map + toggle */}
        <div className="flex h-full flex-col md:hidden">
          <MapPane
            title={
              showOpponent
                ? `Opponent${opponent ? ` · ${opponent.name}` : ""}`
                : `You${me ? ` · ${me.name}` : ""}`
            }
            colorVar={showOpponent ? oppColor : myColor}
            filled={showOpponent ? oppFilled : myFilled}
          />
          <button
            onClick={() => setShowOpponent((s) => !s)}
            className="absolute right-3 top-3 rounded-lg bg-surface-raised px-3 py-2 text-sm font-semibold shadow"
          >
            {showOpponent ? "View yours" : "View opponent"}
          </button>
        </div>
      </section>

      {/* 3. Input */}
      <section className="border-t border-border bg-surface px-4 py-3">
        {rejectMsg && (
          <p className="mb-1 text-center text-sm text-accent">{rejectMsg}</p>
        )}
        <CountryInput
          onSubmit={handleSubmit}
          clearSignal={clearSignal}
          rejectSignal={rejectSignal}
          disabled={gameOver != null}
        />
      </section>

      {/* Game over overlay */}
      {gameOver && (
        <GameOverOverlay
          gameOver={gameOver}
          me={me}
          opponent={opponent}
          onRematch={() => {
            socket.emit("request_rematch");
            setRematchRequested(true);
          }}
          rematchRequested={rematchRequested}
          onHome={() => navigate("/")}
        />
      )}
    </main>
  );
}

function MapPane({
  title,
  colorVar,
  filled,
  borderRight,
}: {
  title: string;
  colorVar: string;
  filled: Set<string>;
  borderRight?: boolean;
}) {
  return (
    <div className={`relative flex h-full flex-col ${borderRight ? "md:border-r md:border-border" : ""}`}>
      <div className="absolute left-3 top-3 z-10 rounded-lg bg-surface/80 px-3 py-1 text-xs font-semibold" style={{ color: colorVar }}>
        {title} · {filled.size}
      </div>
      <WorldMap filledIso={filled} color={colorVar} className="h-full w-full" />
    </div>
  );
}

function GameOverOverlay({
  gameOver,
  me,
  opponent,
  onRematch,
  rematchRequested,
  onHome,
}: {
  gameOver: GameOver;
  me?: PlayerPublic;
  opponent?: PlayerPublic;
  onRematch: () => void;
  rematchRequested: boolean;
  onHome: () => void;
}) {
  const myScore = me ? (gameOver.scores[me.id] ?? 0) : 0;
  const oppScore = opponent ? (gameOver.scores[opponent.id] ?? 0) : 0;
  const result =
    gameOver.winnerId == null
      ? "It's a tie!"
      : me && gameOver.winnerId === me.id
        ? "You win!"
        : "You lose";

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/90 px-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 text-center">
        <h2 className="text-3xl font-bold">{result}</h2>
        <div className="mt-6 flex items-center justify-around">
          <div>
            <p className="text-sm text-muted">{me?.name ?? "You"}</p>
            <p className="text-3xl font-bold" style={{ color: "var(--color-player1)" }}>
              {myScore}
            </p>
          </div>
          <span className="text-2xl text-muted">vs</span>
          <div>
            <p className="text-sm text-muted">{opponent?.name ?? "Opponent"}</p>
            <p className="text-3xl font-bold" style={{ color: "var(--color-player2)" }}>
              {oppScore}
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3">
          <button
            onClick={onRematch}
            disabled={rematchRequested}
            className="rounded-xl bg-player1 px-6 py-3 font-semibold text-background transition hover:brightness-110 disabled:opacity-60"
          >
            {rematchRequested ? "Waiting for opponent…" : "Rematch"}
          </button>
          <button
            onClick={onHome}
            className="rounded-xl bg-surface-raised px-6 py-3 font-semibold transition hover:brightness-125"
          >
            Back to home
          </button>
        </div>
      </div>
    </div>
  );
}
