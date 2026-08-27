/**
 * KAKSHA -- application shell and routing.
 *
 * Real routes, not tab state: each page has a URL, browser history works, and
 * a specific view can be linked to during a demonstration.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { TopBar } from "./components/layout/TopBar";
import { BootGate } from "./components/layout/BootGate";
import { RouteBoundary } from "./components/layout/RouteBoundary";
import { Dashboard } from "./pages/Dashboard";
import { Landing } from "./pages/Landing";
import { Tracker } from "./pages/Tracker";
import { Conjunctions } from "./pages/Conjunctions";
import { Calculations } from "./pages/Calculations";
import { Analysis } from "./pages/Analysis";
import { Simulation } from "./pages/Simulation";
import { Validation } from "./pages/Validation";
import { useClockSync } from "./hooks/useKaksha";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      // Numerical results are tied to an explicit instant, so a "stale" cache
      // entry is not wrong -- it is the answer for a slightly earlier time.
      // Refetching is driven by the quantised time key instead.
      staleTime: 30_000,
    },
  },
});

/**
 * The operations console: everything behind the front door.
 *
 * Fixed 100vh column, because each page manages its own internal scrolling.
 * The boot gate lives here rather than at the root so it only blocks the views
 * that genuinely cannot render without the engine.
 */
function Shell() {
  useClockSync();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TopBar />
      <BootGate>
        {/* A render error on one page must not blank the whole application. */}
        <RouteBoundary>
          <Routes>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/tracker" element={<Tracker />} />
            <Route path="/conjunctions" element={<Conjunctions />} />
            <Route path="/calculations" element={<Calculations />} />
            <Route path="/analysis" element={<Analysis />} />
            <Route path="/simulation" element={<Simulation />} />
            <Route path="/validation" element={<Validation />} />
            {/* Anything unrecognised lands on the operational picture. */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </RouteBoundary>
      </BootGate>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/*
           * The landing page sits OUTSIDE the shell on purpose. It carries its
           * own navigation, scrolls the document rather than a pane, and must
           * render with the backend switched off -- so it gets neither the
           * TopBar, the 100vh lock, nor the boot gate.
           */}
          <Route
            path="/"
            element={
              <RouteBoundary>
                <Landing />
              </RouteBoundary>
            }
          />
          <Route path="/*" element={<Shell />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
