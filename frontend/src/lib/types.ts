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

/** Filter state for the sidebar. */
export interface FilterState {
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

/** City selection. */
export type City = "philadelphia" | "salt-lake-city";
