/** Core data types for the WalkSafe-AI dashboard. */

export type RiskTier = "Critical" | "High" | "Moderate" | "Low";

/** Trend direction. The data pipeline emits "flat"; "same" is an alias. */
export type TrendDirection = "higher" | "lower" | "flat" | "same";

export type StopType = "Signalized" | "All Way" | "Conventional";

export interface IntersectionProperties {
  node_id: number;
  int_name: string;
  stoptype: StopType;

  // Crash counts
  ped_ksi: number;
  ped_any: number;
  ped_deaths: number;
  ped_susp_serious: number;
  ped_ksi_persons: number;
  ped_crashes: number;

  // Traffic volume
  aadt: number | null;
  aadt_measured: number;

  // Context
  pop_800m: number | null;
  parks_200m: number;
  schools_200m: number;

  // High Injury Network
  on_hin: boolean;
  hin_dist_m: number;

  // Risk model
  mev: number;
  ksi_per_mev: number;
  rate_reliable: boolean;
  mu_spf: number;
  eb_ksi: number;

  // Rankings
  rank_raw: number;
  rank_rate: number;
  rank_eb: number;
  rank_mean: number;
  risk_tier: RiskTier;
  top50: boolean;
  pilot_candidate: boolean;

  // Trends — only populated for the enriched top-50 set; null elsewhere.
  ksi_1519: number | null;
  ksi_2024: number | null;
  trend_ksi: TrendDirection | null;
  pedany_1519: number | null;
  pedany_2024: number | null;
  trend_pedany: TrendDirection | null;

  // Speed cameras
  any_camera: number;
  camera_note: string;

  // Road characteristics
  oneway_any: number;
  min_class: number;

  // Recommendations
  nacto_recs: string;

  // ---------------------------------------------------------------
  // Imagery scoring (scoring/ pipeline). Present only for
  // intersections that have been scored; absent everywhere else.
  //
  // These come from the BLIND prompt — the scorer never saw crash
  // data — so img_score can be compared against eb_ksi honestly.
  // ---------------------------------------------------------------
  img_status?: "OK" | "ZERO_RESULTS" | "NO_RESULT" | "UNKNOWN";
  /** 0 (hostile) to 100 (protected), built environment only. */
  img_score?: number | null;
  /** SD across headings — the measurement-reliability estimate. */
  img_score_sd?: number | null;
  img_confidence?: number | null;
  img_headings?: number | null;
  img_date?: string | null;
  img_pano?: string | null;
  img_model?: string | null;
  img_prompt_version?: string | null;
  img_mock?: boolean;
  n_hazards?: number;
  n_interventions?: number;

  // Headline detected features (true if any heading saw it)
  f_sidewalk_present?: boolean | null;
  f_sidewalk_present_prop?: number | null;
  f_crosswalk_marked?: boolean | null;
  f_crosswalk_marked_prop?: number | null;
  f_curb_ramp?: boolean | null;
  f_curb_ramp_prop?: number | null;
  f_refuge_island?: boolean | null;
  f_refuge_island_prop?: number | null;
  f_pedestrian_signal?: boolean | null;
  f_pedestrian_signal_prop?: number | null;
  f_street_lighting?: boolean | null;
  f_street_lighting_prop?: number | null;
  f_visual_obstruction?: boolean | null;
  f_visual_obstruction_prop?: number | null;
  f_slip_lane?: boolean | null;
  f_slip_lane_prop?: number | null;
  f_crossing_distance?: string | null;
  f_through_lanes?: string | null;
}

/** Headline features rendered in the InfoPanel, with display labels. */
export const IMAGERY_FEATURE_LABELS: {
  key: keyof IntersectionProperties;
  label: string;
  /** true when presence is protective, false when presence is a hazard */
  protective: boolean;
}[] = [
  { key: "f_sidewalk_present", label: "Sidewalk", protective: true },
  { key: "f_crosswalk_marked", label: "Marked crosswalk", protective: true },
  { key: "f_curb_ramp", label: "Curb ramp", protective: true },
  { key: "f_refuge_island", label: "Refuge island", protective: true },
  { key: "f_pedestrian_signal", label: "Ped signal", protective: true },
  { key: "f_street_lighting", label: "Street lighting", protective: true },
  { key: "f_visual_obstruction", label: "Blocked sight lines", protective: false },
  { key: "f_slip_lane", label: "Slip lane", protective: false },
];

