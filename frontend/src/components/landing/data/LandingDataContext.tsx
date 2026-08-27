/**
 * KAKSHA -- landing data context.
 *
 * The resolved figures are read by five separate sections. Passing them down by
 * prop would thread the same object through markup that is otherwise purely
 * presentational, so they are provided once here instead.
 *
 * The provider never withholds children while loading. `useLandingData` always
 * returns a complete object -- live values when the engine has answered,
 * fallbacks when it has not -- so there is no loading branch to render and the
 * page never flashes empty.
 */
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { useLandingData } from "./useLandingData";
import type { LandingData } from "./useLandingData";

const LandingDataCtx = createContext<LandingData | null>(null);

export function LandingDataProvider({ children }: { children: ReactNode }) {
  const data = useLandingData();
  return <LandingDataCtx.Provider value={data}>{children}</LandingDataCtx.Provider>;
}

export function useLanding(): LandingData {
  const ctx = useContext(LandingDataCtx);
  if (!ctx) {
    throw new Error("useLanding must be used inside <LandingDataProvider>");
  }
  return ctx;
}
