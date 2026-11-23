import { useEffect, useEffectEvent, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSocket } from "../lib/socket";
import { useSession } from "../lib/session";
import { useSocketEvents } from "../lib/useSocketEvents";
import { countryName } from "../lib/continents";
import { useMatchState, type MatchAction } from "../features/match/matchState";
import { useMatchModel } from "../features/match/matchModel";
import { useMatchFx } from "../features/match/useMatchFx";
import { useLockedViewport } from "../features/match/useLockedViewport";
import RaceView from "../features/match/RaceView";
import LastStandingView from "../features/match/LastStandingView";
import GauntletView from "../features/match/GauntletView";
import ShowdownView from "../features/match/ShowdownView";
import AnswerBar from "../features/match/AnswerBar";
import CountdownOverlay from "../features/match/CountdownOverlay";
import GameOverOverlay from "../features/match/GameOverOverlay";
import { NamedButton, NamedSheet } from "../features/match/NamedSheet";
import RevealScreen, { RevealControls } from "../features/match/PromptReveal";
import {
  FatalErrorOverlay,
  LeaveConfirmDialog,
  LifeLossFx,
  MatchToast,
  OpponentDisconnectedBanner,
  ReconnectingOverlay,
} from "../features/match/MatchOverlays";

/** Actions that just carry a server event's payload through unchanged. */
type ForwardedAction = Extract<MatchAction, { payload: unknown }>;

const VIEWS = {
  race: RaceView,
  last_standing: LastStandingView,
  gauntlet: GauntletView,
  showdown: ShowdownView,
} as const;

