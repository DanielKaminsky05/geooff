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
import {
  FatalErrorOverlay,
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

  function handleSubmit(text: string) {
    // Turn-based modes: a player may type ahead off-turn, but a guess is only
    // sent on their turn (the typed text is kept to fire when it's theirs).
    if (!model.myTurn) return;
    socket.emit("submit_answer", { text });
  }

  function goHome() {
    setIdentity(null);
    navigate("/");
  }

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
        <View model={model}>
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
          rejectSignal={state.rejectSignal}
          rejectMsg={state.rejectMsg}
          disabled={model.inputDisabled}
          onGiveUp={model.solo && model.live ? () => socket.emit("give_up") : undefined}
        />

        {state.countdown != null && !state.gameOver && <CountdownOverlay countdown={state.countdown} />}
        {fx.toast && <MatchToast toast={fx.toast} />}

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

      {state.reconnecting && !state.fatalError && <ReconnectingOverlay />}
      {state.fatalError && <FatalErrorOverlay message={state.fatalError} onHome={goHome} />}
    </main>
  );
}