export interface IntersectionFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number]; // [lng, lat]
  };
  properties: IntersectionProperties;
}

export interface IntersectionCollection {
  type: "FeatureCollection";
  metadata: {
    name: string;
    description: string;
    source: string;
    date_range: string;
    coordinate_system: string;
    generated: string;
    risk_tier_thresholds: Record<RiskTier, string>;
  };
  features: IntersectionFeature[];
}

export interface SummaryData {
  generated: string;
  data_source: string;
  date_range: {
    start: number;
    end: number;
    years: number;
  };
  total_intersections: number;
  intersections_with_ksi: number;
  total_ped_ksi_crashes: number;
  total_ped_deaths: number;
  total_ped_crashes: number;
  risk_tiers: Record<RiskTier, number>;
  risk_tier_thresholds: Record<RiskTier, string>;
  eb_ksi_stats: {
    mean: number;
    std: number;
    min: number;
    max: number;
    percentiles: Record<string, number>;
  };
  stoptype_breakdown: Record<StopType, number>;
  hin_breakdown: {
    on_hin: number;
    off_hin: number;
  };
  top50_summary: {
    count: number;
    trend_ksi_higher: number;
    trend_ksi_lower: number;
    trend_ksi_same: number;
    with_speed_camera: number;
  };
  pilot_candidates: {
    count: number;
    sites: string[];
  };
}

// ===========================================================================
// Bogotá — ZAT (Zona de Análisis de Transporte) polygons
// ===========================================================================

export type ZatCluster = 1 | 2 | 3 | 4;
export type SesCategory = 1 | 2 | 3 | 4 | 5 | 6;
export type ModelSpecId = "replication" | "plus_pct60";
export type CrashOutcome = "injury" | "death";

/**
 * A fitted relative risk. `lo`/`hi`/`p` are null EXACTLY when this is the
 * reference cluster, which has RR 1.00 by construction and no interval.
 */
export interface RrEstimate {
  rr: number;
  lo: number | null;
  hi: number | null;
  p: number | null;
  n: number;
}

export interface ModelSpecEstimates {
  n: number;
  injury: RrEstimate | null;
  death: RrEstimate | null;
}

export interface ZatRelativeRisk {
  reference_cluster: ZatCluster;
  is_reference: boolean;
  primary_model: ModelSpecId;
  secondary_model: ModelSpecId;
  replication: ModelSpecEstimates;
  plus_pct60: ModelSpecEstimates;
}

export const CANVAS_FEATURE_KEYS = [
  "sign_traffic", "traffic_light", "sign_crossing", "pedestrian_light",
  "sign_stop", "sign_yield", "sign_school_zone", "sidewalk", "crosswalk",
  "lane_marking", "lane_bike", "lane_bus", "roundabout", "curb", "bollards",
  "median", "median_barrier", "speed_bump", "trees", "bus_stop",
  "street_lights", "kiosks", "parked_vehicles", "sidewalk_obstruction",
  "lane_parking", "brt_station", "potholes",
] as const;
export type CanvasFeatureKey = (typeof CANVAS_FEATURE_KEYS)[number];

export interface ZatProperties {
  unit_id: number;
  unit_name: string;
  /** Union of all three joins. NOT a gate for any single variable. */
  has_data: boolean;
  area_km2: number;

  /**
   * Per-table presence gates. Always present, never null — the only thing a
   * MapLibre expression can reliably test. See LayerModeConfig.gateField.
   */
  has_features: boolean;   // 840 zones — gates clus, rr
  has_covariates: boolean; // 783 zones — gates crash counts, ses_cat, rates
  has_pop60: boolean;      // 851 zones — gates the population block

