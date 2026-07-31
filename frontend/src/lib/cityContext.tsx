"use client";

/**
 * Which city the dashboard is showing.
 *
 * The switcher lives in the Navbar (rendered by layout.tsx) while the data
 * lives in the page, so the selection needs somewhere shared. A context holds
 * it in-app; `?city=` is the persisted, shareable form.
 *
 * Deliberately NOT `useSearchParams()`: under `output: "export"` Next 14 throws
 * "useSearchParams() should be wrapped in a suspense boundary" during
 * prerendering, which would break the GitHub Pages build. The
 * history.replaceState + popstate idiom below is the one page.tsx already uses
 * for `?site=`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  CITY_CONFIGS,
  DEFAULT_CITY,
  type CityConfig,
  type CityId,
} from "./cities";

function isCityId(v: unknown): v is CityId {
  return typeof v === "string" && v in CITY_CONFIGS;
}

interface CityContextValue {
  cityId: CityId;
  city: CityConfig;
  setCityId: (next: CityId) => void;
}

const CityContext = createContext<CityContextValue | null>(null);

export function CityProvider({ children }: { children: React.ReactNode }) {
  // Always start on the default. Reading window.location during render would be
  // a hydration mismatch — the prerendered HTML always says Philadelphia.
  const [cityId, setCityIdState] = useState<CityId>(DEFAULT_CITY);

  useEffect(() => {
    const read = () => {
      const q = new URLSearchParams(window.location.search).get("city");
      setCityIdState(isCityId(q) ? q : DEFAULT_CITY);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const setCityId = useCallback((next: CityId) => {
    setCityIdState(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next === DEFAULT_CITY) url.searchParams.delete("city");
    else url.searchParams.set("city", next);
    // Unit ids are not comparable across cities — ZAT 5 is not node 5.
    url.searchParams.delete("site");
    window.history.replaceState(null, "", url.toString());
  }, []);

  const value = useMemo(
    () => ({ cityId, city: CITY_CONFIGS[cityId], setCityId }),
    [cityId, setCityId]
  );

  return <CityContext.Provider value={value}>{children}</CityContext.Provider>;
}

export function useCity(): CityContextValue {
  const ctx = useContext(CityContext);
  if (!ctx) throw new Error("useCity must be used inside a CityProvider");
  return ctx;
}
