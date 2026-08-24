"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useUnitData } from "@/hooks/useUnitData";
import { useCity } from "@/lib/cityContext";
import type {
  FilterState,
  UnitFeature,
  IntersectionFeature,
  SegmentFeature,
  SegmentCollection,
  ZatFeature,
  ZatCollection,
  RiskTier,
  TractFeature,
} from "@/lib/types";
import {
  isIntersectionFeature,
  isSegmentFeature,
  isZatFeature,
  isTractFeature,
  isZatCollection,
  isSegmentCollection,
  isTractCollection,
} from "@/lib/types";
import { defaultFiltersFor, MIN_TRIPS_FOR_RANKING } from "@/lib/constants";
import { matchesFilters } from "@/lib/filters";
import CrashSidebar from "@/components/Sidebar";
import ZatSidebar from "@/components/ZatSidebar";
import SegmentSidebar from "@/components/SegmentSidebar";
import TractSidebar from "@/components/TractSidebar";
import MapExplorer from "@/components/MapExplorer";
import InfoPanel from "@/components/InfoPanel";
import ZatInfoPanel from "@/components/ZatInfoPanel";
import SegmentInfoPanel from "@/components/SegmentInfoPanel";
import TractInfoPanel from "@/components/TractInfoPanel";
import type { LegendCounts } from "@/components/map/Legend";

