"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useIntersectionData } from "@/hooks/useIntersectionData";
import type { FilterState, IntersectionFeature } from "@/lib/types";
import { DEFAULT_FILTERS } from "@/lib/constants";
import Sidebar from "@/components/Sidebar";
import MapExplorer from "@/components/MapExplorer";
import InfoPanel from "@/components/InfoPanel";

export default function HomePage() {
  const { geojson, summary, loading, error, getFeature } =
    useIntersectionData();

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Filter features based on current filter state
  const filteredFeatures = useMemo(() => {
    if (!geojson) return [];

    return geojson.features.filter((f) => {
      const p = f.properties;

      // Risk tier filter
      if (
        filters.riskTiers.length > 0 &&
        !filters.riskTiers.includes(p.risk_tier)
      ) {
        return false;
      }

      // Risk score range
      if (
        p.eb_ksi < filters.riskScoreRange[0] ||
        p.eb_ksi > filters.riskScoreRange[1]
      ) {
        return false;
      }

      // Stop type filter
      if (
        filters.stopTypes.length > 0 &&
        !filters.stopTypes.includes(p.stoptype)
      ) {
        return false;
      }

      // HIN filter
      if (filters.onHin !== null && p.on_hin !== filters.onHin) {
        return false;
      }

      // Camera filter
      if (
        filters.hasCamera !== null &&
        (p.any_camera > 0) !== filters.hasCamera
      ) {
        return false;
      }

      // Near school
      if (
        filters.nearSchool !== null &&
        (p.schools_200m > 0) !== filters.nearSchool
      ) {
        return false;
      }

      // Near park
      if (
        filters.nearPark !== null &&
        (p.parks_200m > 0) !== filters.nearPark
      ) {
        return false;
      }

      // Top 50
      if (filters.top50Only && !p.top50) {
        return false;
      }

      // Search
      if (filters.searchQuery) {
        const q = filters.searchQuery.toLowerCase();
        if (!p.int_name.toLowerCase().includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [geojson, filters]);

  // Tier counts after filtering — drives the map legend.
  // NOTE: the map receives the FULL collection and filters GPU-side, so we
  // never rebuild a 17k-feature GeoJSON on filter changes.
  const tierCounts = useMemo(() => {
    const counts = { Critical: 0, High: 0, Moderate: 0, Low: 0 };
    for (const f of filteredFeatures) counts[f.properties.risk_tier]++;
    return counts;
  }, [filteredFeatures]);

  // Top intersections for the priority list (sorted by eb_ksi desc)
  const topIntersections = useMemo(() => {
    if (!geojson) return [];
    return [...geojson.features]
      .sort((a, b) => b.properties.eb_ksi - a.properties.eb_ksi)
      .slice(0, 50);
  }, [geojson]);

  // Selected feature
  const selectedFeature = useMemo(() => {
    if (selectedNodeId === null) return null;
    return getFeature(selectedNodeId) ?? null;
  }, [selectedNodeId, getFeature]);

  const handleSelectIntersection = useCallback((nodeId: number | null) => {
    setSelectedNodeId(nodeId);
    // Keep the URL shareable without adding history entries.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (nodeId === null) url.searchParams.delete("site");
      else url.searchParams.set("site", String(nodeId));
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  // Open the intersection named in ?site= once data has loaded (deep links).
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current || !geojson) return;
    const param = new URLSearchParams(window.location.search).get("site");
    if (!param) {
      deepLinkApplied.current = true;
      return;
    }
    const nodeId = Number(param);
    if (Number.isFinite(nodeId) && getFeature(nodeId)) {
      setSelectedNodeId(nodeId);
    }
    deepLinkApplied.current = true;
  }, [geojson, getFeature]);

  // Error state
  if (error) {
    return (
      <div className="h-[calc(100vh-3.5rem)] flex items-center justify-center bg-walksafe-bg">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-walksafe-red"
            >
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

  return (
    <div className="h-[calc(100vh-3.5rem)] flex overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        filters={filters}
        onFiltersChange={setFilters}
        totalCount={geojson?.features.length ?? 0}
        filteredCount={filteredFeatures.length}
        topIntersections={topIntersections}
        onSelectIntersection={(id) => handleSelectIntersection(id)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Map area */}
      <div className="flex-1 relative">
        <MapExplorer
          geojson={geojson}
          filters={filters}
          selectedNodeId={selectedNodeId}
          onSelectIntersection={handleSelectIntersection}
          loading={loading}
          tierCounts={tierCounts}
        />

        {/* Info Panel — floats over the map on the right */}
        <InfoPanel
          feature={selectedFeature}
          onClose={() => handleSelectIntersection(null)}
        />

        {/* Summary stats bar at bottom of map */}
        {summary && !loading && (
          <div className="absolute bottom-4 left-4 right-4 z-10">
            <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 px-4 py-2 flex items-center gap-6 text-xs">
              <div>
                <span className="text-gray-500">Showing</span>{" "}
                <span className="font-semibold text-walksafe-text">
                  {filteredFeatures.length.toLocaleString()}
                </span>{" "}
                <span className="text-gray-500">of</span>{" "}
                <span className="font-semibold text-walksafe-text">
                  {summary.total_intersections.toLocaleString()}
                </span>{" "}
                <span className="text-gray-500">intersections</span>
              </div>
              <div className="h-4 w-px bg-gray-200" />
              <div>
                <span className="text-gray-500">Total KSI:</span>{" "}
                <span className="font-semibold text-walksafe-red">
                  {summary.total_ped_ksi_crashes.toLocaleString()}
                </span>
              </div>
              <div className="h-4 w-px bg-gray-200" />
              <div>
                <span className="text-gray-500">Fatalities:</span>{" "}
                <span className="font-semibold text-walksafe-red">
                  {summary.total_ped_deaths.toLocaleString()}
                </span>
              </div>
              <div className="h-4 w-px bg-gray-200" />
              <div className="text-gray-400">
                {summary.date_range.start}&#8211;{summary.date_range.end} |{" "}
                {summary.data_source}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
