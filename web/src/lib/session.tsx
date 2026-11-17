import { createContext, useContext, useRef, useState } from "react";
import type { PlayerSlot } from "./protocol";

export interface Identity {
  playerId: string;
  slot: PlayerSlot;
  reconnectToken: string;
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

const NAME_KEY = "geooff:name";

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [playerName, setPlayerNameState] = useState<string>(
    () => localStorage.getItem(NAME_KEY) ?? "",
  );
  const [identity, setIdentityState] = useState<Identity | null>(null);
  const identityRef = useRef<Identity | null>(null);

  const setPlayerName = (name: string) => {
    setPlayerNameState(name);
    localStorage.setItem(NAME_KEY, name);
  };

  const setIdentity = (id: Identity | null) => {
    identityRef.current = id;
    setIdentityState(id);
  };

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
