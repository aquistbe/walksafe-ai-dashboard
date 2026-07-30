"use client";

import { useState, useCallback } from "react";
import type { FilterState, RiskTier, StopType, IntersectionFeature } from "@/lib/types";
import {
  DEFAULT_FILTERS,
  RISK_TIERS,
  RISK_TIER_COLORS,
  RISK_TIER_LABELS,
} from "@/lib/constants";
import FilterChip from "./FilterChip";
import RiskBadge from "./RiskBadge";

interface SidebarProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  totalCount: number;
  filteredCount: number;
  topIntersections: IntersectionFeature[];
  onSelectIntersection: (nodeId: number) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function Sidebar({
  filters,
  onFiltersChange,
  totalCount,
  filteredCount,
  topIntersections,
  onSelectIntersection,
  collapsed = false,
  onToggleCollapse,
}: SidebarProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>("risk");

  const updateFilter = useCallback(
    <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
      onFiltersChange({ ...filters, [key]: value });
    },
    [filters, onFiltersChange]
  );

  const toggleRiskTier = useCallback(
    (tier: RiskTier) => {
      const current = filters.riskTiers;
      const updated = current.includes(tier)
        ? current.filter((t) => t !== tier)
        : [...current, tier];
      updateFilter("riskTiers", updated);
    },
    [filters.riskTiers, updateFilter]
  );

  const toggleStopType = useCallback(
    (type: StopType) => {
      const current = filters.stopTypes;
      const updated = current.includes(type)
        ? current.filter((t) => t !== type)
        : [...current, type];
      updateFilter("stopTypes", updated);
    },
    [filters.stopTypes, updateFilter]
  );

  const resetFilters = useCallback(() => {
    onFiltersChange(DEFAULT_FILTERS);
  }, [onFiltersChange]);

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  if (collapsed) {
    return (
      <div className="w-12 bg-white border-r border-gray-200 flex flex-col items-center pt-4">
        <button
          onClick={onToggleCollapse}
          className="p-2 rounded-md hover:bg-gray-100 text-gray-500"
          aria-label="Expand sidebar"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
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
            {filteredCount.toLocaleString()} of{" "}
            {totalCount.toLocaleString()} intersections
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={resetFilters}
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
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Scrollable filter content */}
      <div className="flex-1 overflow-y-auto sidebar-scroll">
        {/* Search */}
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="relative">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search intersections..."
              value={filters.searchQuery}
              onChange={(e) => updateFilter("searchQuery", e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg
                         focus:outline-none focus:ring-2 focus:ring-walksafe-green/30 focus:border-walksafe-green
                         placeholder:text-gray-400"
            />
          </div>
        </div>

        {/* Risk Score Range */}
        <SectionHeader
          title="Risk Score"
          section="risk"
          expanded={expandedSection === "risk"}
          onToggle={toggleSection}
        />
        {expandedSection === "risk" && (
          <div className="px-4 pb-3 space-y-3">
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-2">
                <span>{filters.riskScoreRange[0].toFixed(2)}</span>
                <span>{filters.riskScoreRange[1].toFixed(2)}</span>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-gray-500">Min</label>
                <input
                  type="range"
                  min={0}
                  max={2.2}
                  step={0.01}
                  value={filters.riskScoreRange[0]}
                  onChange={(e) =>
                    updateFilter("riskScoreRange", [
                      parseFloat(e.target.value),
                      filters.riskScoreRange[1],
                    ])
                  }
                  className="w-full"
                />
                <label className="text-xs text-gray-500">Max</label>
                <input
                  type="range"
                  min={0}
                  max={2.2}
                  step={0.01}
                  value={filters.riskScoreRange[1]}
                  onChange={(e) =>
                    updateFilter("riskScoreRange", [
                      filters.riskScoreRange[0],
                      parseFloat(e.target.value),
                    ])
                  }
                  className="w-full"
                />
              </div>
            </div>

            {/* Risk tier chips */}
            <div className="flex flex-wrap gap-1.5">
              {RISK_TIERS.map((tier) => (
                <FilterChip
                  key={tier}
                  label={tier}
                  active={filters.riskTiers.includes(tier)}
                  onClick={() => toggleRiskTier(tier)}
                  color={RISK_TIER_COLORS[tier]}
                />
              ))}
            </div>
          </div>
        )}

        {/* Built Environment */}
        <SectionHeader
          title="Built Environment"
          section="environment"
          expanded={expandedSection === "environment"}
          onToggle={toggleSection}
        />
        {expandedSection === "environment" && (
          <div className="px-4 pb-3">
            <div className="flex flex-wrap gap-1.5">
              <FilterChip
                label="On High Injury Network"
                active={filters.onHin === true}
                onClick={() =>
                  updateFilter("onHin", filters.onHin === true ? null : true)
                }
              />
              <FilterChip
                label="Has Speed Camera"
                active={filters.hasCamera === true}
                onClick={() =>
                  updateFilter(
                    "hasCamera",
                    filters.hasCamera === true ? null : true
                  )
                }
              />
              <FilterChip
                label="Near School"
                active={filters.nearSchool === true}
                onClick={() =>
                  updateFilter(
                    "nearSchool",
                    filters.nearSchool === true ? null : true
                  )
                }
              />
              <FilterChip
                label="Near Park"
                active={filters.nearPark === true}
                onClick={() =>
                  updateFilter(
                    "nearPark",
                    filters.nearPark === true ? null : true
                  )
                }
              />
            </div>

            <div className="mt-3">
              <p className="text-xs text-gray-500 mb-1.5">Intersection Type</p>
              <div className="flex flex-wrap gap-1.5">
                {(["Signalized", "All Way", "Conventional"] as StopType[]).map(
                  (type) => (
                    <FilterChip
                      key={type}
                      label={type}
                      active={filters.stopTypes.includes(type)}
                      onClick={() => toggleStopType(type)}
                    />
                  )
                )}
              </div>
            </div>
          </div>
        )}

        {/* Quick Filters */}
        <SectionHeader
          title="Quick Filters"
          section="quick"
          expanded={expandedSection === "quick"}
          onToggle={toggleSection}
        />
        {expandedSection === "quick" && (
          <div className="px-4 pb-3">
            <div className="flex flex-wrap gap-1.5">
              <FilterChip
                label="Top 50 Priority"
                active={filters.top50Only}
                onClick={() => updateFilter("top50Only", !filters.top50Only)}
              />
            </div>
          </div>
        )}

        {/* Priority Locations */}
        <SectionHeader
          title="Priority Locations"
          section="priority"
          expanded={expandedSection === "priority"}
          onToggle={toggleSection}
        />
        {expandedSection === "priority" && (
          <div className="px-4 pb-3">
            {topIntersections.length === 0 ? (
              <p className="text-xs text-gray-400 italic">Loading...</p>
            ) : (
              <ul className="space-y-1">
                {topIntersections.slice(0, 15).map((feature, i) => {
                  const p = feature.properties;
                  return (
                    <li key={p.node_id}>
                      <button
                        onClick={() => onSelectIntersection(p.node_id)}
                        className="w-full text-left px-2 py-1.5 rounded-md hover:bg-gray-50
                                   transition-colors group"
                      >
                        <div className="flex items-start gap-2">
                          <span className="text-[10px] font-mono text-gray-400 mt-0.5 shrink-0 w-4 text-right">
                            {i + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-gray-800 truncate group-hover:text-walksafe-green">
                              {p.int_name}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <RiskBadge tier={p.risk_tier} size="sm" showLabel={false} />
                              <span className="text-[10px] text-gray-400">
                                {p.ped_ksi} KSI
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Section header sub-component
// ---------------------------------------------------------------------------

function SectionHeader({
  title,
  section,
  expanded,
  onToggle,
}: {
  title: string;
  section: string;
  expanded: boolean;
  onToggle: (section: string) => void;
}) {
  return (
    <button
      onClick={() => onToggle(section)}
      className="w-full flex items-center justify-between px-4 py-2.5 border-b border-gray-100
                 hover:bg-gray-50 transition-colors"
    >
      <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
        {title}
      </span>
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className={`text-gray-400 transition-transform ${
          expanded ? "rotate-180" : ""
        }`}
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}
