"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { UnitCollection, UnitFeature, SummaryData } from "@/lib/types";
import { API_BASE_URL, BASE_PATH } from "@/lib/constants";
import { CITY_CONFIGS, type CityId } from "@/lib/cities";

interface UseUnitDataReturn {
  collection: UnitCollection | null;
  /** Philadelphia only. Null for Bogotá, whose stats live in collection.metadata. */
  summary: SummaryData | null;
  loading: boolean;
  error: string | null;
  /** O(1) lookup, keyed by the city's own id field. */
  getFeature: (id: number) => UnitFeature | undefined;
  featureIndex: ReadonlyMap<number, UnitFeature>;
  reload: () => void;
}

export function useUnitData(cityId: CityId): UseUnitDataReturn {
  const city = CITY_CONFIGS[cityId];

  const [collection, setCollection] = useState<UnitCollection | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  /**
   * Monotonic request counter. The AbortController below covers the network and
   * the 5 MB body parse, but not the window where a response has already
   * resolved and its setState is queued — StrictMode's double-invoke lands
   * squarely in it. Guarding every setState on the sequence closes that.
   */
  const seqRef = useRef(0);

  useEffect(() => {
    const seq = ++seqRef.current;
    const controller = new AbortController();

    // Clear synchronously, BEFORE the first await. Otherwise React renders one
    // frame where city is Bogotá and the collection is still Philadelphia
    // points, and the polygon path receives Point geometry.
    setCollection(null);
    setSummary(null);
    setError(null);
    setLoading(true);

    const run = async () => {
      try {
        const fetchWithFallback = async (
          apiPath: string | null,
          staticPath: string
        ) => {
          // Skip the API probe when this city has no route — Bogotá has none,
          // and an unguarded call would 404-then-fall-back on every load.
          if (API_BASE_URL && apiPath) {
            try {
              const res = await fetch(`${API_BASE_URL}${apiPath}`, {
                signal: controller.signal,
              });
              if (res.ok) return res;
            } catch {
              // API not running — fall through to the static file.
            }
          }
          return fetch(staticPath, { signal: controller.signal });
        };

        const geoRes = await fetchWithFallback(
          city.apiPath,
          `${BASE_PATH}${city.dataUrl}`
        );
        if (!geoRes.ok) {
          throw new Error(
            `Failed to load ${city.label} data: ${geoRes.status}`
          );
        }
        const geoData: UnitCollection = await geoRes.json();
        if (seq !== seqRef.current) return;
        setCollection(geoData);

        if (city.summaryUrl) {
          const summRes = await fetchWithFallback(
            "/api/summary",
            `${BASE_PATH}${city.summaryUrl}`
          );
          if (seq !== seqRef.current) return;
          if (summRes.ok) setSummary((await summRes.json()) as SummaryData);
        }
      } catch (err) {
        if (controller.signal.aborted || seq !== seqRef.current) return;
        const msg = err instanceof Error ? err.message : "Unknown error";
        setError(msg);
        console.error("useUnitData error:", msg);
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    };

    run();
    return () => controller.abort();
  }, [city, nonce]);

  const featureIndex = useMemo(() => {
    const index = new Map<number, UnitFeature>();
    if (collection) {
      const key = city.idField;
      for (const f of collection.features as UnitFeature[]) {
        const id = (f.properties as unknown as Record<string, unknown>)[key];
        if (typeof id === "number") index.set(id, f);
      }
    }
    return index;
  }, [collection, city.idField]);

  const getFeature = useCallback(
    (id: number) => featureIndex.get(id),
    [featureIndex]
  );

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { collection, summary, loading, error, getFeature, featureIndex, reload };
}