  clus: ZatCluster | null;
  is_reference_cluster: boolean | null;

  ses_cat: SesCategory | null;
  injury: number | null;
  death: number | null;
  /** injury + death. Damage-only crashes are excluded from the build. */
  casualties: number | null;

  walk_pubt: number | null;
  pop_density: number | null;
  pcta_Collector: number | null;
  pcta_Local: number | null;
  pcta_other: number | null;
  MEANIPM: number | null;

  pop_total_2018: number | null;
  pop60plus_2018: number | null;
  pct60plus: number | null;
  n_manzanas: number | null;

  /** NESTED — arrives as a JSON string through map events. Never read it there. */
  features: Record<CanvasFeatureKey, number> | null;
  /** NESTED — same warning. A cluster-level estimate copied onto each zone. */
  rr: ZatRelativeRisk | null;

  /** Area densities. NOT exposure-adjusted; kept for the panel and export. */
  casualties_per_km2: number | null;
  injury_per_km2: number | null;
  death_per_km2: number | null;
  /** Per 10,000 walking + public-transport trips to the zone (`walk_pubt`,
   *  2019 mobility survey: a one-day travel diary of a representative sample
   *  from every ZAT) — the mapped quantity and the published models' offset. */
  casualties_per_10k_trips: number | null;
  injury_per_10k_trips: number | null;
  death_per_10k_trips: number | null;
}

export type PolygonGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export interface ZatFeature {
  type: "Feature";
  geometry: PolygonGeometry;
  properties: ZatProperties;
}

export interface ZatCollection {
  type: "FeatureCollection";
  metadata: {
    name: string;
    city: string;
    unit_type: "polygon";
    unit_label: string;
    description: string;
    caveat: string;
    taxonomy_note: string;
    crash_window: string;
    crash_outcomes: {
      carried: string[];
      casualties_definition: string;
      damage_excluded: boolean;
      damage_note: string;
    };
    geometry_vintage: number;
    coordinate_system: string;
    generated: string;
    join: {
      key: string;
      zones_total: number;
      with_features: number;
      with_covariates: number;
      with_pop60: number;
      with_any_data: number;
      with_no_data: number;
    };
    cluster_rr: {
      primary_model: ModelSpecId;
      secondary_model: ModelSpecId;
      reference_cluster: ZatCluster;
      model_n: Record<ModelSpecId, number>;
      model_labels: Record<ModelSpecId, string>;
      note: string;
      age_note: string;
    };
    canvas_features: string[];
  };
  features: ZatFeature[];
}

// ===========================================================================
// Philadelphia — street segments (mid-block)
// ===========================================================================

export type SegmentRiskTier = RiskTier;

/**
 * Zero and null values are OMITTED from the GeoJSON to keep 39,761 features
 * under a sane payload, so every optional field must be read with `?? 0`. The
 * four gate flags are the exception: always present, always boolean.
 */
export interface SegmentProperties {
  /** NOT `unit_id` — that key means "Bogotá ZAT" to the guards below. */
  seg_id: number;
  unit_name: string;
  corridor_id?: number;
  corridor_n?: number;

  /** Street_Centerline CLASS: 2 arterial, 3 collector, 4 local, 5 minor local. */
  class: number;
  oneway?: boolean;
  divided?: boolean;
  length_mi?: number;
  /** Length outside the 25 m intersection influence zone. The SPF offset. */
  exposure_mi?: number;
  /** Bogotá reports kilometres. Exposure equals length there — junctions are
   *  included, unlike Philadelphia — so no separate exposure_km is emitted. */
  length_km?: number;
  mu_per_km?: number;
  /** Bogotá's outcome: pedestrian-INVOLVED crashes, not KSI. */
  ped_crashes_seg?: number;
  width_m?: number;
  lanes?: number;
  speed?: number;
  has_signal?: boolean;
  ses_cat?: number;
  /** Bogotá gate: SES joined for this segment. */
  has_ses?: boolean;

  ped_ksi_seg?: number;
  ped_any_seg?: number;
  ped_deaths_seg?: number;
  ksi_corridor?: number;

