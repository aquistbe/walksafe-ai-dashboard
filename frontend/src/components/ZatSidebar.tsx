"use client";

import { useCallback, useMemo } from "react";
import type {
  ZatFilterState,
  ZatCluster,
  SesCategory,
  ZatFeature,
  ZatCollection,
  RrEstimate,
} from "@/lib/types";
import { rrDisplay } from "@/lib/types";
import {
  DEFAULT_ZAT_FILTERS,
  CLUSTER_COLORS,
  CLUSTER_LABELS,
  CLUSTER_ORDER,
  SES_CATEGORIES,
  SES_LABEL,
  MIN_TRIPS_FOR_RANKING,
  TRIP_RATE_BREAKS,
  CASUALTY_DENSITY_RAMP,
  PCT60_BREAKS,
  PCT60_RAMP,
  ZAT_EXCESS_BREAKS,
  ZAT_EXCESS_RAMP,
} from "@/lib/constants";
import FilterChip from "./FilterChip";

/**
 * The sidebar follows the map's layer mode (24 Aug 2026).
 *
 * It used to show one fixed stack — profile cards, estrato chips, and a
 * casualty ranking — whatever the map was colouring, so a reader looking at
 * profiles was handed a crash ranking and a reader looking at crashes was
 * handed the profile scheme. Now the filters stay (they are how a reader
 * looks at one profile or one stratum at a time, which is the only honest
 * way to see a combination the map cannot encode) and the block below them
 * changes with the mode:
 *
 *   cluster            what the profiles mean — the published rate ratios
 *   excess_casualties  the profile × estrato grid of the mapped value, then
 *   casualties         the ranked zones for that value
 *   age60
 *
 * The grid is the answer to "there are too many profile/estrato combinations
 * to show on the map": 24 cells are past what a choropleth can carry, and a
 * 4 × 6 table of medians carries them without asking colour to do it.
 */

