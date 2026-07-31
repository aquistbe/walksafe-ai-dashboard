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

  casualties_per_km2: number | null;
  injury_per_km2: number | null;
  death_per_km2: number | null;
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
// The analysis-unit union
// ===========================================================================

export type UnitFeature = IntersectionFeature | ZatFeature;
export type UnitCollection = IntersectionCollection | ZatCollection;

/**
 * TypeScript does not narrow a union on a NESTED discriminant, so testing
 * `f.geometry.type === "Point"` will not narrow UnitFeature. These guards test
 * a top-level key on `properties`, which does narrow.
 */
export function isIntersectionFeature(f: UnitFeature): f is IntersectionFeature {
  return "node_id" in f.properties;
}
export function isZatFeature(f: UnitFeature): f is ZatFeature {
  return "unit_id" in f.properties;
}
export function isZatCollection(c: UnitCollection): c is ZatCollection {
  return "unit_type" in c.metadata && c.metadata.unit_type === "polygon";
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

export type FilterState = CrashFilterState | ZatFilterState;
