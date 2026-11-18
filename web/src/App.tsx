import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { SocketProvider } from "./lib/socket";
import { SessionProvider } from "./lib/session";
import Home from "./pages/Home";
import Lobby from "./pages/Lobby";
import Match from "./pages/Match";

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

export default function App() {
  return (
    <SocketProvider>
      <SessionProvider>
        <BrowserRouter>
          <ScrollToTop />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/room/:code" element={<Lobby />} />
            <Route path="/game/:code" element={<Match />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </SessionProvider>
    </SocketProvider>
  );
}
