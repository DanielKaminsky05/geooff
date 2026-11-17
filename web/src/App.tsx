import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { SocketProvider } from "./lib/socket";
import { SessionProvider } from "./lib/session";
import Home from "./pages/Home";
import Lobby from "./pages/Lobby";
import Match from "./pages/Match";

export default function App() {
  return (
    <SocketProvider>
      <SessionProvider>
        <BrowserRouter>
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