  /** Expected mid-block KSI per mile. The honest thing to map. */
  mu_per_mile?: number;
  eb_ksi_seg?: number;
  eb_weight_seg?: number;
  rank_seg_spf?: number;
  tier?: SegmentRiskTier;

  /** Corridor estimates, where empirical Bayes carries real weight. */
  eb_ksi_corr?: number;
  eb_weight_corr?: number;
  rank_corr_spf?: number;

  aadt?: number;
  hin_frac?: number;
  pop_800m?: number;
  schools_200m?: number;
  parks_200m?: number;

  /** Always present, always boolean — the only thing MapLibre can gate on. */
  has_model: boolean;
  /** True only where AADT is a genuine count, not PennDOT's nominal 300. */
  has_aadt: boolean;
  has_crashes: boolean;
  in_ranking: boolean;
}

export type LineGeometry =
  | { type: "LineString"; coordinates: [number, number][] }
  | { type: "MultiLineString"; coordinates: [number, number][][] };

export interface SegmentFeature {
  type: "Feature";
  geometry: LineGeometry;
  properties: SegmentProperties;
}

export interface SegmentCollection {
  type: "FeatureCollection";
  metadata: {
    name: string;
    city: string;
    unit_type: "line";
    unit_label: string;
    description: string;
    caveat: string;
    not_comparable_to: Record<string, string>;
    crash_window: string;
    /** Present on the Philadelphia segment layer only. */
    crash_accounting?: {
      geocoded_ped_ksi: number;
      intersection_layer: number;
      intersection_within_25m: number;
      intersection_snap_failures: number;
      segment_layer: number;
      segment_assigned: number;
      segment_unplaced: number;
      segment_on_walkable_network: number;
      segment_on_expressway_ramp_private: number;
      rule: string;
    };
    exposure?: {
      definition: string;
      network_mi: number;
      exposure_mi: number;
      zero_exposure_segments: number;
    };
    /** Present on the Bogotá segment layer only. */
    coverage?: {
      segments: number;
      with_model: number;
      with_crashes: number;
      pedestrian_crashes: number;
    };
    distance_unit?: "mi" | "km";
    attribution?: string;
    taxonomy_note?: string;
    geometry_note?: string;
    spf?: Record<string, string>;
    coordinate_system: string;
    coordinate_decimals: number;
    generated: string;
  };
  features: SegmentFeature[];
}

// ===========================================================================
// The analysis-unit union
// ===========================================================================

export type UnitFeature =
  | IntersectionFeature
  | SegmentFeature
  | ZatFeature
  | TractFeature;
export type UnitCollection =
  | IntersectionCollection
  | SegmentCollection
  | ZatCollection
  | TractCollection;

/**
 * TypeScript does not narrow a union on a NESTED discriminant, so testing
 * `f.geometry.type === "Point"` will not narrow UnitFeature. These guards test
 * a top-level key on `properties`, which does narrow.
 *
 * They stay mutually exclusive only because the three id fields are distinct:
 * node_id, seg_id, unit_id. Reusing one across datasets would silently route a
 * feature to the wrong panel and the wrong filter set.
 */
export function isIntersectionFeature(f: UnitFeature): f is IntersectionFeature {
  return "node_id" in f.properties;
}
export function isSegmentFeature(f: UnitFeature): f is SegmentFeature {
  return "seg_id" in f.properties;
}
export function isZatFeature(f: UnitFeature): f is ZatFeature {
  return "unit_id" in f.properties;
}
/** Tracts are the only unit carrying a GEOID. */
export function isTractFeature(f: UnitFeature): f is TractFeature {
  return "geoid" in f.properties;
}
/**
 * Polygon collections are two kinds — Bogotá ZATs and Philadelphia tracts —
 * and both carry `unit_type: "polygon"`, so that field alone cannot tell them
 * apart. This guard used to key on it alone, which made the ZAT stats bar
 * render for tracts and read `metadata.join`, a ZAT-only block, off metadata
 * that has none: the "client-side exception" on `?layer=philadelphia-tracts`
 * (24 Aug 2026). `join` is what every ZAT-only consumer actually reads, so it
 * is the honest discriminator, mirroring `crash_accounting` for tracts below.
 */
