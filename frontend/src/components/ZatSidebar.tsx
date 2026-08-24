"use client";

import { useCallback } from "react";
import type { ZatFilterState, ZatCluster, SesCategory, ZatFeature } from "@/lib/types";
import {
  DEFAULT_ZAT_FILTERS,
  CLUSTER_COLORS,
  CLUSTER_LABELS,
  CLUSTER_ORDER,
  SES_CATEGORIES,
  SES_LABEL,
} from "@/lib/constants";
import FilterChip from "./FilterChip";

interface ZatSidebarProps {
  filters: ZatFilterState;
  onFiltersChange: (filters: ZatFilterState) => void;
  totalCount: number;
  filteredCount: number;
  clusterCounts: Record<string, number>;
  topZones: ZatFeature[];
  onSelectUnit: (id: number) => void;
  caveat: string | null;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function ZatSidebar({
  filters,
  onFiltersChange,
  totalCount,
  filteredCount,
  clusterCounts,
  topZones,
  onSelectUnit,
  caveat,
  collapsed = false,
  onToggleCollapse,
}: ZatSidebarProps) {
  const update = useCallback(
    <K extends keyof ZatFilterState>(key: K, value: ZatFilterState[K]) => {
      onFiltersChange({ ...filters, [key]: value });
    },
    [filters, onFiltersChange]
  );

  const toggleCluster = useCallback(
    (c: ZatCluster) => {
      const cur = filters.clusters;
      update("clusters", cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]);
    },
    [filters.clusters, update]
  );

  const toggleSes = useCallback(
    (s: SesCategory) => {
      const cur = filters.sesCategories;
      update("sesCategories", cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]);
    },
    [filters.sesCategories, update]
  );

  if (collapsed) {
    return (
      <div className="w-12 bg-white border-r border-gray-200 flex flex-col items-center pt-4">
        <button
          onClick={onToggleCollapse}
          className="p-2 rounded-md hover:bg-gray-100 text-gray-500"
          aria-label="Expand sidebar"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <aside className="w-80 bg-white border-r border-gray-200 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
        <div>
          <h2 className="font-semibold text-sm text-walksafe-text">Filters</h2>
          <p className="text-xs text-walksafe-text-muted mt-0.5">
            {filteredCount.toLocaleString()} of {totalCount.toLocaleString()} ZATs
            <span className="block text-[10px] text-gray-400">Zonas de An&aacute;lisis de Transporte &mdash; transport analysis zones</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onFiltersChange(DEFAULT_ZAT_FILTERS)}
            className="text-xs text-walksafe-green hover:text-walksafe-green-dark font-medium"
          >
            Reset
          </button>
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400"
              aria-label="Collapse sidebar"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto sidebar-scroll">
        {/* Search */}
        <div className="px-4 py-3 border-b border-gray-100">
          <input
            type="text"
            value={filters.searchQuery}
            onChange={(e) => update("searchQuery", e.target.value)}
            placeholder="Search by ZAT number…"
            className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-walksafe-green/30 focus:border-walksafe-green"
          />
        </div>

        {/* Cluster profile */}
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Zone profile
          </h3>
          <div className="space-y-1.5">
            {CLUSTER_ORDER.map((c) => (
              <button
                key={c}
                onClick={() => toggleCluster(c)}
                className={`w-full flex items-start gap-2 px-2 py-1.5 rounded-lg border text-left transition-colors ${
                  filters.clusters.includes(c)
                    ? "border-walksafe-green bg-walksafe-green/5"
                    : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                <span
                  className="w-3 h-3 rounded-sm shrink-0 mt-0.5 border border-black/10"
                  style={{ backgroundColor: CLUSTER_COLORS[c] }}
                />
                <span className="min-w-0 flex-1">
                  <span className="text-[11px] font-medium text-walksafe-text block">
                    Profile {c}
                    {c === 4 && (
                      <span className="text-walksafe-green"> · reference</span>
                    )}
                  </span>
                  <span className="text-[10px] text-gray-500 block leading-tight">
                    {CLUSTER_LABELS[c]}
                  </span>
                </span>
                <span className="text-[10px] tabular-nums text-gray-400 shrink-0">
                  {(clusterCounts[String(c)] ?? 0).toLocaleString()}
                </span>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2 leading-snug">
            Ordered by built-environment intensity. Profile 4 is the model&rsquo;s
            reference category.
          </p>
        </div>

        {/* SES */}
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            {SES_LABEL} (socioeconomic stratum)
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {SES_CATEGORIES.map((s) => (
              <FilterChip
                key={s}
                label={String(s)}
                active={filters.sesCategories.includes(s)}
                onClick={() => toggleSes(s)}
              />
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2 leading-snug">
            Shown unordered on purpose — the socioeconomic gradient is not
            monotonic; risk peaks at stratum 2.
          </p>
        </div>

        {/* No-data */}
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Coverage
          </h3>
          <FilterChip
            label="Show zones with no data"
            active={filters.showNoData}
            onClick={() => update("showNoData", !filters.showNoData)}
          />
          <p className="text-[10px] text-gray-400 mt-2 leading-snug">
            Applies to whichever variable the map is showing. Within Bogot&aacute;
            D.C., 39 zones have no cluster profile, 96 no crash data and 28 no
            population.
          </p>
        </div>

        {/* Priority list */}
        <div className="px-4 py-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Highest casualty rate
          </h3>
          {topZones.length === 0 ? (
            <p className="text-[11px] text-gray-400">No zones match the filters.</p>
          ) : (
            <div className="space-y-0.5">
              {topZones.slice(0, 15).map((f, i) => {
                const p = f.properties;
                return (
                  <button
                    key={p.unit_id}
                    onClick={() => onSelectUnit(p.unit_id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 text-left"
                  >
                    <span className="text-[10px] text-gray-400 w-4 shrink-0 tabular-nums">
                      {i + 1}
                    </span>
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0 border border-black/10"
                      style={{
                        backgroundColor: p.clus ? CLUSTER_COLORS[p.clus] : "#D8D5CE",
                      }}
                    />
                    <span className="text-[11px] text-walksafe-text truncate flex-1">
                      {p.unit_name}
                    </span>
                    <span className="text-[10px] text-gray-500 tabular-nums shrink-0">
                      {p.casualties_per_10k_trips?.toLocaleString(undefined, {
                        maximumFractionDigits: 1,
                      })}
                      /10k trips
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-2 leading-snug">
            Per 10,000 walking and public-transport trips to the zone in the
            2019 mobility survey, a one-day travel diary of a representative
            sample from every ZAT &mdash; the exposure offset of the published
            ZAT models.
            Ranked among the 721 zones with at least 5,000 trips; below that
            floor one or two crashes swing the rate. The map colours every zone.
            Ecological.
          </p>
        </div>
      </div>

      {/* Standing caveat */}
      {caveat && (
        <div className="px-4 py-3 border-t border-gray-100 bg-amber-50 shrink-0">
          <p className="text-[10px] text-amber-900 leading-snug">{caveat}</p>
        </div>
      )}
    </aside>
  );
}
