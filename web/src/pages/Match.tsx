import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSocket } from "../lib/socket";
import { useSession } from "../lib/session";
import type { CategoryId, GamePhase, PlayerPublic, PlayerSlot, RoomState } from "../lib/protocol";
import WorldMap from "../components/WorldMap";
import ScoreBar from "../components/ScoreBar";
import CountryInput from "../components/CountryInput";
import NamedCountries from "../components/NamedCountries";
import ProgressBar from "../components/ProgressBar";
import TurnTimer from "../components/TurnTimer";

interface GameOver {
  winnerId: string | null;
  scores: Record<string, number>;
}

/** Display label per set, shown in the score bar / toggles. */
const CATEGORY_LABELS: Record<CategoryId, string> = {
  countries: "Countries",
  "us-states": "US states",
  europe: "Europe",
  africa: "Africa",
  asia: "Asia",
  "middle-east": "Middle East",
  americas: "Americas",
};

function slotColor(slot: PlayerSlot | undefined): string {
  return slot === "p2" ? "var(--color-player2)" : "var(--color-player1)";
}

function otherSlot(slot: PlayerSlot | undefined): PlayerSlot {
  return slot === "p2" ? "p1" : "p2";
}

export default function Match() {
  const { code = "" } = useParams();
  const socket = useSocket();
  const navigate = useNavigate();
  const { identity, playerName, identityRef, setIdentity } = useSession();

  const [room, setRoom] = useState<RoomState | null>(null);
  const [phase, setPhase] = useState<GamePhase | null>(null);
  const [total, setTotal] = useState<number>(0);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});

  const [myFilled, setMyFilled] = useState<Set<string>>(() => new Set());
  const [oppFilled, setOppFilled] = useState<Set<string>>(() => new Set());

  // last_standing turn + lives state.
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);
  const [turnEndsAt, setTurnEndsAt] = useState<number | null>(null);
  const [lives, setLives] = useState<Record<string, number>>({});
  // Per-player life-loss counters → replay the hearts hit FX + "−1" in the bar.
  const [hits, setHits] = useState<Record<string, number>>({});
  // Full-screen flash: red when I take a hit, green when the opponent does.
  const [flash, setFlash] = useState<{ kind: "damage" | "gain"; key: number } | null>(null);
  const [shaking, setShaking] = useState(false); // screen shake on my (non-fatal) hit
  const [breaking, setBreaking] = useState(false); // my final life → heart-break sequence
  const fxSeq = useRef(0);

  const [clearSignal, setClearSignal] = useState(0);
  const [rejectSignal, setRejectSignal] = useState(0);
  const [rejectMsg, setRejectMsg] = useState<string | null>(null);

  const [gameOver, setGameOver] = useState<GameOver | null>(null);
  const [myRematch, setMyRematch] = useState(false);
  const [oppRematch, setOppRematch] = useState(false);
  const [showOpponent, setShowOpponent] = useState(false); // mobile toggle

  /** 3-2-1 overlay: seconds left, "ready" (in countdown but no tick seen yet), or null. */
  const [countdown, setCountdown] = useState<number | "ready" | null>(null);
  /** Own socket dropped; waiting for socket.io to reconnect. */
  const [reconnecting, setReconnecting] = useState(false);
  /** Epoch ms when the opponent's reconnect grace runs out; null = connected. */
  const [oppGraceEndsAt, setOppGraceEndsAt] = useState<number | null>(null);

  const myId = identity?.playerId ?? null;
  const myIdRef = useRef<string | null>(myId);
  myIdRef.current = myId;

  useEffect(() => {
    function onRoomState(state: RoomState) {
      setRoom(state);
      setPhase(state.phase);
      if (state.phase !== "ended") setGameOver(null);
      if (state.phase === "countdown") {
        setCountdown((c) => c ?? "ready");
      } else {
        setCountdown(null);
      }
      if (state.total != null) setTotal(state.total);
      if (state.endsAt != null && state.phase === "playing") setEndsAt(state.endsAt);
      // Rehydrate filled maps from snapshot if present.
      if (state.filled && myIdRef.current) {
        const mine = state.filled[myIdRef.current];
        if (mine) setMyFilled(new Set(mine));
        for (const [pid, isos] of Object.entries(state.filled)) {
          if (pid !== myIdRef.current) setOppFilled(new Set(isos));
        }
      }
      // Rehydrate last_standing turn + lives from snapshot if present.
      if (state.turn) {
        setCurrentPlayerId(state.turn.currentPlayerId);
        setTurnEndsAt(state.turn.endsAt);
      }
      if (state.lives) setLives(state.lives);
    }
    function onJoined(p: {
      playerId: string;
      slot: PlayerSlot;
      reconnectToken: string;
      state: RoomState;
    }) {
      myIdRef.current = p.playerId;
      setIdentity({
        playerId: p.playerId,
        slot: p.slot,
        reconnectToken: p.reconnectToken,
        roomCode: code,
      });
      setReconnecting(false);
      if (p.state) onRoomState(p.state);
    }
    function onCountdown(p: { seconds: number }) {
      setPhase("countdown");
      setCountdown(p.seconds);
      setGameOver(null);
      setMyRematch(false);
    }
    function onGameStarted(p: { total: number; endsAt: number }) {
      setPhase("playing");
      setCountdown(null);
      setTotal(p.total);
      setEndsAt(p.endsAt);
      setGameOver(null);
      setMyFilled(new Set());
      setOppFilled(new Set());
      setScores({});
      setMyRematch(false);
      setOppRematch(false);
      setOppGraceEndsAt(null);
      setCurrentPlayerId(null);
      setTurnEndsAt(null);
      setLives({});
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
              : p.reason === "not_your_turn"
                ? "Not your turn"
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
    function onTurnStarted(p: { playerId: string; endsAt: number }) {
      setCurrentPlayerId(p.playerId);
      setTurnEndsAt(p.endsAt);
      setRejectMsg(null);
    }
    function onLifeLost(p: { playerId: string; livesLeft: number }) {
      setLives((prev) => ({ ...prev, [p.playerId]: p.livesLeft }));
      // Pop the hearts + "−1" for whoever lost one.
      setHits((h) => ({ ...h, [p.playerId]: (h[p.playerId] ?? 0) + 1 }));

      const mine = p.playerId === myIdRef.current;
      if (mine && p.livesLeft === 0) {
        // My final life: a heart breaks in the center before the lose screen.
        setBreaking(true);
        setTimeout(() => setBreaking(false), 1700);
        return;
      }
      // Otherwise a vignette flash — red for my hit, green for the opponent's.
      const key = (fxSeq.current += 1);
      setFlash({ kind: mine ? "damage" : "gain", key });
      setTimeout(() => setFlash((cur) => (cur && cur.key === key ? null : cur)), 550);
      if (mine) {
        setShaking(true);
        setTimeout(() => setShaking(false), 450);
      }
    }
    function onGameOver(p: GameOver) {
      setPhase("ended");
      setCountdown(null);
      setGameOver({ winnerId: p.winnerId, scores: p.scores });
      setScores(p.scores);
      setEndsAt(null);
      setOppGraceEndsAt(null);
    }
    function onRematchStart() {
      navigate(`/room/${code}`);
    }
    function onRematchRequested(p?: { playerId?: string }) {
      // Broadcast to the whole room: distinguish my request from theirs.
      if (p?.playerId != null && p.playerId !== myIdRef.current) {
        setOppRematch(true);
      } else {
        setMyRematch(true);
      }
    }
    function onOpponentDisconnected(p: { playerId: string; graceSeconds: number }) {
      if (p.playerId === myIdRef.current) return;
      setOppGraceEndsAt(Date.now() + p.graceSeconds * 1000);
    }
    function onOpponentReconnected(p: { playerId: string }) {
      if (p.playerId === myIdRef.current) return;
      setOppGraceEndsAt(null);
    }
    function onDisconnect() {
      setReconnecting(true);
    }
    function onConnect() {
      setReconnecting(false);
    }

    socket.on("room_state", onRoomState);
    socket.on("joined", onJoined);
    socket.on("countdown", onCountdown);
    socket.on("game_started", onGameStarted);
    socket.on("answer_result", onAnswerResult);
    socket.on("score_update", onScoreUpdate);
    socket.on("opponent_progress", onOpponentProgress);
    socket.on("turn_started", onTurnStarted);
    socket.on("life_lost", onLifeLost);
    socket.on("game_over", onGameOver);
    socket.on("rematch_start", onRematchStart);
    socket.on("rematch_requested", onRematchRequested);
    socket.on("opponent_disconnected", onOpponentDisconnected);
    socket.on("opponent_reconnected", onOpponentReconnected);
    socket.on("disconnect", onDisconnect);
    socket.on("connect", onConnect);

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
      socket.off("joined", onJoined);
      socket.off("countdown", onCountdown);
      socket.off("game_started", onGameStarted);
      socket.off("answer_result", onAnswerResult);
      socket.off("score_update", onScoreUpdate);
      socket.off("opponent_progress", onOpponentProgress);
      socket.off("turn_started", onTurnStarted);
      socket.off("life_lost", onLifeLost);
      socket.off("game_over", onGameOver);
      socket.off("rematch_start", onRematchStart);
      socket.off("rematch_requested", onRematchRequested);
      socket.off("opponent_disconnected", onOpponentDisconnected);
      socket.off("opponent_reconnected", onOpponentReconnected);
      socket.off("disconnect", onDisconnect);
      socket.off("connect", onConnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, code]);

  const p1 = room?.players.find((p) => p.slot === "p1");
  const p2 = room?.players.find((p) => p.slot === "p2");
  const me = room?.players.find((p) => p.id === myId);
  const opponent = room?.players.find((p) => p.id !== myId);

  const solo = room?.solo === true;
  const mySlot = me?.slot ?? identity?.slot;
  const myColor = slotColor(mySlot);
  const oppColor = slotColor(opponent?.slot ?? otherSlot(mySlot));

  const mode = room?.settings.mode ?? "race";
  const categoryId = room?.settings.categoryId ?? "countries";
  const categoryLabel = CATEGORY_LABELS[categoryId] ?? "Countries";
  // Only US states use a different noun; regions are scoped country sets.
  const itemsNoun = categoryId === "us-states" ? "states" : "countries";
  const lastStanding = mode === "last_standing";
  const maxLives = room?.settings.lives ?? 0;

  // Last Standing is one shared map: colour each claimed item by who took it.
  const claimedColors = useMemo(() => {
    const m = new Map<string, string>();
    for (const id of oppFilled) m.set(id, oppColor);
    for (const id of myFilled) m.set(id, myColor);
    return m;
  }, [myFilled, oppFilled, myColor, oppColor]);

  // Versus named list: each player's items in naming order (p1 then p2).
  const namedPlayers = useMemo(() => {
    if (solo) return undefined;
    return [p1, p2].map((pl, i) => ({
      name: pl?.name ?? `Player ${i + 1}`,
      color: i === 0 ? "var(--color-player1)" : "var(--color-player2)",
      ids: pl ? [...(pl.id === myId ? myFilled : oppFilled)] : [],
    }));
  }, [solo, p1, p2, myId, myFilled, oppFilled]);

  // In last_standing it's my turn only when the server names me as current.
  const myTurn = !lastStanding || (myId != null && currentPlayerId === myId);
  const currentPlayer = room?.players.find((p) => p.id === currentPlayerId);

  // Only accept guesses while the round is running; in last_standing, also gate
  // on it being my turn.
  const inputDisabled = gameOver != null || phase !== "playing" || !myTurn;

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
    <main>
      {/* Vignette flash on a life loss: red for mine, green for the opponent's. */}
      {flash && (
        <div
          key={flash.key}
          aria-hidden
          className={flash.kind === "damage" ? "damage-flash" : "gain-flash"}
        />
      )}
      {/* My final life: a heart cracks apart before the lose screen appears. */}
      {breaking && (
        <div className="heartbreak" aria-hidden>
          <span className="heartbreak-half heartbreak-left">♥</span>
          <span className="heartbreak-half heartbreak-right">♥</span>
        </div>
      )}
      <div
        className={`relative flex h-screen flex-col overflow-hidden ${
          breaking ? "screen-shake-violent" : shaking ? "screen-shake" : ""
        }`}
      >
        {/* 1. Score bar */}
        <ScoreBar
          p1={solo ? me : p1}
          p2={solo ? undefined : p2}
          solo={solo}
          scores={effectiveScores}
          total={total}
          endsAt={endsAt}
          category={categoryLabel}
          lastStanding={lastStanding}
          lives={lives}
          maxLives={maxLives}
          hits={hits}
        />

        {/* 1b. Last Standing: whose turn + the per-turn clock (lives live up in
            the score bar). */}
        {lastStanding && phase === "playing" && !gameOver && (
          <div
            data-testid="turn-bar"
            className="flex items-center justify-center gap-3 border-b border-border bg-surface px-4 py-2"
          >
            <span className="truncate text-sm font-semibold" style={{ color: myTurn ? myColor : oppColor }}>
              {myTurn ? "Your turn" : `${currentPlayer?.name ?? "Opponent"}'s turn`}
            </span>
            <TurnTimer endsAt={turnEndsAt} />
          </div>
        )}

        {/* 2. Maps */}
        <section className="relative min-h-0 flex-1">
          {/* Solo: just your map */}
          {solo && (
            <MapPane
              title={`You${me ? ` · ${me.name}` : ""}`}
              colorVar={myColor}
              filled={myFilled}
              categoryId={categoryId}
            />
          )}

          {/* Last Standing: a single shared battlefield, each claim coloured by
              whoever took it (it's a direct fight over one pool). */}
          {!solo && lastStanding && (
            <div className="relative h-full">
              <div
                className="absolute left-3 top-3 z-10 rounded-lg bg-surface/80 px-3 py-1 text-xs font-semibold"
                style={{ color: myColor }}
              >
                {me?.name ?? "You"} · {myFilled.size}
              </div>
              <div
                className="absolute right-3 top-3 z-10 rounded-lg bg-surface/80 px-3 py-1 text-xs font-semibold"
                style={{ color: oppColor }}
              >
                {opponent?.name ?? "Opponent"} · {oppFilled.size}
              </div>
              <WorldMap
                filledIso={myFilled}
                color={myColor}
                colorByIso={claimedColors}
                categoryId={categoryId}
                className="h-full w-full"
              />
            </div>
          )}

          {!solo && !lastStanding && (
            <>
              {/* Desktop: side by side */}
              <div className="hidden h-full md:grid md:grid-cols-2">
                <MapPane
                  title={`You${me ? ` · ${me.name}` : ""}`}
                  colorVar={myColor}
                  filled={myFilled}
                  categoryId={categoryId}
                  borderRight
                />
                <MapPane
                  title={`Opponent${opponent ? ` · ${opponent.name}` : ""}`}
                  colorVar={oppColor}
                  filled={oppFilled}
                  categoryId={categoryId}
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
                  categoryId={categoryId}
                />
                <button
                  onClick={() => setShowOpponent((s) => !s)}
                  className="absolute right-3 top-3 rounded-lg bg-surface-raised px-3 py-2 text-sm font-semibold shadow"
                >
                  {showOpponent ? "View yours" : "View opponent"}
                </button>
              </div>
            </>
          )}

          {/* The map captures the wheel for zoom, so offer a way down to the list. */}
          <button
            onClick={() =>
              document.getElementById("your-countries")?.scrollIntoView({ behavior: "smooth" })
            }
            className="absolute bottom-3 right-3 z-10 rounded-lg bg-surface-raised px-3 py-2 text-sm font-semibold shadow transition hover:brightness-125"
          >
            {solo ? "Your" : "Named"} {itemsNoun} ({solo ? myFilled.size : myFilled.size + oppFilled.size}) ↓
          </button>

          {/* Opponent disconnected banner */}
          {oppGraceEndsAt != null && !gameOver && (
            <OpponentDisconnectedBanner endsAt={oppGraceEndsAt} />
          )}
        </section>

        {/* 3. Input */}
        <section className="border-t border-border bg-surface px-4 py-3">
          {rejectMsg && (
            <p className="mb-1 text-center text-sm text-accent">{rejectMsg}</p>
          )}
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <CountryInput
                onSubmit={handleSubmit}
                clearSignal={clearSignal}
                rejectSignal={rejectSignal}
                disabled={inputDisabled}
              />
            </div>
            {solo && phase === "playing" && !gameOver && (
              <button
                onClick={() => socket.emit("give_up")}
                className="shrink-0 rounded-xl bg-surface-raised px-5 py-4 font-semibold transition hover:brightness-125"
              >
                Give up
              </button>
            )}
          </div>
        </section>

        {/* 3-2-1 countdown overlay */}
        {countdown != null && !gameOver && (
          <div
            data-testid="countdown-overlay"
            aria-live="assertive"
            className="absolute inset-0 z-20 flex items-center justify-center bg-background/80"
          >
            {countdown === "ready" ? (
              <p className="text-5xl font-bold">Get ready</p>
            ) : (
              <p
                key={countdown}
                className="animate-[countdown-pop_0.9s_ease-out] text-9xl font-bold tabular-nums"
              >
                {countdown}
              </p>
            )}
          </div>
        )}

        {/* Game over overlay */}
        {gameOver && !breaking && (
          <GameOverOverlay
            gameOver={gameOver}
            solo={solo}
            total={total}
            me={me}
            opponent={opponent}
            onRematch={() => {
              socket.emit("request_rematch");
              setMyRematch(true);
            }}
            myRematch={myRematch}
            oppRematch={oppRematch}
            onHome={() => {
              socket.emit("leave_room");
              setIdentity(null);
              navigate("/");
            }}
          />
        )}

      </div>

      {/* 4. Countries you've named, grouped by continent */}
      <NamedCountries filled={myFilled} categoryId={categoryId} versus={namedPlayers} />

      {/* Own connection lost: keep the user here while socket.io retries. */}
      {reconnecting && (
        <div
          role="alert"
          className="fixed inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-background/90"
        >
          <p className="text-2xl font-bold">Reconnecting…</p>
          <p className="text-sm text-muted">Hang tight — your seat is saved.</p>
        </div>
      )}
    </main>
  );
}