export default function HomePage() {
  const { city, dataset, setDatasetId } = useCity();
  const { collection, summary, loading, error, getFeature, featureIndex } =
    useUnitData(dataset);

  const [filters, setFilters] = useState<FilterState>(() => defaultFiltersFor(dataset));
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  /**
   * The active layer mode decides which "no data" gate applies, and MapExplorer
   * owns that state. Mirroring just the gate field here keeps the JS predicate
   * and the GPU filter in step without lifting the whole toolbar.
   */
  const gateField = dataset.layerModes.find(
    (m) => m.id === dataset.defaultLayerMode
  )?.gateField;

  // Filters are per analysis unit — reset them when the dataset changes, or a
  // risk-tier filter meant for intersections would silently exclude every
  // segment.
  useEffect(() => {
    setFilters(defaultFiltersFor(dataset));
    setSelectedId(null);
    deepLinkApplied.current = false;
  }, [dataset]);

  const features = useMemo(
    () => (collection ? (collection.features as UnitFeature[]) : []),
    [collection]
  );

  const filteredFeatures = useMemo(
    () => features.filter((f) => matchesFilters(f, filters, gateField)),
    [features, filters, gateField]
  );

  /** Legend counts, keyed per analysis unit. */
  const legendCounts = useMemo<LegendCounts>(() => {
    const counts: LegendCounts = {};
    if (dataset.unitType === "line") {
      const tiers: RiskTier[] = ["Critical", "High", "Moderate", "Low"];
      for (const t of tiers) counts[t] = 0;
      // Both directions. The legend states coverage positively ("599 of
      // 39,761 have observed crashes") because the negative framing reads as an
      // error on a mode where only 1.5% of units carry a value.
      counts.total = 0;
      counts.hasModel = 0;
      counts.hasAadt = 0;
      counts.hasCrashes = 0;
      counts.noModel = 0;
      counts.noAadt = 0;
      counts.noCrashes = 0;
      for (const f of filteredFeatures) {
        if (!isSegmentFeature(f)) continue;
        const p = f.properties;
        counts.total++;
        if (p.tier) counts[p.tier]++;
        if (p.has_model) counts.hasModel++; else counts.noModel++;
        if (p.has_aadt) counts.hasAadt++; else counts.noAadt++;
        if (p.has_crashes) counts.hasCrashes++; else counts.noCrashes++;
      }
    } else if (dataset.unitType === "polygon") {
      counts["1"] = 0; counts["2"] = 0; counts["3"] = 0; counts["4"] = 0;
      counts.none = 0;
      // Tallied per GATE FIELD, for every mode at once — not just the active
      // one, and not just the default.
      //
      // `gateField` below is derived from the dataset's DEFAULT layer mode, so
      // a single `none` counter reported the default mode's coverage whatever
      // ramp was on screen. On Bogotá that meant Casualties and Age 60+ both
      // printed 39 — the count of zones with no cluster profile — where the
      // true figures are 96 zones with no crash data and 28 with no
      // population. The line branch above never had this because it keeps
      // three independent counters; this is the polygon equivalent.
      for (const m of dataset.layerModes) {
        if (!m.gateField) continue;
        counts[`has_${m.gateField}`] = 0;
        counts[`no_${m.gateField}`] = 0;
      }
      for (const f of filteredFeatures) {
        // Both polygon units carry per-mode gate flags; only ZATs carry a
        // cluster. Tracts used to be skipped here outright, so their legend
        // reported zero coverage for every mode.
        if (!isZatFeature(f) && !isTractFeature(f)) continue;
        const props = f.properties as unknown as Record<string, boolean>;
        for (const m of dataset.layerModes) {
          if (!m.gateField) continue;
          if (props[m.gateField]) counts[`has_${m.gateField}`]++;
          else counts[`no_${m.gateField}`]++;
        }
        if (!isZatFeature(f)) continue;
        const c = f.properties.clus;
        if (c) counts[String(c)]++;
        else counts.none++;
      }
    } else {
      const tiers: RiskTier[] = ["Critical", "High", "Moderate", "Low"];
      for (const t of tiers) counts[t] = 0;
      for (const f of filteredFeatures) {
        if (!isIntersectionFeature(f)) continue;
        counts[f.properties.risk_tier]++;
      }
    }
    return counts;
  }, [filteredFeatures, dataset.unitType, dataset.layerModes]);

  /** Priority list, per analysis unit. */
  const topUnits = useMemo(() => {
    if (dataset.unitType === "line") {
      return [...filteredFeatures]
        .filter((f): f is SegmentFeature => isSegmentFeature(f))
        .sort(
          (a, b) =>
            ((b.properties.ped_ksi_seg ?? b.properties.ped_crashes_seg ?? 0) -
             (a.properties.ped_ksi_seg ?? a.properties.ped_crashes_seg ?? 0))
        )
        .slice(0, 50);
    }
    if (dataset.unitType === "polygon") {
      // Both the Bogotá ZAT layer and the Philadelphia tract layer are
      // polygons, so unitType does not separate them; without this the tracts
      // fall into the ZAT branch, fail isZatFeature, and the priority list is
      // silently empty.
      //
      // Ranked by excess KSI — observed minus the SPF expectation — rather than
      // by raw count. A large tract with many crashes and many road miles is
      // not a priority; one with more than its exposure predicts is.
      const tracts = [...filteredFeatures].filter((f): f is TractFeature =>
        isTractFeature(f)
      );
      if (tracts.length > 0) {
        return tracts
          .sort(
            (a, b) => (b.properties.excess_ksi ?? 0) - (a.properties.excess_ksi ?? 0)
          )
          .slice(0, 50);
      }
      return [...filteredFeatures]
        .filter((f): f is ZatFeature => isZatFeature(f) && f.properties.has_covariates
          && (f.properties.walk_pubt ?? 0) >= MIN_TRIPS_FOR_RANKING)
        .sort(
          (a, b) =>
            (b.properties.casualties_per_10k_trips ?? 0) - (a.properties.casualties_per_10k_trips ?? 0)
        )
        .slice(0, 50);
    }
    return [...features]
      .filter((f): f is IntersectionFeature => isIntersectionFeature(f))
      .sort((a, b) => b.properties.eb_ksi - a.properties.eb_ksi)
      .slice(0, 50);
  }, [features, filteredFeatures, dataset.unitType]);

  const selectedFeature = useMemo(
    () => (selectedId === null ? null : getFeature(selectedId) ?? null),
    [selectedId, getFeature]
  );

  const handleSelect = useCallback((id: number | null) => {
    setSelectedId(id);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (id === null) url.searchParams.delete("site");
    else url.searchParams.set("site", String(id));
    window.history.replaceState(null, "", url.toString());
  }, []);

  // Open the unit named in ?site= once data has loaded. The ref is reset on
  // dataset change above, because ?site= means a different thing per dataset
  // — and seg_id and node_id are both small positive integers, so a stale one
  // would resolve to a real but wrong feature rather than to nothing.
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current || !collection) return;
    const param = new URLSearchParams(window.location.search).get("site");
    if (param) {
      const id = Number(param);
      if (Number.isFinite(id) && getFeature(id)) setSelectedId(id);
    }
    deepLinkApplied.current = true;
  }, [collection, getFeature]);

  if (error) {
    return (
      <div className="h-[calc(100vh-3.5rem)] flex items-center justify-center bg-walksafe-bg">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-walksafe-red">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-walksafe-text">
            Failed to load data
          </h2>
          <p className="text-sm text-walksafe-text-muted mt-1">{error}</p>
        </div>
      </div>
    );
  }

  const zatMetadata: ZatCollection["metadata"] | null =
    collection && isZatCollection(collection) ? collection.metadata : null;
  const segMetadata: SegmentCollection["metadata"] | null =
    collection && isSegmentCollection(collection) ? collection.metadata : null;
  const tractMetadata =
    collection && isTractCollection(collection) ? collection.metadata : null;

  /**
   * The layer caveat: resolved once here, rendered once in the sidebar.
   *
   * The data file wins. metadata.caveat is rebuilt alongside the numbers it
   * qualifies, so it cannot drift from them; dataset.mapCaveat is the fallback
   * for a dataset whose file carries none. Never read dataset.mapCaveat at a
   * call site — that is the fallback, not the answer.
   *
   * It used to render TWICE from this one value: in full in the sidebar, and
   * again as a one-line clamped callout pinned to the map. Two copies of the
   * same sentence, one of them truncated mid-clause, competing for the reader's
   * attention directly above the toolbar. The map callout is gone; the sidebar
   * has room for the whole thing.
   */
  const caveat = segMetadata?.caveat ?? zatMetadata?.caveat ?? dataset.mapCaveat;

  return (
    <div className="h-[calc(100vh-3.5rem)] flex overflow-hidden">
      {filters.kind === "philadelphia-segment" ? (
        // filterKind "philadelphia-segment" is declared only on line datasets,
        // so this narrowing never fails in practice — it is here because
        // `dataset.segment` is reachable only on the line arm of the union.
        dataset.unitType === "line" ? (
          <SegmentSidebar
            filters={filters}
            onFiltersChange={setFilters}
            totalCount={features.length}
            filteredCount={filteredFeatures.length}
            topSegments={topUnits as SegmentFeature[]}
            onSelectUnit={handleSelect}
            dataset={dataset}
            caveat={caveat}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
        ) : null
      ) : filters.kind === "bogota-zat" ? (
        <ZatSidebar
          filters={filters}
          onFiltersChange={setFilters}
          totalCount={features.length}
          filteredCount={filteredFeatures.length}
          clusterCounts={legendCounts}
          topZones={topUnits as ZatFeature[]}
          onSelectUnit={handleSelect}
          caveat={caveat}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
      ) : filters.kind === "philadelphia-tract" ? (
        // Same narrowing as the segment arm above, and for the same reason:
        // TractSidebar reads dataset.measure off PolygonDatasetConfig, which is
        // reachable only on the polygon arm of the DatasetConfig union.
        dataset.unitType === "polygon" ? (
          <TractSidebar
            filters={filters}
            onFiltersChange={setFilters}
            totalCount={features.length}
            filteredCount={filteredFeatures.length}
            topTracts={topUnits as TractFeature[]}
            onSelectUnit={handleSelect}
            dataset={dataset}
            caveat={caveat}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
        ) : null
      ) : (
        <CrashSidebar
          filters={filters}
          onFiltersChange={setFilters}
          totalCount={features.length}
          filteredCount={filteredFeatures.length}
          topIntersections={topUnits as IntersectionFeature[]}
          onSelectIntersection={handleSelect}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
      )}

      <div className="flex-1 relative">
        <MapExplorer
          city={city}
          dataset={dataset}
          onSelectDataset={setDatasetId}
          collection={collection}
          featureIndex={featureIndex}
          filters={filters}
          selectedId={selectedId}
          onSelectUnit={handleSelect}
          loading={loading}
          legendCounts={legendCounts}
        />

        {/* Exhaustive on the unit type. A two-way ternary here would hand a
            segment to the intersection panel, which reads fields that do not
            exist and renders a panel of blanks rather than failing. */}
        {selectedFeature && isZatFeature(selectedFeature) && (
          <ZatInfoPanel
            feature={selectedFeature}
            metadata={zatMetadata}
            onClose={() => handleSelect(null)}
          />
        )}
        {selectedFeature &&
          isSegmentFeature(selectedFeature) &&
          dataset.unitType === "line" && (
            <SegmentInfoPanel
              feature={selectedFeature}
              metadata={segMetadata}
              onClose={() => handleSelect(null)}
              dataset={dataset}
              attribution={dataset.attribution}
            />
          )}
        {selectedFeature && isTractFeature(selectedFeature) && (
          <TractInfoPanel
            feature={selectedFeature}
            metadata={tractMetadata}
            onClose={() => handleSelect(null)}
            attribution={dataset.attribution}
          />
        )}
        {selectedFeature && isIntersectionFeature(selectedFeature) && (
          <InfoPanel
            feature={selectedFeature}
            onClose={() => handleSelect(null)}
          />
        )}

        {/* Stats bar */}
        {!loading && (summary || zatMetadata || segMetadata || tractMetadata) && (
          <div className="absolute bottom-4 left-4 right-4 z-10">
            <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 px-4 py-2 flex items-center gap-6 text-xs">
              <div>
                <span className="text-gray-500">Showing</span>{" "}
                <span className="font-semibold text-walksafe-text">
                  {filteredFeatures.length.toLocaleString()}
                </span>{" "}
                <span className="text-gray-500">of</span>{" "}
                <span className="font-semibold text-walksafe-text">
                  {features.length.toLocaleString()}
                </span>{" "}
                <span className="text-gray-500">{dataset.unitLabelPlural}</span>
              </div>

              {segMetadata ? (
                <>
                  {/* Two segment layers with different metadata shapes:
                      Philadelphia carries the mid-block/intersection crash
                      split, Bogota carries plain coverage counts. Neither is
                      assumed present. */}
                  {segMetadata.crash_accounting && (
                    <>
                      <Divider />
                      <div>
                        <span className="text-gray-500">
                          Mid-block {dataset.measure.outcomeLabelShort}:
                        </span>{" "}
                        <span className="font-semibold text-walksafe-red">
                          {segMetadata.crash_accounting.segment_on_walkable_network.toLocaleString()}
                        </span>
                      </div>
                    </>
                  )}
                  {segMetadata.coverage && (
                    <>
                      <Divider />
                      <div>
                        <span className="text-gray-500">Pedestrian crashes:</span>{" "}
                        <span className="font-semibold text-walksafe-red">
                          {segMetadata.coverage.pedestrian_crashes.toLocaleString()}
                        </span>
                      </div>
                      <Divider />
                      <div>
                        <span className="text-gray-500">With a crash:</span>{" "}
                        <span className="font-semibold text-walksafe-text">
                          {segMetadata.coverage.with_crashes.toLocaleString()}
                        </span>
                      </div>
                    </>
                  )}
                  {segMetadata.exposure && (
                    <>
                      <Divider />
                      <div>
                        <span className="text-gray-500">Exposure:</span>{" "}
                        <span className="font-semibold text-walksafe-text">
                          {segMetadata.exposure.exposure_mi.toLocaleString()} mi
                        </span>{" "}
                        <span className="text-gray-500">
                          of {segMetadata.exposure.network_mi.toLocaleString()}
                        </span>
                      </div>
                    </>
                  )}
                  <Divider />
                  <div className="text-gray-400">
                    {/* Window and outcome from the dataset, not inferred from
                        which optional metadata block happens to be present. */}
                    Crashes {dataset.measure.crashWindow} |{" "}
                    {dataset.measure.outcomeLabel}
                    {segMetadata.crash_accounting &&
                      `, split from the ${segMetadata.crash_accounting.intersection_layer} at intersections`}
                  </div>
                </>
              ) : zatMetadata ? (
                <>
                  <Divider />
                  <div>
                    <span className="text-gray-500">With profile:</span>{" "}
                    <span className="font-semibold text-walksafe-text">
                      {zatMetadata.join.with_features.toLocaleString()}
                    </span>
                  </div>
                  <Divider />
                  <div>
                    <span className="text-gray-500">With crash data:</span>{" "}
                    <span className="font-semibold text-walksafe-text">
                      {zatMetadata.join.with_covariates.toLocaleString()}
                    </span>
                  </div>
                  <Divider />
                  <div className="text-gray-400">
                    Crashes {dataset.measure.crashWindow} | DINO/STRIDE
                    extraction, ~312,000 Street View points
                  </div>
                </>
              ) : summary ? (
                <>
                  <Divider />
                  <div>
                    <span className="text-gray-500">Total KSI:</span>{" "}
                    <span className="font-semibold text-walksafe-red">
                      {summary.total_ped_ksi_crashes.toLocaleString()}
                    </span>
                  </div>
                  <Divider />
                  <div>
                    <span className="text-gray-500">Fatalities:</span>{" "}
                    <span className="font-semibold text-walksafe-red">
                      {summary.total_ped_deaths.toLocaleString()}
                    </span>
                  </div>
                  <Divider />
                  <div className="text-gray-400">
                    {summary.date_range.start}&#8211;{summary.date_range.end} |{" "}
                    {summary.data_source}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="h-4 w-px bg-gray-200" />;
}
