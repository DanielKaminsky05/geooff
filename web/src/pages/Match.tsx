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
import PromptBanner from "../components/PromptBanner";
import TurnTimer from "../components/TurnTimer";
import Leaderboard, { type LeaderboardRow } from "../components/Leaderboard";
import LivesBar, { type LivesBarPlayer } from "../components/LivesBar";
import { countryName } from "../lib/continents";
import { slotColor } from "../lib/colors";

interface GameOver {
  winnerId: string | null;
  scores: Record<string, number>;
}

/** Stable empty set so memos reading "this player's filled" keep a stable ref. */
const EMPTY: Set<string> = new Set();

/** Slot order for ranking/columns: p1 → p4. */
const SLOT_ORDER: Record<PlayerSlot, number> = { p1: 0, p2: 1, p3: 2, p4: 3 };

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

function otherSlot(slot: PlayerSlot | undefined): PlayerSlot {
  return slot === "p2" ? "p1" : "p2";
}

export default function Match() {
  // The server's codes are uppercase; normalise a hand-typed/lowercase URL so
  // the stored identity and every emit/navigation use the canonical code.
  const code = (useParams().code ?? "").toUpperCase();
  const socket = useSocket();
  const navigate = useNavigate();
  const { identity, playerName, identityRef, setIdentity } = useSession();

  const [room, setRoom] = useState<RoomState | null>(null);
  const [phase, setPhase] = useState<GamePhase | null>(null);
  const [total, setTotal] = useState<number>(0);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});

  const [myFilled, setMyFilled] = useState<Set<string>>(() => new Set());
  // Every NON-me player's filled set, keyed by playerId. The server broadcasts
  // opponent_progress for every other player in a race, so a single opponent
  // set is no longer enough — keep them all here. The 2-player turn-based modes
  // derive their single `oppFilled` from this (see below).
  const [othersFilled, setOthersFilled] = useState<Record<string, Set<string>>>({});

  // last_standing turn + lives state.
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);
  const [turnEndsAt, setTurnEndsAt] = useState<number | null>(null);
  // Set while the turn clock is frozen (current player disconnected): ms left.
  const [turnPausedMs, setTurnPausedMs] = useState<number | null>(null);
  const [lives, setLives] = useState<Record<string, number>>({});
  // gauntlet: the active prompt (label only — the valid set is never sent).
  const [prompt, setPrompt] = useState<{ id: string; label: string; total: number } | null>(null);
  // showdown: the current round's deadline + number, and the between-round result.
  const [roundEndsAt, setRoundEndsAt] = useState<number | null>(null);
  const [roundNum, setRoundNum] = useState<number>(0);
  const [roundResult, setRoundResult] = useState<{
    counts: Record<string, number>;
    losers: string[];
    eliminated: string[];
    tie: boolean;
  } | null>(null);
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
  // race: which player's map is shown big. Defaults to me once myId is known.
  const [focusedPlayerId, setFocusedPlayerId] = useState<string | null>(null);
  const [showOpponent, setShowOpponent] = useState(false); // 2-player race mobile toggle
  const [showNamed, setShowNamed] = useState(false); // named-list slide-over
  // gauntlet: brief toast when the opponent names a country, so you don't repeat
  // it. `key` re-triggers the fade each time; auto-dismisses after ~2s.
  const [oppToast, setOppToast] = useState<{ text: string; key: number } | null>(null);
  const toastSeq = useRef(0);

  /** 3-2-1 overlay: seconds left, "ready" (in countdown but no tick seen yet), or null. */
  const [countdown, setCountdown] = useState<number | "ready" | null>(null);
  /** Own socket dropped; waiting for socket.io to reconnect. */
  const [reconnecting, setReconnecting] = useState(false);
  /** A (re)join failed unrecoverably (room gone, grace expired, …). */
  const [fatalError, setFatalError] = useState<string | null>(null);
  /** Disconnected opponents → epoch ms their reconnect grace runs out (null =
   *  unknown, e.g. rehydrated from a snapshot after a refresh). */
  const [disconnected, setDisconnected] = useState<Record<string, number | null>>({});

  const myId = identity?.playerId ?? null;
  const myIdRef = useRef<string | null>(myId);
  myIdRef.current = myId;

  // The socket handlers live in a mount-only effect, so they'd close over stale
  // `mode`/`phase`/`gameOver`. Mirror the "show the gauntlet opponent-named
  // toast right now" condition into a ref the handler can read live.
  const gauntletToastActiveRef = useRef(false);

  // Size the match to the *visible* viewport (above the keyboard and the Safari
  // toolbars) rather than 100vh. On iOS, focusing the input otherwise pops the
  // keyboard and scrolls the whole page up, hiding the map. Mirroring the
  // visual-viewport height keeps the input pinned just above the keyboard with
  // the map still in view, and no page scroll.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      document.documentElement.style.setProperty("--app-h", `${vv.height}px`);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      document.documentElement.style.removeProperty("--app-h");
    };
  }, []);

  // Pin the window so it physically cannot scroll during a match. Otherwise iOS
  // scrolls the whole document up when the input is focused (to lift it above
  // the keyboard), dragging the map off the top of the screen. With the body
  // fixed there's nothing to scroll, and the visual-viewport height above keeps
  // the input just above the keyboard.
  useEffect(() => {
    const { body } = document;
    const html = document.documentElement;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      width: body.style.width,
      height: body.style.height,
      overflow: body.style.overflow,
      htmlOverflow: html.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = "0";
    body.style.left = "0";
    body.style.width = "100%";
    body.style.height = "100%";
    body.style.overflow = "hidden";
    html.style.overflow = "hidden";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.width = prev.width;
      body.style.height = prev.height;
      body.style.overflow = prev.overflow;
      html.style.overflow = prev.htmlOverflow;
    };
  }, []);

  useEffect(() => {
    function onRoomState(state: RoomState) {
      // A rematch resets the room to the lobby (room_state, then rematch_start).
      // Go straight there rather than clearing the game-over overlay, which
      // would flash the dead board underneath before navigation.
      if (state.phase === "lobby") {
        navigate(`/room/${code}`);
        return;
      }
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
      // showdown: the round deadline rides on endsAt; restore it (null during the
      // between-round pause) so a reconnecting client's round clock is in sync.
      if (state.settings?.mode === "showdown") {
        setRoundEndsAt(state.phase === "playing" ? state.endsAt ?? null : null);
        // Round number + every player's live round tally (opponents' filled
        // sets are withheld in showdown, so counts come from roundCounts).
        if (state.round != null) setRoundNum(state.round);
        if (state.roundCounts) setScores({ ...state.roundCounts });
      }
      // Rehydrate filled maps from snapshot if present.
      if (state.filled && myIdRef.current) {
        const mine = state.filled[myIdRef.current];
        if (mine) setMyFilled(new Set(mine));
        const others: Record<string, Set<string>> = {};
        for (const [pid, isos] of Object.entries(state.filled)) {
          if (pid !== myIdRef.current) others[pid] = new Set(isos);
        }
        setOthersFilled(others);
      }
      // Rehydrate last_standing turn + lives from snapshot if present.
      if (state.turn) {
        setCurrentPlayerId(state.turn.currentPlayerId);
        setTurnEndsAt(state.turn.endsAt);
        setTurnPausedMs(state.turn.pausedMs ?? null);
      }
      // Rehydrate who's away from the snapshot (a refresh misses the
      // opponent_disconnected event). Keep a known grace deadline; otherwise
      // the end time is unknown (null). Anyone connected or gone is dropped.
      setDisconnected((prev) => {
        const next: Record<string, number | null> = {};
        for (const pl of state.players) {
          if (pl.id === myIdRef.current || pl.connected) continue;
          next[pl.id] = prev[pl.id] ?? null;
        }
        return next;
      });
      if (state.lives) setLives(state.lives);
      // Rehydrate the gauntlet prompt from the snapshot if present.
      if (state.prompt) setPrompt(state.prompt);
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
      setOthersFilled({});
      setScores({});
      setMyRematch(false);
      setOppRematch(false);
      setCurrentPlayerId(null);
      setTurnEndsAt(null);
      setTurnPausedMs(null);
      setLives({});
      setPrompt(null);
      // Per-game transient UI (matters for solo "Play again", which restarts in
      // place without remounting this page).
      setRejectMsg(null);
      setHits({});
      setFlash(null);
      setShaking(false);
      setBreaking(false);
      setOppToast(null);
      setRoundEndsAt(null);
      setRoundNum(0);
      setRoundResult(null);
      setClearSignal((n) => n + 1);
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
                : p.reason === "off_prompt"
                  ? "Doesn't match the prompt"
                  : null,
        );
      }
    }
    function onScoreUpdate(p: { scores: Record<string, number> }) {
      setScores(p.scores);
    }
    function onOpponentProgress(p: { playerId: string; isoCode: string; filled?: string[] }) {
      if (p.playerId === myIdRef.current) return;
      // Self-healing: when the server sends the guesser's FULL set, replace that
      // player's set with it so a single dropped event can't leave a country
      // stuck grey. Fall back to appending the one iso if `filled` is absent
      // (gauntlet path). Keyed per-player so every racer's map stays current.
      setOthersFilled((prev) => {
        const next = { ...prev };
        if (p.filled) {
          next[p.playerId] = new Set(p.filled);
        } else {
          const set = new Set(next[p.playerId] ?? EMPTY);
          set.add(p.isoCode);
          next[p.playerId] = set;
        }
        return next;
      });
      // gauntlet only: flash a brief "Opponent named …" toast so you don't retry
      // what they just took. Not shown in race / last_standing.
      if (gauntletToastActiveRef.current) {
        const key = (toastSeq.current += 1);
        setOppToast({ text: `Opponent named ${countryName(p.isoCode)}`, key });
        setTimeout(() => setOppToast((cur) => (cur && cur.key === key ? null : cur)), 2000);
      }
    }
    function onTurnStarted(p: { playerId: string; endsAt: number }) {
      setCurrentPlayerId(p.playerId);
      setTurnEndsAt(p.endsAt);
      setTurnPausedMs(null);
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
    function onPromptChanged(p: { id: string; label: string; total: number }) {
      setPrompt({ id: p.id, label: p.label, total: p.total });
      // A fresh prompt is a clean slate: clear the board (both players' claimed
      // countries) and any stale reject banner from the last turn.
      setMyFilled(new Set());
      setOthersFilled({});
      setRejectMsg(null);
    }
    function onRoundStarted(p: { endsAt: number; round: number }) {
      // A new showdown round: clean board + input, start the round clock.
      setRoundEndsAt(p.endsAt);
      setRoundNum(p.round);
      setRoundResult(null);
      setMyFilled(new Set());
      setScores({});
      setRejectMsg(null);
      setClearSignal((n) => n + 1);
    }
    function onRoundResult(p: {
      counts: Record<string, number>;
      losers: string[];
      eliminated: string[];
      tie: boolean;
      nextInMs: number;
    }) {
      setScores(p.counts);
      setRoundEndsAt(null); // round's over → input off during the pause
      setRoundResult({ counts: p.counts, losers: p.losers, eliminated: p.eliminated, tie: p.tie });
    }
    function onGameOver(p: GameOver) {
      setPhase("ended");
      setCountdown(null);
      setGameOver({ winnerId: p.winnerId, scores: p.scores });
      setScores(p.scores);
      setEndsAt(null);
      setRoundEndsAt(null);
      setRoundResult(null);
      setDisconnected({});
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
      setDisconnected((prev) => ({ ...prev, [p.playerId]: Date.now() + p.graceSeconds * 1000 }));
    }
    function onOpponentReconnected(p: { playerId: string }) {
      if (p.playerId === myIdRef.current) return;
      setDisconnected((prev) => {
        if (!(p.playerId in prev)) return prev;
        const next = { ...prev };
        delete next[p.playerId];
        return next;
      });
    }
    function onDisconnect() {
      setReconnecting(true);
    }
    function onConnect() {
      setReconnecting(false);
      // The server sees a brand-new socket after a transport reconnect, so it no
      // longer associates this connection with our seat. Re-claim it with the
      // reconnect token (idempotent if we're already seated) — otherwise
      // submit_answer would be silently dropped.
      socket.emit("join_room", {
        code,
        playerName: playerName || "Player",
        reconnectToken: identityRef.current?.reconnectToken,
      });
    }
    function onErrorMsg(p: { code: string; message: string }) {
      // A failed (re)join is unrecoverable from this page — the room is gone
      // (server restart or grace expired) or can't be re-entered. Surface it
      // instead of leaving a dead game that silently drops every input.
      if (
        p.code === "room_not_found" ||
        p.code === "in_progress" ||
        p.code === "not_joinable" ||
        p.code === "room_full"
      ) {
        setReconnecting(false);
        // in_progress / not_joinable on a rejoin mean our seat is gone (e.g. the
        // game ended and the server dropped it) — the server's wording ("already
        // in progress") is misleading here.
        setFatalError(
          p.code === "room_not_found" || p.code === "room_full"
            ? p.message || "This game is no longer available."
            : "This game has ended or is no longer available.",
        );
      }
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
    socket.on("prompt_changed", onPromptChanged);
    socket.on("round_started", onRoundStarted);
    socket.on("round_result", onRoundResult);
    socket.on("game_over", onGameOver);
    socket.on("rematch_start", onRematchStart);
    socket.on("rematch_requested", onRematchRequested);
    socket.on("opponent_disconnected", onOpponentDisconnected);
    socket.on("opponent_reconnected", onOpponentReconnected);
    socket.on("disconnect", onDisconnect);
    socket.on("connect", onConnect);
    socket.on("error_msg", onErrorMsg);

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
      socket.off("prompt_changed", onPromptChanged);
      socket.off("round_started", onRoundStarted);
      socket.off("round_result", onRoundResult);
      socket.off("game_over", onGameOver);
      socket.off("rematch_start", onRematchStart);
      socket.off("rematch_requested", onRematchRequested);
      socket.off("opponent_disconnected", onOpponentDisconnected);
      socket.off("opponent_reconnected", onOpponentReconnected);
      socket.off("disconnect", onDisconnect);
      socket.off("connect", onConnect);
      socket.off("error_msg", onErrorMsg);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, code]);

  const me = room?.players.find((p) => p.id === myId);
  const opponent = room?.players.find((p) => p.id !== myId);
  // 2-player score bar columns: the two seats in slot order. Seats can be any
  // pair (e.g. p1 vs p3 after someone left), so don't assume p1/p2.
  const [leftPlayer, rightPlayer] = useMemo(
    () => [...(room?.players ?? [])].sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]),
    [room?.players],
  );

  const solo = room?.solo === true;
  const mySlot = me?.slot ?? identity?.slot;
  const myColor = slotColor(mySlot);
  const oppColor = slotColor(opponent?.slot ?? otherSlot(mySlot));

  // The single-opponent set for the 2-player turn-based modes (last_standing /
  // gauntlet), derived from the per-player map so their colour-by-claimer map
  // and prompt counts keep working unchanged.
  const oppFilled = opponent ? (othersFilled[opponent.id] ?? EMPTY) : EMPTY;

  // Any player's filled set (mine or an opponent's), by playerId.
  const filledFor = (playerId: string): Set<string> =>
    playerId === myId ? myFilled : (othersFilled[playerId] ?? EMPTY);

  const mode = room?.settings.mode ?? "race";
  const categoryId = room?.settings.categoryId ?? "countries";
  const categoryLabel = CATEGORY_LABELS[categoryId] ?? "Countries";
  // Only US states use a different noun; regions are scoped country sets.
  const itemsNoun = categoryId === "us-states" ? "states" : "countries";
  const gauntlet = mode === "gauntlet";
  // Only show the "Opponent named …" toast in a live gauntlet versus match.
  gauntletToastActiveRef.current = gauntlet && !solo && phase === "playing" && gameOver == null;
  // Gauntlet reuses the entire Last Standing shell (lives, per-turn timer,
  // shared colour-by-claimer map, turn gating, hit/heartbreak FX).
  const lastStanding = mode === "last_standing" || gauntlet;
  const showdown = mode === "showdown";
  const maxLives = room?.settings.lives ?? 0;

  // Last Standing is one shared map: colour each claimed item by who took it
  // (every player, so 3-4 player games colour all claims).
  const claimedColors = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of room?.players ?? []) {
      const color = slotColor(p.slot);
      const filled = p.id === myId ? myFilled : (othersFilled[p.id] ?? EMPTY);
      for (const id of filled) m.set(id, color);
    }
    return m;
  }, [room?.players, myId, myFilled, othersFilled]);

  // Gauntlet: how many each player has named for the CURRENT prompt (the filled
  // sets reset on each prompt), shown as "named / prompt total" in the score bar.
  const promptCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of room?.players ?? []) {
      m[p.id] = (p.id === myId ? myFilled : (othersFilled[p.id] ?? EMPTY)).size;
    }
    return m;
  }, [room?.players, myId, myFilled, othersFilled]);

  // Versus named list: one column per player in slot order (p1..p4), items in
  // naming order, each coloured by its seat.
  const namedPlayers = useMemo(() => {
    if (solo || !room) return undefined;
    return [...room.players]
      .sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot])
      .map((pl) => ({
        name: pl.name,
        color: slotColor(pl.slot),
        ids: [...(pl.id === myId ? myFilled : (othersFilled[pl.id] ?? EMPTY))],
      }));
  }, [solo, room, myId, myFilled, othersFilled]);

  // In last_standing it's my turn only when the server names me as current.
  const myTurn = !lastStanding || (myId != null && currentPlayerId === myId);
  const currentPlayer = room?.players.find((p) => p.id === currentPlayerId);

  // The field stays usable whenever the round is live so players can pre-type
  // off-turn; submission itself is gated on it being my turn (see handleSubmit).
  // Showdown disables it between rounds and once you're eliminated.
  const iAmEliminated = showdown && myId != null && (lives[myId] ?? maxLives) <= 0;
  const inputDisabled =
    gameOver != null ||
    phase !== "playing" ||
    (showdown && (roundEndsAt == null || iAmEliminated));

  const effectiveScores = useMemo(() => {
    const s = { ...scores };
    for (const p of room?.players ?? []) {
      if (s[p.id] == null) s[p.id] = p.score ?? 0;
    }
    return s;
  }, [scores, room]);

  const race = !solo && !lastStanding && !showdown; // mode === "race", non-solo
  const playerCount = room?.players.length ?? 1;
  // Disconnected opponents still seated, in slot order, for the banner.
  const awayPlayers = [...(room?.players ?? [])]
    .filter((p) => p.id in disconnected)
    .sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot])
    .map((player) => ({ player, endsAt: disconnected[player.id] }));
  // 2-player race keeps the classic side-by-side (you | opponent) UI; 3-4 players
  // use the focused-map + leaderboard view.
  const multiRace = race && playerCount > 2;
  // 3-4 player turn-based: swap the two-column ScoreBar for an N-player lives bar.
  const multiTurnBased = lastStanding && playerCount > 2;

  const livesBarPlayers = useMemo<LivesBarPlayer[]>(() => {
    if (!multiTurnBased) return [];
    return [...(room?.players ?? [])]
      .sort((a, b) => a.slot.localeCompare(b.slot))
      .map((p) => {
        const lv = lives[p.id] ?? maxLives;
        return {
          id: p.id,
          name: p.id === myId ? "You" : p.name,
          slot: p.slot,
          lives: lv,
          maxLives,
          isCurrent: p.id === currentPlayerId,
          eliminated: lv <= 0,
          hitKey: hits[p.id] ?? 0,
        };
      });
  }, [multiTurnBased, room?.players, myId, lives, maxLives, currentPlayerId, hits]);

  // Showdown status strip: each player's live round count + hearts, with the
  // player(s) tied for the current fewest (among the living) flagged as in danger.
  const showdownPlayers = useMemo<LivesBarPlayer[]>(() => {
    if (!showdown || !room) return [];
    const countOf = (id: string) => scores[id] ?? 0;
    const aliveCounts = room.players
      .filter((p) => (lives[p.id] ?? maxLives) > 0)
      .map((p) => countOf(p.id));
    const min = aliveCounts.length ? Math.min(...aliveCounts) : 0;
    const allEqual = aliveCounts.length > 0 && Math.max(...aliveCounts) === min;
    return [...room.players]
      .sort((a, b) => a.slot.localeCompare(b.slot))
      .map((p) => {
        const lv = lives[p.id] ?? maxLives;
        return {
          id: p.id,
          name: p.id === myId ? "You" : p.name,
          slot: p.slot,
          lives: lv,
          maxLives,
          isCurrent: false,
          eliminated: lv <= 0,
          hitKey: hits[p.id] ?? 0,
          count: countOf(p.id),
          inDanger: lv > 0 && !allEqual && countOf(p.id) === min,
        };
      });
  }, [showdown, room, myId, lives, maxLives, hits, scores]);

  // Race leaderboard rows: every player, ranked by count (desc), seat order as
  // the stable tie-break. Count prefers the server score, falling back to the
  // filled-set size we track locally.
  const leaderboardRows = useMemo<LeaderboardRow[]>(() => {
    if (!race || !room) return [];
    return [...room.players]
      .map((p) => ({
        id: p.id,
        name: p.name,
        slot: p.slot,
        count: effectiveScores[p.id] ?? (p.id === myId ? myFilled.size : (othersFilled[p.id] ?? EMPTY).size),
        isMe: p.id === myId,
      }))
      .sort((a, b) => b.count - a.count || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]);
  }, [race, room, effectiveScores, myId, myFilled, othersFilled]);

  // "Named (N)" button count: solo = just mine; versus = every player's named
  // items summed (race shows all four; turn-based share one pool but summing
  // the per-player sets is equivalent).
  // Whether the named view reveals everyone (shared-pool modes, or race at game
  // over) vs. just the local player (a live race hides opponents' lists — #8).
  // Showdown never reveals opponents' named countries (you only see counts), so
  // its sheet stays your-own-list even at game over.
  const revealAllNamed = !solo && !showdown && (gameOver != null || mode !== "race");
  const namedCount = revealAllNamed
    ? myFilled.size + Object.values(othersFilled).reduce((n, s) => n + s.size, 0)
    : myFilled.size;

  // Focus my own map by default; keep a valid focus if the focused seat leaves.
  const focusedId =
    focusedPlayerId && room?.players.some((p) => p.id === focusedPlayerId)
      ? focusedPlayerId
      : myId;
  const focusedPlayer = room?.players.find((p) => p.id === focusedId);

  function handleSubmit(text: string) {
    // Turn-based modes: a player may type ahead off-turn, but a guess is only
    // sent on their turn (keeps the typed text so they can fire it when it's
    // theirs). Race mode is always "my turn".
    if (!myTurn) return;
    socket.emit("submit_answer", { text });
  }

  // Shared score row. In Last Standing / gauntlet it renders "bare" (no border
  // or background of its own) inside the floating HUD, with whose-turn + the
  // per-turn clock folded into its center column.
  const scoreBar = (
    <ScoreBar
      p1={solo ? me : leftPlayer}
      p2={solo ? undefined : rightPlayer}
      solo={solo}
      scores={effectiveScores}
      total={total}
      endsAt={endsAt}
      category={categoryLabel}
      lastStanding={lastStanding}
      gauntlet={gauntlet}
      promptCounts={promptCounts}
      promptTotal={prompt?.total ?? 0}
      lives={lives}
      maxLives={maxLives}
      hits={hits}
      bare={lastStanding || multiRace}
      compact={multiRace || multiTurnBased}
      showTurn={lastStanding && phase === "playing" && !gameOver}
      turnName={myTurn ? "Your turn" : `${currentPlayer?.name ?? "Opponent"}'s turn`}
      turnColor={currentPlayer ? slotColor(currentPlayer.slot) : myTurn ? myColor : oppColor}
      turnEndsAt={turnEndsAt}
      turnPausedMs={turnPausedMs}
    />
  );

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
        className={`relative flex h-[var(--app-h,100dvh)] flex-col overflow-hidden ${
          breaking ? "screen-shake-violent" : shaking ? "screen-shake" : ""
        }`}
      >
        {/* 1. The HUD. In race it's a normal top strip. In Last Standing /
            gauntlet it's a single floating panel over a full-height map: the
            score row (with whose-turn + per-turn clock folded into its center)
            and the prompt row share one top-fading gradient, so the two rows
            read as one HUD rather than three stacked bars. */}
        {showdown ? (
          // Showdown: a floating HUD over a full-height map — every player's live
          // count + hearts, the active prompt, and the round clock.
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-1 bg-gradient-to-b from-background via-background/90 to-transparent pb-10">
            <LivesBar players={showdownPlayers} showHearts />
            {prompt && phase === "playing" && !gameOver && <PromptBanner bare label={prompt.label} />}
            {roundEndsAt != null && (
              <div className="flex items-center justify-center gap-2 text-xs text-muted">
                <span>Round {roundNum}</span>
                <TurnTimer endsAt={roundEndsAt} />
              </div>
            )}
          </div>
        ) : lastStanding ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col bg-gradient-to-b from-background via-background/90 to-transparent pb-12">
            {multiTurnBased && <LivesBar players={livesBarPlayers} showHearts={gauntlet} />}
            {scoreBar}
            {gauntlet && phase === "playing" && !gameOver && prompt && (
              <PromptBanner bare label={prompt.label} />
            )}
          </div>
        ) : multiRace ? (
          // 3-4 player race: the timer floats centered over the map (no strip), so
          // the map is full-height and the leaderboard sits flush at the top-left.
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center">
            {scoreBar}
          </div>
        ) : (
          scoreBar
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
              hideTitle={lastStanding}
            />
          )}

          {/* Showdown: your own board (you race the prompt on your own map). */}
          {showdown && (
            <MapPane
              title=""
              colorVar={myColor}
              filled={myFilled}
              categoryId={categoryId}
              hideTitle
            />
          )}

          {/* Last Standing: a single shared battlefield, each claim coloured by
              whoever took it (it's a direct fight over one pool). Per-player
              name + count live in the HUD above, so the map stays unlabelled. */}
          {!solo && lastStanding && (
            <div className="relative h-full">
              <WorldMap
                filledIso={myFilled}
                color={myColor}
                colorByIso={claimedColors}
                categoryId={categoryId}
                className="h-full w-full"
              />
            </div>
          )}

          {/* 2-player race: classic side-by-side maps (desktop) / you↔opponent
              toggle (mobile). */}
          {race && !multiRace && (
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
                  revealNames={false}
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
                  revealNames={!showOpponent}
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

          {/* Race (3-4 players): one big focused map + a leaderboard that
              doubles as the player switcher. Tap/click a row to focus that
              player's map. Same layout on mobile and desktop (the leaderboard
              floats top-left; with ≤4 rows it fits without scrolling). Only the
              local player's own map reveals country-name tooltips on hover. */}
          {multiRace && (
            <div className="relative h-full">
              <MapPane
                title={
                  focusedId === myId
                    ? `You${focusedPlayer ? ` · ${focusedPlayer.name}` : ""}`
                    : (focusedPlayer?.name ?? "Opponent")
                }
                colorVar={slotColor(focusedPlayer?.slot)}
                filled={focusedId ? filledFor(focusedId) : myFilled}
                categoryId={categoryId}
                revealNames={focusedId === myId}
                hideTitle
              />
              {/* Current focus label (the built-in MapPane title is hidden to
                  clear room for the leaderboard). */}
              <div
                className="absolute right-3 top-3 z-10 rounded-lg bg-surface/80 px-3 py-1 text-xs font-semibold"
                style={{ color: slotColor(focusedPlayer?.slot) }}
              >
                {focusedId === myId ? "You" : (focusedPlayer?.name ?? "Opponent")} ·{" "}
                {(focusedId ? filledFor(focusedId) : myFilled).size}
              </div>
              <div className="absolute left-3 top-3 z-10 w-44 max-w-[55%] rounded-lg border border-border bg-surface/90 p-2 shadow backdrop-blur-sm">
                <Leaderboard
                  rows={leaderboardRows}
                  focusedId={focusedId ?? undefined}
                  onFocus={setFocusedPlayerId}
                />
              </div>
            </div>
          )}

          {/* Open the named-list sheet. It's a slide-over (not below the fold)
              so the match stays a single non-scrolling viewport — focusing the
              input on mobile can't scroll the map away to reveal a list. */}
          <button
            onClick={() => setShowNamed(true)}
            className="absolute bottom-3 right-3 z-10 rounded-lg bg-surface-raised px-3 py-2 text-sm font-semibold shadow transition hover:brightness-125"
          >
            {solo ? "Your" : "Named"} {itemsNoun} ({namedCount}) ↑
          </button>

          {/* Opponent disconnected banner */}
          {awayPlayers.length > 0 && !gameOver && (
            <OpponentDisconnectedBanner
              players={awayPlayers}
              label={(pl) => (playerCount > 2 ? pl.name : "Opponent")}
            />
          )}
        </section>

        {/* 3. Input */}
        <section className="relative border-t border-border bg-surface px-4 pt-3 pb-[calc(0.75rem_+_env(safe-area-inset-bottom))]">
          {/* Floated above the bar (out of flow) so it never pushes the layout
              up/down when it appears on a rejected guess. */}
          {rejectMsg && (
            <p className="pointer-events-none absolute inset-x-0 bottom-full mb-1 text-center text-sm text-accent">
              {rejectMsg}
            </p>
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

        {/* gauntlet: brief "Opponent named …" toast (auto-dismisses ~2s) so you
            don't retry what they just took. Unobtrusive, centered above the
            input; pointer-events off so it never blocks typing. */}
        {oppToast && (
          <div
            key={oppToast.key}
            role="status"
            className="pointer-events-none absolute bottom-24 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-surface-raised px-4 py-2 text-sm font-semibold shadow"
          >
            {oppToast.text}
          </div>
        )}

        {/* Showdown between-round result: counts + who lost a heart. */}
        {showdown && roundResult && !gameOver && (
          <div className="fade-in absolute inset-0 z-20 flex items-center justify-center bg-background/80 px-6">
            <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 text-center">
              <h3 className="text-xl font-bold">
                {roundResult.tie ? "Tie — everyone safe" : "Round over"}
              </h3>
              <ol className="mt-4 flex flex-col gap-1.5 text-left">
                {[...(room?.players ?? [])]
                  .sort(
                    (a, b) =>
                      (roundResult.counts[b.id] ?? 0) - (roundResult.counts[a.id] ?? 0) ||
                      a.slot.localeCompare(b.slot),
                  )
                  .map((p) => {
                    const lost = roundResult.losers.includes(p.id);
                    const out = roundResult.eliminated.includes(p.id);
                    return (
                      <li
                        key={p.id}
                        data-testid={`round-row-${p.id}`}
                        className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 ${
                          lost ? "border-accent/50 bg-accent/10" : "border-border bg-surface-raised"
                        }`}
                      >
                        <span className="truncate font-semibold" style={{ color: slotColor(p.slot) }}>
                          {p.id === myId ? "You" : p.name}
                          {out ? " · out" : lost ? " · −1 ♥" : ""}
                        </span>
                        <span className="tabular-nums">{roundResult.counts[p.id] ?? 0}</span>
                      </li>
                    );
                  })}
              </ol>
              <p className="mt-4 text-sm text-muted">Next round…</p>
            </div>
          </div>
        )}

        {/* Game over overlay */}
        {gameOver && !breaking && (
          <GameOverOverlay
            gameOver={gameOver}
            solo={solo}
            gauntlet={gauntlet}
            players={room?.players ?? []}
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

      {/* 4. Named list — a slide-up sheet (always mounted, translated off-screen
          when closed) rather than content below the fold, so the match stays a
          single non-scrolling viewport. Solo gauntlet uses a flat per-prompt
          list; versus shows per-player ordered columns; otherwise grouped. */}
      <div
        className={`fixed inset-0 z-30 flex flex-col bg-background transition-transform duration-300 ${
          showNamed ? "translate-y-0" : "pointer-events-none translate-y-full"
        }`}
      >
        <div className="flex justify-end border-b border-border px-4 py-2">
          <button
            onClick={() => setShowNamed(false)}
            className="rounded-lg bg-surface-raised px-4 py-2 text-sm font-semibold transition hover:brightness-125"
          >
            Close ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NamedCountries
            filled={myFilled}
            categoryId={categoryId}
            // In a RACE, hide the opponent's list until game over so it can't be
            // watched live; other versus modes (last_standing/gauntlet) share one
            // pool and stay revealed. When versus is undefined, NamedCountries
            // falls back to the grouped solo view of your own `filled`.
            versus={revealAllNamed ? namedPlayers : undefined}
            flat={solo && gauntlet}
          />
        </div>
      </div>

      {/* Own connection lost: keep the user here while socket.io retries. */}
      {reconnecting && !fatalError && (
        <div
          role="alert"
          className="fixed inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-background/90"
        >
          <p className="text-2xl font-bold">Reconnecting…</p>
          <p className="text-sm text-muted">Hang tight — your seat is saved.</p>
        </div>
      )}

      {/* Re-join failed for good (room gone / grace expired): offer a way out
          instead of a dead game that drops every input. */}
      {fatalError && (
        <div
          role="alert"
          className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-background/95 px-6 text-center"
        >
          <p className="text-2xl font-bold">Game unavailable</p>
          <p className="max-w-sm text-sm text-muted">{fatalError}</p>
          <button
            onClick={() => {
              setIdentity(null);
              navigate("/");
            }}
            className="rounded-xl bg-foreground px-6 py-3 font-semibold text-background transition hover:brightness-110"
          >
            Back to home
          </button>
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
  hideTitle,
  revealNames = true,
}: {
  title: string;
  colorVar: string;
  filled: Set<string>;
  categoryId: CategoryId;
  borderRight?: boolean;
  /** Suppress the corner label (e.g. when the floating HUD already shows it). */
  hideTitle?: boolean;
  /** Forwarded to WorldMap: false hides hover tooltips on a non-own map. */
  revealNames?: boolean;
}) {
  return (
    <div className={`relative flex h-full flex-col ${borderRight ? "md:border-r md:border-border" : ""}`}>
      {!hideTitle && (
        <div className="absolute left-3 top-3 z-10 rounded-lg bg-surface/80 px-3 py-1 text-xs font-semibold" style={{ color: colorVar }}>
          {title} · {filled.size}
        </div>
      )}
      <WorldMap filledIso={filled} color={colorVar} categoryId={categoryId} revealNames={revealNames} className="h-full w-full" />
    </div>
  );
}

function OpponentDisconnectedBanner({
  players,
  label,
}: {
  /** Each disconnected opponent with their grace deadline (null = unknown). */
  players: Array<{ player: PlayerPublic; endsAt: number | null }>;
  label: (p: PlayerPublic) => string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  return (
    <div
      role="status"
      className="absolute left-1/2 top-14 z-10 flex -translate-x-1/2 flex-col items-center gap-0.5 whitespace-nowrap rounded-lg border border-accent bg-surface px-4 py-2 text-sm font-semibold text-accent shadow"
    >
      {players.map(({ player, endsAt }) => (
        <span key={player.id}>
          {label(player)} disconnected — waiting
          {endsAt != null ? ` ${Math.max(0, Math.ceil((endsAt - now) / 1000))}s` : "…"}
        </span>
      ))}
    </div>
  );
}

function GameOverOverlay({
  gameOver,
  solo,
  gauntlet,
  players,
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
  gauntlet?: boolean;
  players: PlayerPublic[];
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
            {gauntlet ? "Run over" : total > 0 && myScore >= total ? "You named them all!" : "Round over"}
          </h2>
          <p className="mt-6 text-sm text-muted">{gauntlet ? "You answered" : "You named"}</p>
          <p data-testid="my-final-score" className="text-5xl font-bold tabular-nums text-foreground">
            {myScore}
            {!gauntlet && <span className="text-2xl text-muted"> / {total}</span>}
          </p>
          {!gauntlet && (
            <div className="mt-3">
              <ProgressBar value={myScore} max={total} colorVar="var(--color-foreground)" heightClass="h-3" label="Your progress" />
            </div>
          )}
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

  // 3+ players (race or turn-based): a ranked final leaderboard of everyone (the
  // 2-player games keep the you-vs-opponent FinalScore pair below).
  if (players.length > 2) {
    const ranked = [...players]
      .map((p) => ({ p, score: gameOver.scores[p.id] ?? 0 }))
      .sort((a, b) => b.score - a.score || SLOT_ORDER[a.p.slot] - SLOT_ORDER[b.p.slot]);
    return (
      <div className="fade-in absolute inset-0 z-20 flex items-center justify-center bg-background/90 px-6">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 text-center">
          <h2 className="text-3xl font-bold">{result}</h2>
          <ol className="mt-6 flex flex-col gap-2 text-left">
            {ranked.map(({ p, score }, i) => {
              const isMe = me != null && p.id === me.id;
              const isWinner = gameOver.winnerId != null && p.id === gameOver.winnerId;
              return (
                <li
                  key={p.id}
                  data-testid={`final-rank-${p.id}`}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                    isWinner ? "border-foreground bg-surface-raised" : "border-border"
                  }`}
                >
                  <span className="w-4 shrink-0 text-sm tabular-nums text-muted">{i + 1}</span>
                  <span
                    aria-hidden
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ background: slotColor(p.slot) }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {isMe ? "You" : p.name}
                    {isWinner && <span className="ml-1 text-xs text-muted">👑</span>}
                  </span>
                  <span className="shrink-0 text-xl font-bold tabular-nums" style={{ color: slotColor(p.slot) }}>
                    {score}
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="mt-8 flex flex-col gap-3">
            {oppRematch && !myRematch && (
              <p className="text-sm font-semibold text-muted">Someone wants a rematch</p>
            )}
            <button
              onClick={onRematch}
              disabled={myRematch}
              className="rounded-xl bg-foreground px-6 py-3 font-semibold text-background transition hover:brightness-110 disabled:opacity-60"
            >
              {myRematch ? "Waiting for others…" : oppRematch ? "Accept rematch" : "Rematch"}
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