export function isZatCollection(c: UnitCollection): c is ZatCollection {
  return (
    "unit_type" in c.metadata &&
    c.metadata.unit_type === "polygon" &&
    "join" in c.metadata
  );
}
/**
 * `crash_accounting` is unique to the tract layer, and it is there because this
 * is the only Philadelphia layer holding the COMPLETE geocoded crash set — so
 * it is the one that must state it is not summable with the other two.
 * Not keyed on `unit_type`: the intersection collection's metadata has no such
 * field, so reading it would not typecheck across the union.
 */
export function isTractCollection(c: UnitCollection): c is TractCollection {
  return "crash_accounting" in c.metadata;
}
export function isSegmentCollection(c: UnitCollection): c is SegmentCollection {
  return "unit_type" in c.metadata && c.metadata.unit_type === "line";
}

/**
 * Compile-time exhaustiveness. Every place that branches over the analysis-unit
 * union ends in this, so adding a fourth unit type becomes a build error rather
 * than a silently-wrong render. Two-way ternaries were the real hazard here:
 * `isZatFeature(f) ? zat : intersection` accepts a segment and reads
 * intersection fields off it as undefined, which compares false everywhere and
 * shows an empty panel rather than throwing.
 */
export function assertNever(x: never, context = "analysis unit"): never {
  throw new Error(
    `Unhandled ${context} variant: ${JSON.stringify((x as { properties?: unknown })?.properties ?? x)}`
  );
}

/**
 * A relative risk in a shape the UI can render without being able to make a
 * mistake. The reference branch simply has no lo/hi in scope, so the JSX that
 * prints an interval cannot compile there. Constraint enforced by the type
 * system rather than by review.
 */
export type RrDisplay =
  | { kind: "reference"; rr: 1 }
  | { kind: "estimate"; rr: number; lo: number; hi: number; p: number | null };

export function rrDisplay(
  e: RrEstimate | null | undefined,
  isReference: boolean
): RrDisplay | null {
  if (!e) return null;
  // Trust the flag AND the data: either saying "reference" suppresses the CI.
  if (isReference || e.lo === null || e.hi === null) return { kind: "reference", rr: 1 };
  return { kind: "estimate", rr: e.rr, lo: e.lo, hi: e.hi, p: e.p };
}

// ===========================================================================
// Filters — one shape per analysis unit, discriminated on `kind`
// ===========================================================================

/** Philadelphia. Crash-specific throughout; meaningless over ZAT data. */
export interface CrashFilterState {
  kind: "philadelphia-crash";
  riskScoreRange: [number, number];
  riskTiers: RiskTier[];
  stopTypes: StopType[];
  onHin: boolean | null;
  hasCamera: boolean | null;
  nearSchool: boolean | null;
  nearPark: boolean | null;
  top50Only: boolean;
  searchQuery: string;
}

/** Philadelphia street segments. */
export interface SegmentFilterState {
  kind: "philadelphia-segment";
  /** Street_Centerline CLASS values. [] = all. */
  classes: number[];
  tiers: SegmentRiskTier[];
  onewayOnly: boolean;
  /** Restrict to segments with a genuine AADT count, not the nominal 300. */
  measuredAadtOnly: boolean;
  /** Restrict to segments with at least one observed mid-block KSI. */
  withCrashesOnly: boolean;
  searchQuery: string;
}

/** Bogotá. */
export interface ZatFilterState {
  kind: "bogota-zat";
  /** [] = all clusters. */
  clusters: ZatCluster[];
  /** [] = all strata. */
  sesCategories: SesCategory[];
  /** Zones with no data for the active layer mode. */
  showNoData: boolean;
  /** Matches unit_name and unit_id. */
  searchQuery: string;
}


// ===========================================================================
// Philadelphia — census tracts
// ===========================================================================

