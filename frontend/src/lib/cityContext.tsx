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
  resolveDataset,
  type CityConfig,
  type CityId,
  type DatasetConfig,
} from "./cities";

function isCityId(v: unknown): v is CityId {
  return typeof v === "string" && v in CITY_CONFIGS;
}

interface CityContextValue {
  cityId: CityId;
  city: CityConfig;
  dataset: DatasetConfig;
  setCityId: (next: CityId) => void;
  setDatasetId: (next: string) => void;
}

const CityContext = createContext<CityContextValue | null>(null);

export function CityProvider({ children }: { children: React.ReactNode }) {
  // Always start on the defaults. Reading window.location during render would
  // be a hydration mismatch — the prerendered HTML always says Philadelphia.
  const [cityId, setCityIdState] = useState<CityId>(DEFAULT_CITY);
  const [datasetId, setDatasetIdState] = useState<string | null>(null);

  useEffect(() => {
    const read = () => {
      const q = new URLSearchParams(window.location.search);
      const c = q.get("city");
      setCityIdState(isCityId(c) ? c : DEFAULT_CITY);
      setDatasetIdState(q.get("layer"));
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const city = CITY_CONFIGS[cityId];
  const dataset = resolveDataset(city, datasetId);

  const setCityId = useCallback((next: CityId) => {
    setCityIdState(next);
    setDatasetIdState(null);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next === DEFAULT_CITY) url.searchParams.delete("city");
    else url.searchParams.set("city", next);
    url.searchParams.delete("layer");
    // Unit ids are not comparable across cities — ZAT 5 is not node 5.
    url.searchParams.delete("site");
    window.history.replaceState(null, "", url.toString());
  }, []);

  const setDatasetId = useCallback((next: string) => {
    setDatasetIdState(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("layer", next);
    // Ids are not comparable across datasets either, and this case is more
    // dangerous than the city one: seg_id and node_id are both small positive
    // integers, so a stale ?site= would silently resolve to a real but WRONG
    // feature rather than to nothing.
    url.searchParams.delete("site");
    window.history.replaceState(null, "", url.toString());
  }, []);

  const value = useMemo(
    () => ({ cityId, city, dataset, setCityId, setDatasetId }),
    [cityId, city, dataset, setCityId, setDatasetId]
  );

  return <CityContext.Provider value={value}>{children}</CityContext.Provider>;
}

export function useCity(): CityContextValue {
  const ctx = useContext(CityContext);
  if (!ctx) throw new Error("useCity must be used inside a CityProvider");
  return ctx;
}