export default function Match() {
  // The server's codes are uppercase; normalise a hand-typed/lowercase URL so
  // the stored identity and every emit/navigation use the canonical code.
  const code = (useParams().code ?? "").toUpperCase();
  const socket = useSocket();
  const navigate = useNavigate();
  const { identity, playerName, identityRef, setIdentity } = useSession();

  const [state, dispatch] = useMatchState(identity?.playerId ?? null);
  const model = useMatchModel(state, identity?.slot);
  const fx = useMatchFx();
  const [showNamed, setShowNamed] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  useLockedViewport();

  /** (Re)claim our seat. Idempotent server-side if we're already seated. */
  function rejoin() {
    socket.emit("join_room", {
      code,
      playerName: playerName || "Player",
      reconnectToken: identityRef.current?.reconnectToken,
    });
  }
  const toLobby = () => navigate(`/room/${code}`);
  function forward<T extends ForwardedAction["type"]>(type: T) {
    return (payload: Extract<ForwardedAction, { type: T }>["payload"]) =>
      dispatch({ type, payload } as MatchAction);
  }

  useSocketEvents({
    room_state: (room) => {
      // A rematch resets the room to the lobby (room_state, then
      // rematch_start). Go straight there rather than clearing the game-over
      // overlay, which would flash the dead board before navigation.
      if (room.phase === "lobby") toLobby();
      else dispatch({ type: "room_state", payload: room });
    },
    joined: (p) => {
      setIdentity({ playerId: p.playerId, slot: p.slot, reconnectToken: p.reconnectToken, roomCode: code });
      dispatch({ type: "joined", payload: p });
      if (p.state?.phase === "lobby") toLobby();
    },
    countdown: forward("countdown"),
    game_started: (p) => {
      fx.reset(); // per-game FX (solo "Play again" restarts without remounting)
      dispatch({ type: "game_started", payload: p });
    },
    answer_result: forward("answer_result"),
    score_update: forward("score_update"),
    opponent_progress: (p) => {
      dispatch({ type: "opponent_progress", payload: p });
      // Live gauntlet versus only: a brief "Opponent named …" toast so you
      // don't retry what they just took.
      if (p.playerId !== state.myId && model.gauntlet && !model.solo && model.live) {
        fx.showToast(`Opponent named ${countryName(p.isoCode)}`);
      }
    },
    turn_started: forward("turn_started"),
    life_lost: (p) => {
      dispatch({ type: "life_lost", payload: p });
      fx.lifeLost(p.playerId === state.myId, p.livesLeft);
    },
    prompt_changed: forward("prompt_changed"),
    // The prompt just retired: hold on the reveal (map + names) until play
    // resumes or everyone skips. Showdown's reveal rides on round_result.
    prompt_revealed: forward("prompt_revealed"),
    reveal_skip: forward("reveal_skip"),
    round_started: forward("round_started"),
    round_result: forward("round_result"),
    game_over: forward("game_over"),
    rematch_start: toLobby,
    rematch_requested: forward("rematch_requested"),
    opponent_disconnected: (p) => dispatch({ type: "opponent_disconnected", payload: p, now: Date.now() }),
    opponent_reconnected: forward("opponent_reconnected"),
    error_msg: forward("error_msg"),
    disconnect: () => dispatch({ type: "socket_disconnected" }),
    connect: () => {
      dispatch({ type: "socket_connected" });
      // The server sees a brand-new socket after a transport reconnect and no
      // longer ties it to our seat; without re-claiming it, submit_answer
      // would be silently dropped. This page is the sole owner of that rejoin.
      rejoin();
    },
  });

  // Ensure we're subscribed (covers a hard refresh onto /game/:code).
  const joinIfNeeded = useEffectEvent(() => {
    if (!state.room) rejoin();
  });
  useEffect(() => {
    joinIfNeeded();
  }, [socket, code]);

  function handleSubmit(text: string): boolean {
    // Turn-based modes: a player may type ahead off-turn, but a guess is only
    // sent on their turn (the typed text is kept to fire when it's theirs).
    // Returns whether a guess was actually sent (CountryInput keeps the text
    // in the field when it wasn't).
    if (!model.myTurn) return false;
    socket.emit("submit_answer", { text });
    return true;
  }

  // Vote to skip the reveal pause; the server advances once everyone has voted.
  function skipReveal(): void {
    if (state.iSkipped) return;
    socket.emit("skip_reveal");
    dispatch({ type: "reveal_skip_voted" });
  }

  function goHome() {
    setIdentity(null);
    navigate("/");
  }

  function leaveMatch() {
    // Server-side this forfeits a 1v1 or drops our seat in a 3+ game; either
    // way we're out of the room, so clear the stored identity too.
    socket.emit("leave_room");
    goHome();
  }

  // Multiplayer only (solo has Give up), during countdown or play.
  const phase = state.room?.phase;
  const canLeave =
    !model.solo && !state.gameOver && (phase === "countdown" || phase === "playing");

  // Disconnected opponents still seated, in slot order, for the banner.
  const awayPlayers = model.players
    .filter((p) => p.id in state.disconnected)
    .map((player) => ({ player, endsAt: state.disconnected[player.id] }));

  const View = VIEWS[model.mode] ?? RaceView;

  return (
    <main>
      <LifeLossFx flash={fx.flash} breaking={fx.breaking} />
      <div
        className={`relative flex h-[var(--app-h,100dvh)] flex-col overflow-hidden ${
          fx.breaking ? "screen-shake-violent" : fx.shaking ? "screen-shake" : ""
        }`}
      >
        {/* HUD + maps, per mode; the shared on-map extras ride along inside. */}
        <View model={model} onSkipReveal={skipReveal}>
          <NamedButton model={model} onOpen={() => setShowNamed(true)} />
          {awayPlayers.length > 0 && !state.gameOver && (
            <OpponentDisconnectedBanner
              players={awayPlayers}
              label={(pl) => (model.playerCount > 2 ? pl.name : "Opponent")}
            />
          )}
        </View>

        <AnswerBar
          onSubmit={handleSubmit}
          clearSignal={state.clearSignal}
          acceptSignal={state.acceptSignal}
          rejectSignal={state.rejectSignal}
          rejectMsg={state.rejectMsg}
          disabled={model.inputDisabled}
          onGiveUp={model.solo && model.live ? () => socket.emit("give_up") : undefined}
          onLeave={canLeave ? () => setConfirmLeave(true) : undefined}
        />

        {state.countdown != null && !state.gameOver && <CountdownOverlay countdown={state.countdown} />}
        {fx.toast && <MatchToast toast={fx.toast} />}
        {/* Gauntlet reveal pause: the board lights up red with the missed
            countries, a list down the side, a countdown + skip at the foot. */}
        {state.reveal && !state.gameOver && (
          <RevealScreen
            title={state.reveal.swept ? "Board swept!" : "Left on the board"}
            subtitle={
              state.reveal.swept
                ? undefined
                : `${state.reveal.label} · ${state.reveal.missed.length} missed`
            }
            missed={state.reveal.missed}
            swept={state.reveal.swept}
            categoryId={model.categoryId}
            controls={{
              endsAt: state.revealEndsAt,
              votes: state.revealVotes,
              iSkipped: state.iSkipped,
              onSkip: skipReveal,
            }}
          />
        )}
        {/* Reconnected mid-pause (no reveal content in the snapshot): timer + skip only. */}
        {state.revealEndsAt != null && !state.reveal && !state.roundResult && !state.gameOver && (
          <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center px-4">
            <div className="fade-in pointer-events-auto flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface/95 px-5 py-4 text-center shadow-xl backdrop-blur">
              <p className="text-sm font-semibold">Next prompt coming up…</p>
              <RevealControls
                endsAt={state.revealEndsAt}
                votes={state.revealVotes}
                iSkipped={state.iSkipped}
                onSkip={skipReveal}
              />
            </div>
          </div>
        )}

        {state.gameOver && !fx.breaking && (
          <GameOverOverlay
            gameOver={state.gameOver}
            solo={model.solo}
            gauntlet={model.gauntlet}
            players={model.players}
            total={state.total}
            me={model.me}
            onRematch={() => {
              socket.emit("request_rematch");
              dispatch({ type: "rematch_clicked" });
            }}
            myRematch={state.myRematch}
            othersRematch={state.othersRematch}
            onHome={() => {
              socket.emit("leave_room");
              goHome();
            }}
          />
        )}
      </div>

      <NamedSheet model={model} open={showNamed} onClose={() => setShowNamed(false)} />

      {confirmLeave && canLeave && (
        <LeaveConfirmDialog
          forfeit={model.playerCount <= 2}
          onConfirm={leaveMatch}
          onCancel={() => setConfirmLeave(false)}
        />
      )}

      {state.reconnecting && !state.fatalError && <ReconnectingOverlay />}
      {state.fatalError && <FatalErrorOverlay message={state.fatalError} onHome={goHome} />}
    </main>
  );
}