interface ZatSidebarProps {
  filters: ZatFilterState;
  onFiltersChange: (filters: ZatFilterState) => void;
  totalCount: number;
  filteredCount: number;
  clusterCounts: Record<string, number>;
  /** Already filtered AND ranked for the active mode by the page. */
  topZones: ZatFeature[];
  /** All filtered zones, for the profile × estrato grid. */
  zones: ZatFeature[];
  layerMode: string;
  metadata: ZatCollection["metadata"] | null;
  onSelectUnit: (id: number) => void;
  selectedId: number | null;
  caveat: string | null;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

/** What each outcome mode maps, ranks and tabulates. One place, not three. */
interface ModeSpec {
  title: string;
  rankTitle: string;
  value: (p: ZatFeature["properties"]) => number | null;
  format: (v: number) => string;
  unit: string;
  breaks: number[];
  ramp: string[];
  foot: string;
}

const MODES: Record<string, ModeSpec> = {
  excess_casualties: {
    title: "Excess casualties by profile and estrato",
    rankTitle: "Most casualties above expectation",
    value: (p) => (p.has_expected ? p.excess_casualties : null),
    // Math.round, not toFixed: a median of −0.3 must print "0", not "-0".
    format: (v) => {
      const r = Math.round(v);
      return r > 0 ? `+${r}` : String(r === 0 ? 0 : r);
    },
    unit: "",
    breaks: ZAT_EXCESS_BREAKS,
    ramp: ZAT_EXCESS_RAMP,
    foot:
      "Observed 2015–2019 casualties minus the offset model's expectation " +
      "for a zone with this profile, covariates and walking + transit trips. " +
      "Positive: more than zones like it. Cells are medians; n in the title " +
      "attribute. 770 zones have an expectation.",
  },
  casualties: {
    title: "Casualty rate by profile and estrato",
    rankTitle: "Highest casualty rate",
    value: (p) =>
      p.has_covariates && (p.walk_pubt ?? 0) >= MIN_TRIPS_FOR_RANKING
        ? p.casualties_per_10k_trips
        : null,
    format: (v) => v.toFixed(1),
    unit: "/10k trips",
    breaks: TRIP_RATE_BREAKS,
    ramp: CASUALTY_DENSITY_RAMP,
    foot:
      "Per 10,000 walking and public-transport trips to the zone in the 2019 " +
      "mobility survey (a one-day travel diary of a representative sample " +
      "from every ZAT). Ranked and tabulated among the 721 zones with at " +
      "least 5,000 trips; below that floor one or two crashes swing the " +
      "rate. The map colours every zone.",
  },
  age60: {
    title: "Share aged 60+ by profile and estrato",
    rankTitle: "Highest share aged 60+",
    value: (p) => (p.has_pop60 ? p.pct60plus : null),
    format: (v) => v.toFixed(1),
    unit: "%",
    breaks: PCT60_BREAKS,
    ramp: PCT60_RAMP,
    foot: "2018 census, ZAT level. Cells are medians over the filtered zones.",
  },
};

function binColor(v: number, breaks: number[], ramp: string[]): string {
  let i = 0;
  while (i < breaks.length && v >= breaks[i]) i++;
  return ramp[i] ?? ramp[ramp.length - 1];
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export default function ZatSidebar({
  filters,
  onFiltersChange,
  totalCount,
  filteredCount,
  clusterCounts,
  topZones,
  zones,
  layerMode,
  metadata,
  onSelectUnit,
  selectedId,
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

  const mode = MODES[layerMode] ?? null;

  /** profile → estrato → { median, n } of the active mode's value. */
  const grid = useMemo(() => {
    if (!mode) return null;
    const cells = new Map<string, number[]>();
    for (const f of zones) {
      const p = f.properties;
      if (p.clus === null || p.ses_cat === null) continue;
      const v = mode.value(p);
      if (v === null || v === undefined) continue;
      const k = `${p.clus}-${p.ses_cat}`;
      const arr = cells.get(k);
      if (arr) arr.push(v);
      else cells.set(k, [v]);
    }
    const out = new Map<string, { median: number; n: number }>();
    cells.forEach((arr, k) => out.set(k, { median: median(arr), n: arr.length }));
    return out;
  }, [zones, mode]);

  const selected = selectedId !== null
    ? zones.find((f) => f.properties.unit_id === selectedId)?.properties ?? null
    : null;

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

        {/* Profile filter. Cards in profile mode (the legend lives here too),
            chips in outcome modes where the profile is a lens, not the subject. */}
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Zone profile
          </h3>
          {mode ? (
            <div className="flex flex-wrap gap-1.5">
              {CLUSTER_ORDER.map((c) => (
                <FilterChip
                  key={c}
                  label={`Profile ${c}`}
                  color={CLUSTER_COLORS[c]}
                  count={clusterCounts[String(c)] ?? 0}
                  active={filters.clusters.includes(c)}
                  onClick={() => toggleCluster(c)}
                />
              ))}
            </div>
          ) : (
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
          )}
          {!mode && (
            <p className="text-[10px] text-gray-400 mt-2 leading-snug">
              Ordered by built-environment intensity. Profile 4 is the model&rsquo;s
              reference category.
            </p>
          )}
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
            D.C., 39 zones have no cluster profile, 96 no crash data, 28 no
            population and 109 no model expectation.
          </p>
        </div>

        {/* Mode block */}
        {!mode ? (
          <RrBlock metadata={metadata} />
        ) : (
          <>
            {/* Profile × estrato grid */}
            <div className="px-4 py-3 border-b border-gray-100">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                {mode.title}
              </h3>
              <table className="w-full text-[10px] tabular-nums border-separate border-spacing-0.5">
                <thead>
                  <tr>
                    <th className="text-left font-medium text-gray-400 pr-1">Profile</th>
                    {SES_CATEGORIES.map((s) => (
                      <th key={s} className="font-medium text-gray-400 text-center">{s}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CLUSTER_ORDER.map((c) => (
                    <tr key={c}>
                      <td className="pr-1">
                        <span className="inline-flex items-center gap-1">
                          <span
                            className="w-2 h-2 rounded-sm border border-black/10"
                            style={{ backgroundColor: CLUSTER_COLORS[c] }}
                          />
                          <span className="text-walksafe-text">{c}</span>
                        </span>
                      </td>
                      {SES_CATEGORIES.map((s) => {
                        const cell = grid?.get(`${c}-${s}`);
                        const isSel = selected?.clus === c && selected?.ses_cat === s;
                        if (!cell) {
                          return (
                            <td key={s} className="text-center text-gray-300 bg-gray-50 rounded">
                              &mdash;
                            </td>
                          );
                        }
                        return (
                          <td
                            key={s}
                            title={`Profile ${c}, ${SES_LABEL} ${s}: median ${mode.format(cell.median)}${mode.unit} over ${cell.n} zone${cell.n === 1 ? "" : "s"}`}
                            className={`text-center rounded px-0.5 py-1 text-walksafe-text ${isSel ? "ring-2 ring-walksafe-green" : ""}`}
                            style={{ backgroundColor: binColor(cell.median, mode.breaks, mode.ramp) }}
                          >
                            {mode.format(cell.median)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-gray-400 mt-2 leading-snug">
                Median per cell over the zones passing the filters; hover a
                cell for its n. Columns are estrato 1&ndash;6.
                {selected && selected.clus !== null && selected.ses_cat !== null && (
                  <> Selected zone&rsquo;s cell outlined.</>
                )}
              </p>
            </div>

            {/* Ranked list */}
            <div className="px-4 py-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                {mode.rankTitle}
              </h3>
              {topZones.length === 0 ? (
                <p className="text-[11px] text-gray-400">No zones match the filters.</p>
              ) : (
                <div className="space-y-0.5">
                  {topZones.slice(0, 15).map((f, i) => {
                    const p = f.properties;
                    const v = mode.value(p);
                    return (
                      <button
                        key={p.unit_id}
                        onClick={() => onSelectUnit(p.unit_id)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 text-left ${
                          p.unit_id === selectedId ? "bg-walksafe-green/5" : ""
                        }`}
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
                          {p.ses_cat !== null && (
                            <span className="text-gray-400"> · {SES_LABEL} {p.ses_cat}</span>
                          )}
                        </span>
                        <span className="text-[10px] text-gray-500 tabular-nums shrink-0">
                          {v !== null && v !== undefined ? mode.format(v) : "—"}
                          {mode.unit}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="text-[10px] text-gray-400 mt-2 leading-snug">{mode.foot} Ecological.</p>
            </div>
          </>
        )}
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

/**
 * Profile mode: what the profiles mean. The published rate ratios against
 * the reference profile, injuries and deaths, primary model. This used to
 * be reachable only by clicking a zone; it is the legend for the whole map.
 */
function RrBlock({ metadata }: { metadata: ZatCollection["metadata"] | null }) {
  const rr = metadata?.cluster_rr;
  const models = rr?.models;
  const primary = rr?.primary_model;
  const table = models && primary ? models[primary] : null;
  if (!rr || !table) {
    return (
      <div className="px-4 py-3">
        <p className="text-[11px] text-gray-400">Rate ratios unavailable for this file.</p>
      </div>
    );
  }
  const fmt = (e: RrEstimate | undefined, isRef: boolean) => {
    const d = rrDisplay(e, isRef);
    if (!d) return "—";
    if (d.kind === "reference") return "1 (ref)";
    return `${d.rr.toFixed(2)} (${d.lo.toFixed(2)}–${d.hi.toFixed(2)})`;
  };
  return (
    <div className="px-4 py-3">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
        Rate ratio vs the reference profile
      </h3>
      <table className="w-full text-[10px] tabular-nums">
        <thead>
          <tr className="text-gray-400">
            <th className="text-left font-medium">Profile</th>
            <th className="text-right font-medium">Injuries</th>
            <th className="text-right font-medium">Deaths</th>
          </tr>
        </thead>
        <tbody>
          {CLUSTER_ORDER.map((c) => {
            const isRef = c === rr.reference_cluster;
            return (
              <tr key={c} className="border-t border-gray-100">
                <td className="py-1">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-sm border border-black/10"
                      style={{ backgroundColor: CLUSTER_COLORS[c] }}
                    />
                    <span className="text-walksafe-text">{c}</span>
                  </span>
                </td>
                <td className="py-1 text-right text-walksafe-text">{fmt(table.injury?.[String(c)], isRef)}</td>
                <td className="py-1 text-right text-walksafe-text">{fmt(table.death?.[String(c)], isRef)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-[10px] text-gray-400 mt-2 leading-snug">
        {rr.model_labels?.[primary!] ?? primary}, n = {rr.model_n?.[primary!]?.toLocaleString()} zones,
        95% CI. Negative binomial with walking + transit trips as the offset,
        adjusted for MEANIPM, population density and road composition.
        Reference: profile {rr.reference_cluster}. Switch the map to Excess
        casualties to see where zones depart from what this model expects.
      </p>
    </div>
  );
}