/**
 * ACS reliability threshold, as a coefficient of variation in percent.
 *
 * The Census Bureau's own guidance: above 30% an estimate is too imprecise to
 * order one geography against another. It is not a styling constant — at tract
 * level the margins are wide enough to swallow the estimate (one tract reports
 * a median household income of $102,670 ± $50,798), so a bare point estimate
 * would misrepresent rather than simplify.
 */
export const CV_UNRELIABLE = 30;

/** Below this, an estimate carries no caveat. Between the two, use with care. */
export const CV_CAUTION = 15;

export type AcsReliability = "reliable" | "caution" | "unreliable" | "unknown";

/**
 * Reliability band for an ACS estimate from its coefficient of variation.
 *
 * `undefined` maps to "unknown", not to "reliable": a missing CV means the
 * precision was never measured, which is not the same as it being fine.
 */
export function acsReliability(cv: number | undefined | null): AcsReliability {
  if (cv === undefined || cv === null || Number.isNaN(cv)) return "unknown";
  if (cv > CV_UNRELIABLE) return "unreliable";
  if (cv > CV_CAUTION) return "caution";
  return "reliable";
}

/** How an ACS value is rendered. `usd` is a dollar amount; `pct` a percentage. */
export type AcsKind = "usd" | "pct";

/** The ACS estimates carried per tract. Each also has `_moe` and `_cv`. */
export type AcsKey =
  | "pct_pov"
  | "med_hh_income"
  | "pct_no_vehicle"
  | "pct_65plus"
  | "pct_under18"
  | "pct_hispanic"
  | "pct_nh_white"
  | "pct_nh_black";

/**
 * Display order and labels, mirroring `metadata.acs.fields` in tracts.geojson.
 *
 * Duplicated here deliberately rather than read from the file: the components
 * index tract properties by these keys, so they have to be a compile-time type
 * rather than whatever the data happens to contain at runtime. If the build
 * script changes the field set, this list and `AcsKey` must change with it —
 * and a mismatch surfaces as a type error rather than a blank column.
 */
export const ACS_LABELS: readonly {
  key: AcsKey;
  label: string;
  kind: AcsKind;
}[] = [
  { key: "pct_pov", label: "Below the poverty level", kind: "pct" },
  { key: "med_hh_income", label: "Median household income", kind: "usd" },
  { key: "pct_no_vehicle", label: "Households with no vehicle", kind: "pct" },
  { key: "pct_65plus", label: "Aged 65 and over", kind: "pct" },
  { key: "pct_under18", label: "Under 18", kind: "pct" },
  { key: "pct_hispanic", label: "Hispanic or Latino", kind: "pct" },
  { key: "pct_nh_white", label: "Non-Hispanic White alone", kind: "pct" },
  { key: "pct_nh_black", label: "Non-Hispanic Black alone", kind: "pct" },
] as const;

export interface TractProperties {
  tract_id: number;
  geoid: string;
  unit_name: string;

  // Crashes. Every geocoded pedestrian KSI 2015-2024 that falls inside the
  // tract, intersection-related and mid-block together.
  ped_ksi: number;
  ped_any: number;
  ksi_intersection: number;
  ksi_midblock: number;
  ksi_near_boundary: number;
  ksi_per_10k_pop: number | null;

  // Safety performance function, walkable road miles as the offset.
  mu_spf: number | null;
  eb_ksi: number | null;
  eb_weight: number | null;
  eb_per_road_mi: number | null;
  mu_per_road_mi: number | null;
  excess_ksi: number | null;
  rank_eb: number | null;
  rank_raw: number | null;
  tier: RiskTier | null;

  // Network and exposure.
  road_mi: number | null;
  n_segments: number | null;
  n_nodes: number | null;
  pct_arterial: number | null;
  aadt_mean: number | null;
  land_km2: number | null;
  parks: number | null;
  schools: number | null;