function MapPane({
  title,
  colorVar,
  filled,
  categoryId,
  borderRight,
}: {
  title: string;
  colorVar: string;
  filled: Set<string>;
  categoryId: CategoryId;
  borderRight?: boolean;
}) {
  return (
    <div className={`relative flex h-full flex-col ${borderRight ? "md:border-r md:border-border" : ""}`}>
      <div className="absolute left-3 top-3 z-10 rounded-lg bg-surface/80 px-3 py-1 text-xs font-semibold" style={{ color: colorVar }}>
        {title} · {filled.size}
      </div>
      <WorldMap filledIso={filled} color={colorVar} categoryId={categoryId} className="h-full w-full" />
    </div>
  );
}

function OpponentDisconnectedBanner({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.ceil((endsAt - now) / 1000));
  return (
    <div
      role="status"
      className="absolute left-1/2 top-14 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-accent bg-surface px-4 py-2 text-sm font-semibold text-accent shadow"
    >
      Opponent disconnected — waiting {secs}s
    </div>
  );
}

function GameOverOverlay({
  gameOver,
  solo,
  total,
  me,
  opponent,
  onRematch,
  myRematch,
  oppRematch,
  onHome,
}: {
  gameOver: GameOver;
  solo: boolean;
  total: number;
  me?: PlayerPublic;
  opponent?: PlayerPublic;
  onRematch: () => void;
  myRematch: boolean;
  oppRematch: boolean;
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

  if (solo) {
    return (
      <div className="fade-in absolute inset-0 z-20 flex items-center justify-center bg-background/90 px-6">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 text-center">
          <h2 className="text-3xl font-bold">
            {total > 0 && myScore >= total ? "You named them all!" : "Round over"}
          </h2>
          <p className="mt-6 text-sm text-muted">You named</p>
          <p data-testid="my-final-score" className="text-5xl font-bold tabular-nums text-foreground">
            {myScore} <span className="text-2xl text-muted">/ {total}</span>
          </p>
          <div className="mt-3">
            <ProgressBar value={myScore} max={total} colorVar="var(--color-foreground)" heightClass="h-3" label="Your progress" />
          </div>
          <div className="mt-8 flex flex-col gap-3">
            <button
              onClick={onRematch}
              disabled={myRematch}
              className="rounded-xl bg-foreground px-6 py-3 font-semibold text-background transition hover:brightness-110 disabled:opacity-60"
            >
              {myRematch ? "Starting…" : "Play again"}
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

  return (
    <div className="fade-in absolute inset-0 z-20 flex items-center justify-center bg-background/90 px-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 text-center">
        <h2 className="text-3xl font-bold">{result}</h2>
        <div className="mt-6 flex flex-col gap-4 text-left">
          <FinalScore
            name={me?.name ?? "You"}
            score={myScore}
            total={total}
            colorVar="var(--color-foreground)"
            testId="my-final-score"
          />
          <FinalScore
            name={opponent?.name ?? "Opponent"}
            score={oppScore}
            total={total}
            colorVar="var(--color-muted)"
            testId="opp-final-score"
          />
        </div>

        <div className="mt-8 flex flex-col gap-3">
          {oppRematch && !myRematch && (
            <p className="text-sm font-semibold text-muted">
              Opponent wants a rematch
            </p>
          )}
          <button
            onClick={onRematch}
            disabled={myRematch}
            className="rounded-xl bg-foreground px-6 py-3 font-semibold text-background transition hover:brightness-110 disabled:opacity-60"
          >
            {myRematch ? "Waiting for opponent…" : oppRematch ? "Accept rematch" : "Rematch"}
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

function FinalScore({
  name,
  score,
  total,
  colorVar,
  testId,
}: {
  name: string;
  score: number;
  total: number;
  colorVar: string;
  testId: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="truncate text-sm text-muted">{name}</p>
        <p data-testid={testId} className="text-2xl font-bold tabular-nums" style={{ color: colorVar }}>
          {score}
        </p>
      </div>
      <div className="mt-1">
        <ProgressBar value={score} max={total} colorVar={colorVar} heightClass="h-2.5" label={`${name} final score`} />
      </div>
    </div>
  );
}
