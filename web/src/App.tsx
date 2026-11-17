import { useState } from "react";

export default function App() {
  const [code, setCode] = useState("");

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
        {/* Create a new game */}
        <button
          type="button"
          className="rounded-xl bg-player1 px-6 py-4 text-lg font-semibold text-background transition hover:brightness-110"
        >
          Create a game
        </button>

        <div className="flex items-center gap-3 text-sm text-muted">
          <span className="h-px flex-1 bg-border" />
          or join
          <span className="h-px flex-1 bg-border" />
        </div>

        {/* Join by code */}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            // TODO: validate code against the server, then route to /room/[code]
          }}
        >
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
        Scaffold — lobby, dual maps, and real-time play coming next.
      </footer>
    </main>
  );
}
