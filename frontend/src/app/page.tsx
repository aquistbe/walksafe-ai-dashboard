"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useUnitData } from "@/hooks/useUnitData";
import { useCity } from "@/lib/cityContext";
import type {
  FilterState,
  UnitFeature,
  IntersectionFeature,
  ZatFeature,
  ZatCollection,
  RiskTier,
} from "@/lib/types";
import { isZatFeature, isZatCollection } from "@/lib/types";
import { defaultFiltersFor } from "@/lib/constants";
import { matchesFilters } from "@/lib/filters";
import CrashSidebar from "@/components/Sidebar";
import ZatSidebar from "@/components/ZatSidebar";
import MapExplorer from "@/components/MapExplorer";
import InfoPanel from "@/components/InfoPanel";
import ZatInfoPanel from "@/components/ZatInfoPanel";
import type { LegendCounts } from "@/components/map/Legend";

export default function HomePage() {
  const { cityId, city } = useCity();
  const { collection, summary, loading, error, getFeature, featureIndex } =
    useUnitData(cityId);

  const [filters, setFilters] = useState<FilterState>(() => defaultFiltersFor(city));
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  /**
   * The active layer mode decides which "no data" gate applies, and MapExplorer
   * owns that state. Mirroring just the gate field here keeps the JS predicate
   * and the GPU filter in step without lifting the whole toolbar.
   */
  const gateField = city.layerModes.find((m) => m.id === city.defaultLayerMode)?.gateField;

  // Filters are per unit type — reset them when the city changes, or a
  // Philadelphia risk-tier filter would silently exclude every Bogotá zone.
  useEffect(() => {
    setFilters(defaultFiltersFor(city));
    setSelectedId(null);
    deepLinkApplied.current = false;
  }, [city]);

  const features = useMemo(
    () => (collection ? (collection.features as UnitFeature[]) : []),
    [collection]
  );

  const filteredFeatures = useMemo(
    () => features.filter((f) => matchesFilters(f, filters, gateField)),
    [features, filters, gateField]
  );

  /** Legend counts, keyed per city. */
  const legendCounts = useMemo<LegendCounts>(() => {
    const counts: LegendCounts = {};
    if (city.unitType === "polygon") {
      counts["1"] = 0; counts["2"] = 0; counts["3"] = 0; counts["4"] = 0;
      counts.none = 0;
      for (const f of filteredFeatures) {
        if (!isZatFeature(f)) continue;
        const c = f.properties.clus;
        if (c) counts[String(c)]++;
        else counts.none++;
      }
    } else {
      const tiers: RiskTier[] = ["Critical", "High", "Moderate", "Low"];
      for (const t of tiers) counts[t] = 0;
      for (const f of filteredFeatures) {
        if (isZatFeature(f)) continue;
        counts[(f as IntersectionFeature).properties.risk_tier]++;
      }
    }
    return counts;
  }, [filteredFeatures, city.unitType]);

  /** Priority list: highest eb_ksi for Philadelphia, highest density for Bogotá. */
  const topUnits = useMemo(() => {
    if (city.unitType === "polygon") {
      return [...filteredFeatures]
        .filter((f): f is ZatFeature => isZatFeature(f) && f.properties.has_covariates)
        .sort(
          (a, b) =>
            (b.properties.casualties_per_km2 ?? 0) - (a.properties.casualties_per_km2 ?? 0)
        )
        .slice(0, 50);
    }
    return [...features]
      .filter((f): f is IntersectionFeature => !isZatFeature(f))
      .sort((a, b) => b.properties.eb_ksi - a.properties.eb_ksi)
      .slice(0, 50);
  }, [features, filteredFeatures, city.unitType]);

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
  // city change above, because ?site= means a different thing per city.
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

  return (
    <div className="h-[calc(100vh-3.5rem)] flex overflow-hidden">
      {filters.kind === "bogota-zat" ? (
        <ZatSidebar
          filters={filters}
          onFiltersChange={setFilters}
          totalCount={features.length}
          filteredCount={filteredFeatures.length}
          clusterCounts={legendCounts}
          topZones={topUnits as ZatFeature[]}
          onSelectUnit={handleSelect}
          caveat={zatMetadata?.caveat ?? city.mapCaveat}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
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
          collection={collection}
          featureIndex={featureIndex}
          filters={filters}
          selectedId={selectedId}
          onSelectUnit={handleSelect}
          loading={loading}
          legendCounts={legendCounts}
        />

        {selectedFeature && isZatFeature(selectedFeature) ? (
          <ZatInfoPanel
            feature={selectedFeature}
            metadata={zatMetadata}
            onClose={() => handleSelect(null)}
          />
        ) : (
          <InfoPanel
            feature={(selectedFeature as IntersectionFeature) ?? null}
            onClose={() => handleSelect(null)}
          />
        )}

        {/* Stats bar */}
        {!loading && (summary || zatMetadata) && (
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
                <span className="text-gray-500">{city.unitLabelPlural}</span>
              </div>

              {zatMetadata ? (
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
                    Crashes {zatMetadata.crash_window} | DINO/STRIDE extraction,
                    ~312,000 Street View points
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
