/**
 * Filtering, in both forms the dashboard needs.
 *
 * The map filters GPU-side over the full collection via `setFilter`, while the
 * page runs a JS predicate over the same data for counts and the sidebar list.
 * Those two used to live in different files and had already drifted. They sit
 * together here so a change to one is visibly a change to the other.
 *
 * The two forms are NOT symmetric, and the asymmetry is the whole reason this
 * module has comments:
 *
 *   - In a MapLibre expression, `["has", k]` is `k in properties`, which is
 *     TRUE for a key whose value is null, and `["to-number", ["get", k], f]`
 *     short-circuits null to 0 without reaching the fallback `f`. Neither can
 *     detect missing data. Gate on the always-present boolean flags instead.
 *   - In the JS predicate, reading the in-memory collection, the same field is
 *     genuinely `null` and a plain `!== null` works.
 */

import type maplibregl from "maplibre-gl";
import type {
  FilterState,
  UnitFeature,
  ZatFilterState,
  CrashFilterState,
  SegmentFilterState,
  IntersectionFeature,
  SegmentFeature,
  ZatFeature,
} from "./types";
import {
  assertNever,
  isIntersectionFeature,
  isSegmentFeature,
  isZatFeature,
} from "./types";

/** The single "match nothing" sentinel. Both id fields are strictly positive. */
export function matchNothing(idField: string): maplibregl.FilterSpecification {
  return ["==", ["get", idField], -1] as maplibregl.FilterSpecification;
}

export function matchId(idField: string, id: number): maplibregl.FilterSpecification {
  return ["==", ["get", idField], id] as maplibregl.FilterSpecification;
}

/** Nullable numeric field, coalesced to 0 for comparison. */
const num = (field: string): maplibregl.ExpressionSpecification => [
  "coalesce",
  ["to-number", ["get", field], 0],
  0,
];

// ---------------------------------------------------------------------------
// Philadelphia — crash filters
// ---------------------------------------------------------------------------

function buildCrashFilter(
  filters: CrashFilterState,
  searchIds: number[] | null
): maplibregl.FilterSpecification {
  const conds: unknown[] = ["all"];

  if (filters.riskTiers.length > 0 && filters.riskTiers.length < 4) {
    conds.push(["in", ["get", "risk_tier"], ["literal", filters.riskTiers]]);
  } else if (filters.riskTiers.length === 0) {
    return matchNothing("node_id");
  }

  conds.push([">=", num("eb_ksi"), filters.riskScoreRange[0]]);
  conds.push(["<=", num("eb_ksi"), filters.riskScoreRange[1]]);

  if (filters.stopTypes.length > 0) {
    conds.push(["in", ["get", "stoptype"], ["literal", filters.stopTypes]]);
  }
  if (filters.onHin !== null) {
    conds.push(["==", ["get", "on_hin"], filters.onHin]);
  }
  if (filters.hasCamera !== null) {
    conds.push([filters.hasCamera ? ">" : "==", num("any_camera"), 0]);
  }
  if (filters.nearSchool !== null) {
    conds.push([filters.nearSchool ? ">" : "==", num("schools_200m"), 0]);
  }
  if (filters.nearPark !== null) {
    conds.push([filters.nearPark ? ">" : "==", num("parks_200m"), 0]);
  }
  if (filters.top50Only) {
    conds.push(["==", ["get", "top50"], true]);
  }
  // Substring search has no MapLibre operator — match precomputed ids instead.
  if (searchIds !== null) {
    conds.push(["in", ["get", "node_id"], ["literal", searchIds]]);
  }

  return conds as maplibregl.FilterSpecification;
}

