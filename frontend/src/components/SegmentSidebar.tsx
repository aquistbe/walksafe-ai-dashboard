"use client";

import { useCallback } from "react";
import type { SegmentFilterState, SegmentFeature, RiskTier } from "@/lib/types";
import {
  DEFAULT_SEGMENT_FILTERS,
  SEGMENT_CLASSES,
  RISK_TIERS,
  RISK_TIER_COLORS,
} from "@/lib/constants";
import FilterChip from "./FilterChip";

interface SegmentSidebarProps {
  filters: SegmentFilterState;
  onFiltersChange: (f: SegmentFilterState) => void;
  totalCount: number;
  filteredCount: number;
  topSegments: SegmentFeature[];
  onSelectUnit: (id: number) => void;
  caveat: string | null;
  /** Bogotá has no traffic-volume attribute, so the chip is hidden there. */
  showAadtFilter?: boolean;
  outcomeLabel?: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function SegmentSidebar({
  filters,
  onFiltersChange,
  totalCount,
  filteredCount,
  topSegments,
  onSelectUnit,
  caveat,
  showAadtFilter = true,
  outcomeLabel = "KSI",
  collapsed = false,
  onToggleCollapse,
}: SegmentSidebarProps) {
  const update = useCallback(
    <K extends keyof SegmentFilterState>(key: K, value: SegmentFilterState[K]) => {
      onFiltersChange({ ...filters, [key]: value });
    },
    [filters, onFiltersChange]
  );

  const toggleClass = useCallback(
    (c: number) => {
      const cur = filters.classes;
      update("classes", cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]);
    },
    [filters.classes, update]
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
            {filteredCount.toLocaleString()} of {totalCount.toLocaleString()} segments
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onFiltersChange(DEFAULT_SEGMENT_FILTERS)}
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
            placeholder="Search street name…"
            className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-walksafe-green/30 focus:border-walksafe-green"
          />
        </div>

        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Road class
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {SEGMENT_CLASSES.map((c) => (
              <FilterChip
                key={c.value}
                label={c.label}
                active={filters.classes.includes(c.value)}
                onClick={() => toggleClass(c.value)}
              />
            ))}
          </div>
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
            Quantiles of expected KSI per mile. These are the segment
            model&rsquo;s own cut-points, not the intersection tiers.
          </p>
        </div>

        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Restrict to
          </h3>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip
              label="One-way"
              active={filters.onewayOnly}
              onClick={() => update("onewayOnly", !filters.onewayOnly)}
            />
            <FilterChip
              label="Has crashes"
              active={filters.withCrashesOnly}
              onClick={() => update("withCrashesOnly", !filters.withCrashesOnly)}
            />
            {showAadtFilter && (
              <FilterChip
                label="Measured traffic"
                active={filters.measuredAadtOnly}
                onClick={() => update("measuredAadtOnly", !filters.measuredAadtOnly)}
              />
            )}
          </div>
          {showAadtFilter && (
            <p className="text-[10px] text-gray-400 mt-2 leading-snug">
              Only a third of segments carry a genuine traffic count — the rest
              hold PennDOT&rsquo;s nominal 300 veh/day placeholder.
            </p>
          )}
        </div>

        <div className="px-4 py-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Most {outcomeLabel}
          </h3>
          {topSegments.length === 0 ? (
            <p className="text-[11px] text-gray-400">No segments match the filters.</p>
          ) : (
            <div className="space-y-0.5">
              {topSegments.slice(0, 15).map((f, i) => {
                const p = f.properties;
                return (
                  <button
                    key={p.seg_id}
                    onClick={() => onSelectUnit(p.seg_id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 text-left"
                  >
                    <span className="text-[10px] text-gray-400 w-4 shrink-0 tabular-nums">
                      {i + 1}
                    </span>
                    <span className="text-[11px] text-walksafe-text truncate flex-1">
                      {p.unit_name}
                    </span>
                    <span className="text-[10px] text-walksafe-red font-semibold tabular-nums shrink-0">
                      {p.ped_ksi_seg ?? p.ped_crashes_seg ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-2 leading-snug">
            Observed {outcomeLabel}.
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
