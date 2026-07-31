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
  IntersectionFeature,
  ZatFeature,
} from "./types";
import { isZatFeature } from "./types";

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
// Entry points
// ---------------------------------------------------------------------------

export function buildMapFilter(
  filters: FilterState,
  searchIds: number[] | null,
  gateField?: string
): maplibregl.FilterSpecification {
  return filters.kind === "bogota-zat"
    ? buildZatFilter(filters, gateField, searchIds)
    : buildCrashFilter(filters, searchIds);
}

export function matchesFilters(
  feature: UnitFeature,
  filters: FilterState,
  gateField?: string
): boolean {
  if (filters.kind === "bogota-zat") {
    return isZatFeature(feature)
      ? zatPredicate(feature.properties, filters, gateField)
      : false;
  }
  return isZatFeature(feature)
    ? false
    : crashPredicate((feature as IntersectionFeature).properties, filters);
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
    } else {
      const p = (f as IntersectionFeature).properties;
      if (p.int_name?.toLowerCase().includes(q)) ids.push(p.node_id);
    }
  }
  return ids;
}
