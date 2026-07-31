"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { UnitCollection, UnitFeature, SummaryData } from "@/lib/types";
import { API_BASE_URL, BASE_PATH } from "@/lib/constants";
import { resolveDataUrl, type DatasetConfig } from "@/lib/cities";

interface UseUnitDataReturn {
  collection: UnitCollection | null;
  /** Only where the dataset has a companion summary file; else null. */
  summary: SummaryData | null;
  loading: boolean;
  error: string | null;
  /** O(1) lookup, keyed by the dataset's own id field. */
  getFeature: (id: number) => UnitFeature | undefined;
  featureIndex: ReadonlyMap<number, UnitFeature>;
  reload: () => void;
}

export function useUnitData(dataset: DatasetConfig): UseUnitDataReturn {

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
    // frame where the dataset is Segments and the collection is still the
    // intersection points, and the line path receives Point geometry.
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
          // Skip the API probe when this dataset has no route — only the
          // intersection layer has one, and an unguarded call would
          // 404-then-fall-back on every load.
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

        // BASE_PATH only applies to same-origin paths. A remote URL (R2) is
        // absolute and must be left alone — prefixing it would produce
        // "/walksafe-ai-dashboard/https://...".
        const { url, remote } = resolveDataUrl(dataset);
        const geoRes = await fetchWithFallback(
          dataset.apiPath,
          remote ? url : `${BASE_PATH}${url}`
        );
        if (!geoRes.ok) {
          throw new Error(
            `Failed to load ${dataset.label} data: ${geoRes.status}`
          );
        }
        const geoData: UnitCollection = await geoRes.json();
        if (seq !== seqRef.current) return;
        setCollection(geoData);

        if (dataset.summaryUrl) {
          const summRes = await fetchWithFallback(
            "/api/summary",
            `${BASE_PATH}${dataset.summaryUrl}`
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
  }, [dataset, nonce]);

  const featureIndex = useMemo(() => {
    const index = new Map<number, UnitFeature>();
    if (collection) {
      const key = dataset.idField;
      for (const f of collection.features as UnitFeature[]) {
        const id = (f.properties as unknown as Record<string, unknown>)[key];
        if (typeof id === "number") index.set(id, f);
      }
    }
    return index;
  }, [collection, dataset.idField]);

  const getFeature = useCallback(
    (id: number) => featureIndex.get(id),
    [featureIndex]
  );

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { collection, summary, loading, error, getFeature, featureIndex, reload };
}
