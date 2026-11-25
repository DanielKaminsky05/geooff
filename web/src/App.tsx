import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { SocketProvider } from "./lib/socket";
import { SessionProvider } from "./lib/session";
import Home from "./pages/Home";

// Route-level code splitting: the landing page (Home, tiny) stays in the entry
// chunk so it paints without a second round trip; the lobby and match load on
// demand, and the ~1.2MB of map path data (@svg-maps/*) only with the match.
const loadLobby = () => import("./pages/Lobby");
const loadMatch = () => import("./pages/Match");
const loadDaily = () => import("./pages/DailyDive");
const Lobby = lazy(loadLobby);
const Match = lazy(loadMatch);
const DailyDive = lazy(loadDaily);

/** Warm the next route's chunk once the current page is idle. */
function usePreload(load: () => Promise<unknown>) {
  useEffect(() => {
    const run = () => void load().catch(() => {
      /* offline / fetch failed: the route simply loads it again on visit */
    });
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(run, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = window.setTimeout(run, 200);
    return () => window.clearTimeout(t);
  }, [load]);
}

function HomeRoute() {
  usePreload(loadLobby);
  return <Home />;
}

function LobbyRoute() {
  // The lobby always leads to the match: fetch it (and the map data) while the
  // players are readying up, so the game screen appears without a load gap.
  usePreload(loadMatch);
  return <Lobby />;
}

/** Blank screen in the app background colour while a route chunk loads. */
function RouteFallback() {
  return <div className="min-h-dvh bg-background" aria-busy="true" />;
}

/**
 * Reset scroll to the top on every navigation. As a single-page app, the
 * browser keeps the previous route's scroll offset, which otherwise lands you
 * part-way down a fresh page.
 */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** The route table, without a router or providers (tests mount it in a MemoryRouter). */
export function AppRoutes() {
  return (
    <>
      <ScrollToTop />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/room/:code" element={<LobbyRoute />} />
          <Route path="/daily" element={<DailyDive />} />
          <Route path="/game/:code" element={<Match />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}

export default function App() {
  return (
    <SocketProvider>
      <SessionProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </SessionProvider>
    </SocketProvider>
  );
}
