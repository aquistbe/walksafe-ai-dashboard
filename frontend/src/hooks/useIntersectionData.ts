"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  IntersectionCollection,
  IntersectionFeature,
  SummaryData,
} from "@/lib/types";
import { API_BASE_URL, BASE_PATH } from "@/lib/constants";

interface UseIntersectionDataReturn {
  geojson: IntersectionCollection | null;
  summary: SummaryData | null;
  loading: boolean;
  error: string | null;
  /** Look up a single feature by node_id from the cached collection. */
  getFeature: (nodeId: number) => IntersectionFeature | undefined;
  /** Reload data from the API. */
  reload: () => void;
}

export function useIntersectionData(): UseIntersectionDataReturn {
  const [geojson, setGeojson] = useState<IntersectionCollection | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Helper: try the API first, fall back to a static file on non-ok or network error.
      const fetchWithFallback = async (apiPath: string, staticPath: string) => {
        if (API_BASE_URL) {
          try {
            const res = await fetch(`${API_BASE_URL}${apiPath}`);
            if (res.ok) return res;
          } catch {
            // Network error (API not running) — fall through to static
          }
        }
        return fetch(staticPath);
      };

      const [geoRes, summRes] = await Promise.all([
        fetchWithFallback(
          "/api/intersections",
          `${BASE_PATH}/data/intersections.geojson`
        ),
        fetchWithFallback("/api/summary", `${BASE_PATH}/data/summary.json`),
      ]);

      if (!geoRes.ok) {
        throw new Error(`Failed to load intersection data: ${geoRes.status}`);
      }

      const geoData: IntersectionCollection = await geoRes.json();
      setGeojson(geoData);

      if (summRes.ok) {
        const summData: SummaryData = await summRes.json();
        setSummary(summData);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      console.error("useIntersectionData error:", msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getFeature = useCallback(
    (nodeId: number): IntersectionFeature | undefined => {
      if (!geojson) return undefined;
      return geojson.features.find(
        (f) => f.properties.node_id === nodeId
      );
    },
    [geojson]
  );

  return { geojson, summary, loading, error, getFeature, reload: fetchData };
}