function crashPredicate(
  p: IntersectionFeature["properties"],
  f: CrashFilterState
): boolean {
  if (f.riskTiers.length > 0 && !f.riskTiers.includes(p.risk_tier)) return false;
  if (p.eb_ksi < f.riskScoreRange[0] || p.eb_ksi > f.riskScoreRange[1]) return false;
  if (f.stopTypes.length > 0 && !f.stopTypes.includes(p.stoptype)) return false;
  if (f.onHin !== null && p.on_hin !== f.onHin) return false;
  if (f.hasCamera !== null && p.any_camera > 0 !== f.hasCamera) return false;
  if (f.nearSchool !== null && p.schools_200m > 0 !== f.nearSchool) return false;
  if (f.nearPark !== null && p.parks_200m > 0 !== f.nearPark) return false;
  if (f.top50Only && !p.top50) return false;
  if (f.searchQuery) {
    // Optional-chained: int_name has been null in the wild and this threw.
    const q = f.searchQuery.toLowerCase();
    if (!p.int_name?.toLowerCase().includes(q)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Bogotá — ZAT filters
// ---------------------------------------------------------------------------

function buildZatFilter(
  filters: ZatFilterState,
  gateField: string | undefined,
  searchIds: number[] | null
): maplibregl.FilterSpecification {
  const conds: unknown[] = ["all"];

  // Cluster. A zone with no cluster is not "cluster 0" — it is excluded from a
  // cluster selection entirely, and only reappears via the no-data toggle.
  if (filters.clusters.length > 0) {
    conds.push([
      "all",
      ["==", ["get", "has_features"], true],
      ["in", ["to-number", ["get", "clus"], 0], ["literal", filters.clusters]],
    ]);
  }

  if (filters.sesCategories.length > 0) {
    conds.push([
      "all",
      ["==", ["get", "has_covariates"], true],
      ["in", ["to-number", ["get", "ses_cat"], 0], ["literal", filters.sesCategories]],
    ]);
  }

  // Hiding no-data zones is per layer mode: 301 zones lack a cluster, 358 lack
  // crash data, 290 lack population. `has_data` fits none of them.
  if (!filters.showNoData && gateField) {
    conds.push(["==", ["get", gateField], true]);
  }

  if (searchIds !== null) {
    conds.push(["in", ["get", "unit_id"], ["literal", searchIds]]);
  }

  return conds as maplibregl.FilterSpecification;
}

function zatPredicate(
  p: ZatFeature["properties"],
  f: ZatFilterState,
  gateField: string | undefined
): boolean {
  if (f.clusters.length > 0) {
    if (!p.has_features || p.clus === null || !f.clusters.includes(p.clus)) return false;
  }
  if (f.sesCategories.length > 0) {
    if (!p.has_covariates || p.ses_cat === null || !f.sesCategories.includes(p.ses_cat)) {
      return false;
    }
  }
  if (!f.showNoData && gateField) {
    if (!(p as unknown as Record<string, boolean>)[gateField]) return false;
  }
  if (f.searchQuery) {
    const q = f.searchQuery.trim().toLowerCase();
    const name = p.unit_name?.toLowerCase() ?? "";
    if (!name.includes(q) && String(p.unit_id) !== q) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Philadelphia — street segments
// ---------------------------------------------------------------------------

function buildSegmentFilter(
  filters: SegmentFilterState,
  gateField: string | undefined,
  searchIds: number[] | null
): maplibregl.FilterSpecification {
  const conds: unknown[] = ["all"];

  if (filters.classes.length > 0 && filters.classes.length < 4) {
    conds.push(["in", ["get", "class"], ["literal", filters.classes]]);
  }
  if (filters.tiers.length > 0 && filters.tiers.length < 4) {
    conds.push(["in", ["get", "tier"], ["literal", filters.tiers]]);
  }
  // Booleans are the only reliable gate — zero/null values are omitted from the
  // payload entirely, so `has`/`to-number` cannot distinguish absent from 0.
  if (filters.onewayOnly) conds.push(["==", ["get", "oneway"], true]);
  if (filters.measuredAadtOnly) conds.push(["==", ["get", "has_aadt"], true]);
  if (filters.withCrashesOnly) conds.push(["==", ["get", "has_crashes"], true]);
  // Deliberately NOT gated on the active layer mode's gateField. The paint
  // expression already draws units outside that variable in grey at low
  // opacity, and the legend counts them — filtering them out as well would
  // contradict a legend entry that promises they are on the map. The user
  // narrows explicitly through the chips above instead.

  if (searchIds !== null) {
    conds.push(["in", ["get", "seg_id"], ["literal", searchIds]]);
  }
  return conds as maplibregl.FilterSpecification;
}

function segmentPredicate(
  p: SegmentFeature["properties"],
  f: SegmentFilterState
): boolean {
  if (f.classes.length > 0 && !f.classes.includes(p.class)) return false;
  // Mirror buildSegmentFilter's `< 4` guard exactly. Without it the two forms
  // disagree: the GPU filter skips the clause when every tier is selected and
  // shows all 39,761 segments, while this predicate drops the 10,343 that have
  // no tier at all (outside the model), so the sidebar count contradicts the
  // map. Segments outside the model are meant to render, greyed.
  if (f.tiers.length > 0 && f.tiers.length < 4) {
    if (!p.tier || !f.tiers.includes(p.tier)) return false;
  }
  if (f.onewayOnly && !p.oneway) return false;
  if (f.measuredAadtOnly && !p.has_aadt) return false;
  if (f.withCrashesOnly && !p.has_crashes) return false;
  // No gateField clause — see buildSegmentFilter.
  if (f.searchQuery) {
    const q = f.searchQuery.trim().toLowerCase();
    if (!p.unit_name?.toLowerCase().includes(q) && String(p.seg_id) !== q) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Entry points
//
// Both dispatch exhaustively on `filters.kind` and end in assertNever, so a new
// analysis unit is a compile error rather than a silently-empty map.
// ---------------------------------------------------------------------------

export function buildMapFilter(
  filters: FilterState,
  searchIds: number[] | null,
  gateField?: string
): maplibregl.FilterSpecification {
  switch (filters.kind) {
    case "philadelphia-crash":
      return buildCrashFilter(filters, searchIds);
    case "philadelphia-segment":
      return buildSegmentFilter(filters, gateField, searchIds);
    case "bogota-zat":
      return buildZatFilter(filters, gateField, searchIds);
    default:
      return assertNever(filters, "filter kind");
  }
}

export function matchesFilters(
  feature: UnitFeature,
  filters: FilterState,
  gateField?: string
): boolean {
  switch (filters.kind) {
    case "philadelphia-crash":
      // Guard, never cast. A cast would accept a segment here and read
      // risk_tier/eb_ksi off it as undefined — every comparison false, so the
      // sidebar would silently report zero matches instead of failing.
      return isIntersectionFeature(feature)
        ? crashPredicate(feature.properties, filters)
        : false;
    case "philadelphia-segment":
      return isSegmentFeature(feature)
        ? segmentPredicate(feature.properties, filters)
        : false;
    case "bogota-zat":
      return isZatFeature(feature)
        ? zatPredicate(feature.properties, filters, gateField)
        : false;
    default:
      return assertNever(filters, "filter kind");
  }
}

/**
 * Ids matching a free-text query, or null when no query is active.
 * Kept next to the filters because `buildMapFilter` consumes its output.
 */
export function searchMatchIds(
  features: UnitFeature[],
  query: string
): number[] | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const ids: number[] = [];
  for (const f of features) {
    if (isZatFeature(f)) {
      const p = f.properties;
      if (p.unit_name?.toLowerCase().includes(q) || String(p.unit_id) === q) {
        ids.push(p.unit_id);
      }
    } else if (isSegmentFeature(f)) {
      const p = f.properties;
      if (p.unit_name?.toLowerCase().includes(q) || String(p.seg_id) === q) {
        ids.push(p.seg_id);
      }
    } else if (isIntersectionFeature(f)) {
      const p = f.properties;
      if (p.int_name?.toLowerCase().includes(q)) ids.push(p.node_id);
    }
  }
  return ids;
}
