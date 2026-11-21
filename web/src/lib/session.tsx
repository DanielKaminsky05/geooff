import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { PlayerSlot } from "./protocol";
import { useSocket } from "./socket";

export interface Identity {
  playerId: string;
  slot: PlayerSlot;
  reconnectToken: string;
  /** Room this identity belongs to; enables auto-rejoin after reconnects. */
  roomCode?: string;
}

interface SessionValue {
  playerName: string;
  setPlayerName: (name: string) => void;
  identity: Identity | null;
  setIdentity: (id: Identity | null) => void;
  /** Mutable ref for immediate reads (e.g. inside socket handlers). */
  identityRef: React.MutableRefObject<Identity | null>;
}

const SessionContext = createContext<SessionValue | null>(null);

const NAME_KEY = "geofight:name";
export const IDENTITY_KEY = "geofight:identity";

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage unavailable */
  }
}

// A Record keyed by PlayerSlot so adding a slot to the protocol forces an
// update here (otherwise a refresh would drop that seat's reconnect token).
const PLAYER_SLOTS: Record<PlayerSlot, true> = { p1: true, p2: true, p3: true, p4: true };

function isPlayerSlot(value: unknown): value is PlayerSlot {
  return typeof value === "string" && Object.hasOwn(PLAYER_SLOTS, value);
}

function readIdentity(): Identity | null {
  try {
    const raw = sessionStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Identity> | null;
    if (
      !parsed ||
      typeof parsed.playerId !== "string" ||
      typeof parsed.reconnectToken !== "string" ||
      !isPlayerSlot(parsed.slot)
    ) {
      return null;
    }
    return parsed as Identity;
  } catch {
    return null;
  }
}

function writeIdentity(id: Identity | null) {
  try {
    if (id) sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(id));
    else sessionStorage.removeItem(IDENTITY_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const socket = useSocket();
  const [playerName, setPlayerNameState] = useState<string>(readName);
  const [identity, setIdentityState] = useState<Identity | null>(readIdentity);
  const identityRef = useRef<Identity | null>(identity);
  const playerNameRef = useRef(playerName);
  useEffect(() => {
    playerNameRef.current = playerName;
  }, [playerName]);

  const setPlayerName = (name: string) => {
    setPlayerNameState(name);
    writeName(name);
  };

  const setIdentity = (id: Identity | null) => {
    identityRef.current = id;
    setIdentityState(id);
    writeIdentity(id);
  };

  // After socket.io transparently re-establishes the connection (network
  // blip), the server sees a brand-new socket; re-claim our seat with the
  // reconnect token. The Manager's "reconnect" only fires on RE-connects.
  useEffect(() => {
    // Test doubles may not expose the Manager.
    const manager = (socket as Partial<typeof socket> | undefined)?.io;
    if (!manager || typeof manager.on !== "function") return;
    const onReconnect = () => {
      const id = identityRef.current;
      if (!id?.roomCode || !id.reconnectToken) return;
      socket.emit("join_room", {
        code: id.roomCode,
        playerName: playerNameRef.current,
        reconnectToken: id.reconnectToken,
      });
    };
    manager.on("reconnect", onReconnect);
    return () => {
      manager.off("reconnect", onReconnect);
    };
  }, [socket]);

  return (
    <SessionContext.Provider
      value={{ playerName, setPlayerName, identity, setIdentity, identityRef }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within <SessionProvider>");
  return ctx;
}

/** A friendly default name if the user didn't enter one. */
export function defaultName(): string {
  return `Player ${Math.floor(1000 + Math.random() * 9000)}`;
}
