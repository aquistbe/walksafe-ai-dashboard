"use client";

/**
 * Census-tract sidebar.
 *
 * The priority list ranks on OBSERVED KSI rather than on the model. At this
 * unit that is defensible in a way it is not at the segment: 84% of tracts
 * carry at least one crash, so the count is a real measurement rather than a
 * mostly-zero column. The empirical Bayes estimate is shown beside it.
 */

import { useCallback } from "react";
import type { TractFilterState, TractFeature, RiskTier } from "@/lib/types";
import type { PolygonDatasetConfig } from "@/lib/cities";
import {
  DEFAULT_TRACT_FILTERS,
  RISK_TIERS,
  RISK_TIER_COLORS,
} from "@/lib/constants";
import FilterChip from "./FilterChip";

interface TractSidebarProps {
  filters: TractFilterState;
  onFiltersChange: (f: TractFilterState) => void;
  totalCount: number;
  filteredCount: number;
  topTracts: TractFeature[];
  onSelectUnit: (id: number) => void;
  caveat: string | null;
  /** The whole dataset, so no label falls back to another layer's vocabulary. */
  dataset: PolygonDatasetConfig;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function TractSidebar({
  filters,
  onFiltersChange,
  totalCount,
  filteredCount,
  topTracts,
  onSelectUnit,
  caveat,
  dataset,
  collapsed = false,
  onToggleCollapse,
}: TractSidebarProps) {
  const { outcomeLabel, outcomeLabelShort, distanceUnitLong } = dataset.measure;

  const update = useCallback(
    <K extends keyof TractFilterState>(key: K, value: TractFilterState[K]) => {
      onFiltersChange({ ...filters, [key]: value });
    },
    [filters, onFiltersChange]
  );

  const toggleTier = useCallback(
    (t: RiskTier) => {
      const cur = filters.tiers;
      update("tiers", cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]);
    },
    [filters.tiers, update]
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
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
        <div>
          <h2 className="font-semibold text-sm text-walksafe-text">Filters</h2>
          <p className="text-xs text-walksafe-text-muted mt-0.5">
            {filteredCount.toLocaleString()} of {totalCount.toLocaleString()} tracts
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onFiltersChange(DEFAULT_TRACT_FILTERS)}
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
        <div className="px-4 py-3 border-b border-gray-100">
          <input
            type="text"
            value={filters.searchQuery}
            onChange={(e) => update("searchQuery", e.target.value)}
            placeholder="Search tract name or GEOID…"
            className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-walksafe-green/30 focus:border-walksafe-green"
          />
        </div>

        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Risk tier
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {RISK_TIERS.map((t) => (
              <FilterChip
                key={t}
                label={t}
                color={RISK_TIER_COLORS[t]}
                active={filters.tiers.includes(t)}
                onClick={() => toggleTier(t)}
              />
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2 leading-snug">
            Quantiles of expected {outcomeLabelShort} per {distanceUnitLong}.
            This tract model&rsquo;s own cut-points — not the intersection or
            segment thresholds.
          </p>
        </div>

        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Restrict to
          </h3>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip
              label="Has crashes"
              active={filters.withCrashesOnly}
              onClick={() => update("withCrashesOnly", !filters.withCrashesOnly)}
            />
            <FilterChip
              label="Reliable ACS only"
              active={filters.reliableAcsOnly}
              onClick={() => update("reliableAcsOnly", !filters.reliableAcsOnly)}
            />
          </div>
          <p className="text-[10px] text-gray-400 mt-2 leading-snug">
            190 of 408 tracts have a coefficient of variation above 30% on the
            poverty share — the Census threshold for an unreliable estimate.
            Turning this on shows how much of the equity map is carried by
            tracts whose value cannot order them against their neighbours.
          </p>
        </div>

        <div className="px-4 py-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Most {outcomeLabelShort}
          </h3>
          {topTracts.length === 0 ? (
            <p className="text-[11px] text-gray-400">No tracts match the filters.</p>
          ) : (
            <div className="space-y-0.5">
              {topTracts.slice(0, 15).map((f, i) => {
                const p = f.properties;
                return (
                  <button
                    key={p.tract_id}
                    onClick={() => onSelectUnit(p.tract_id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 text-left"
                  >
                    <span className="text-[10px] text-gray-400 w-4 shrink-0 tabular-nums">
                      {i + 1}
                    </span>
                    <span className="text-[11px] text-walksafe-text truncate flex-1">
                      {p.unit_name}
                    </span>
                    <span className="text-[10px] text-gray-400 tabular-nums shrink-0">
                      {(p.eb_per_road_mi ?? 0).toFixed(2)}/mi
                    </span>
                    <span className="text-[10px] text-walksafe-red font-semibold tabular-nums shrink-0 w-6 text-right">
                      {p.ped_ksi}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-2 leading-snug">
            Observed {outcomeLabel}, {dataset.measure.crashWindow} — junction and
            mid-block together. The middle column is the empirical Bayes
            estimate per road mile.
          </p>
        </div>
      </div>

      {caveat && (
        <div className="px-4 py-3 border-t border-gray-100 bg-amber-50 shrink-0">
          <p className="text-[10px] text-amber-900 leading-snug">{caveat}</p>
        </div>
      )}
    </aside>
  );
}