  // ACS. Every estimate is accompanied by its margin of error and CV; see
  // ACS_LABELS for the display set.
  pop: number | null;
  pop_moe: number | null;
  pct_pov: number | null;
  pct_pov_moe: number | null;
  pct_pov_cv: number | null;
  med_hh_income: number | null;
  med_hh_income_moe: number | null;
  med_hh_income_cv: number | null;
  pct_no_vehicle: number | null;
  pct_no_vehicle_moe: number | null;
  pct_no_vehicle_cv: number | null;
  pct_65plus: number | null;
  pct_65plus_moe: number | null;
  pct_65plus_cv: number | null;
  pct_under18: number | null;
  pct_under18_moe: number | null;
  pct_under18_cv: number | null;
  pct_hispanic: number | null;
  pct_hispanic_moe: number | null;
  pct_hispanic_cv: number | null;
  pct_nh_white: number | null;
  pct_nh_white_moe: number | null;
  pct_nh_white_cv: number | null;
  pct_nh_black: number | null;
  pct_nh_black_moe: number | null;
  pct_nh_black_cv: number | null;

  // Coverage flags, so "no data" and "zero" stay distinguishable.
  has_crashes: boolean;
  has_model: boolean;
  has_acs: boolean;
  has_pov: boolean;
  /** An ACS 65+ share exists — the gate for the Age 65+ mode. */
  has_age: boolean;

  /**
   * Optional BY DESIGN, not missing. build_tracts_geojson.py drops any key
   * outside its ALWAYS set when the value is zero, to keep the payload lean —
   * so this is absent from the 198 tracts with no pedestrian death and present
   * on the other 210, totalling 451 of the layer's 1,494 KSI. The panel's
   * `?? 0` is the correct reading, not a workaround.
   */
  ped_deaths?: number | null;
}

export interface TractFeature {
  type: "Feature";
  geometry: PolygonGeometry;
  properties: TractProperties;
}

export interface TractCollection {
  type: "FeatureCollection";
  metadata: {
    name: string;
    city: string;
    unit_type: "polygon";
    unit_key: string;
    unit_label: string;
    description: string;
    /** ECOLOGICAL, and not summable with the other two Philadelphia layers. */
    caveat: string;
    crash_window: string;
    crash_accounting: {
      ped_ksi_total: number;
      geocoded: number;
      no_usable_coordinate: number;
      tract_layer: number;
      intersection_layer_rendered: number;
      segment_layer_rendered: number;
      intersection_plus_segment: number;
      county_edge_snapped: number;
      rule: string;
      county_edge_note: string;
      not_summable: string;
    };
    /**
     * Why boundary-adjacent tracts read low. A crash belongs to the tract
     * containing it, but tract boundaries follow streets and crashes happen on
     * streets, so an arterial dividing two tracts splits its burden across
     * both. The panel quotes pct_within_50m, so this cannot stay `unknown`.
     */
    boundary_effect: {
      ksi_within_25m_of_boundary: number;
      ksi_within_50m_of_boundary: number;
      ksi_within_100m_of_boundary: number;
      pct_within_50m: number;
      median_distance_m: number;
      note: string;
    };
    spf: unknown;
    acs: {
      vintage: string;
      geography: string;
      moe_confidence: number;
      fields: { key: string; label: string; kind: string }[];
    };
    not_comparable_to: unknown;
    caveats: unknown;
    attribution: unknown;
    coordinate_system: string;
    coordinate_decimals: number;
    generated: string;
  };
  features: TractFeature[];
}

/** Philadelphia census tracts. */
export interface TractFilterState {
  kind: "philadelphia-tract";
  /** [] = all tiers. */
  tiers: RiskTier[];
  /** Hide tracts with no pedestrian KSI in the window. */
  withCrashesOnly: boolean;
  /**
   * Hide tracts whose ACS estimates are too imprecise to rank. Filtering on
   * precision is itself a selection, so it is off by default.
   */
  reliableAcsOnly: boolean;
  /** Matches unit_name and geoid. */
  searchQuery: string;
}

export type FilterState =
  | CrashFilterState
  | SegmentFilterState
  | ZatFilterState
  | TractFilterState;
