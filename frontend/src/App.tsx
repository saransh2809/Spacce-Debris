/**
 * KAKSHA -- application shell and routing.
 *
 * Real routes, not tab state: each page has a URL, browser history works, and
 * a specific view can be linked to during a demonstration.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { TopBar } from "./components/layout/TopBar";
import { BootGate } from "./components/layout/BootGate";
import { Dashboard } from "./pages/Dashboard";
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

function Shell() {
  useClockSync();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TopBar />
      <BootGate>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/tracker" element={<Tracker />} />
          <Route path="/conjunctions" element={<Conjunctions />} />
          <Route path="/calculations" element={<Calculations />} />
          <Route path="/analysis" element={<Analysis />} />
          <Route path="/simulation" element={<Simulation />} />
          <Route path="/validation" element={<Validation />} />
        </Routes>
      </BootGate>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
