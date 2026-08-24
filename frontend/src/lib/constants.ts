import type {
  RiskTier,
  CrashFilterState,
  SegmentFilterState,
  ZatFilterState,
  TractFilterState,
  ZatCluster,
  SesCategory,
} from "./types";
import type { DatasetConfig } from "./cities";
import { assertNever } from "./types";

/** API base URL — falls back to relative path for same-origin deployment. */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * Path prefix for static assets fetched directly.
 *
 * GitHub Pages serves project sites from /REPO/, so `/data/x.json` would
 * 404. Next rewrites next/link and next/font automatically but leaves plain
 * fetch() alone, so static data URLs must be prefixed by hand.
 * Empty for local dev and for root-domain deployments.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** MapLibre base style URL (CARTO Positron — free, no token). */
export const MAP_STYLE_URL =
  process.env.NEXT_PUBLIC_MAPLIBRE_STYLE ??
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

/**
 * Per-city geography (centre, zoom, bounds, unit type) now lives in
 * `lib/cities.ts`. It moved out of here so a second city does not mean a second
 * set of PHILADELPHIA_*-shaped module constants.
 */

// ---------------------------------------------------------------------------
// Risk tier configuration
// ---------------------------------------------------------------------------

export const RISK_TIER_COLORS: Record<RiskTier, string> = {
  Critical: "#C44536",
  High: "#D4820A",
  Moderate: "#2563EB",
  Low: "#6B7280",
};

export const RISK_TIER_BG_COLORS: Record<RiskTier, string> = {
  Critical: "#FEE2E2",
  High: "#FEF3C7",
  Moderate: "#DBEAFE",
  Low: "#F3F4F6",
};

export const RISK_TIER_LABELS: Record<RiskTier, string> = {
  Critical: "Critical Risk",
  High: "High Risk",
  Moderate: "Moderate Risk",
  Low: "Low Risk",
};

export const RISK_TIERS: RiskTier[] = ["Critical", "High", "Moderate", "Low"];

/** Circle radius by risk tier for map rendering. */
export const RISK_TIER_RADIUS: Record<RiskTier, number> = {
  Critical: 8,
  High: 6,
  Moderate: 4,
  Low: 3,
};

// ---------------------------------------------------------------------------
// Filter defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CRASH_FILTERS: CrashFilterState = {
  kind: "philadelphia-crash",
  riskScoreRange: [0, 2.2],
  riskTiers: ["Critical", "High", "Moderate", "Low"],
  stopTypes: [],
  onHin: null,
  hasCamera: null,
  nearSchool: null,
  nearPark: null,
  top50Only: false,
  searchQuery: "",
};

export const DEFAULT_ZAT_FILTERS: ZatFilterState = {
  kind: "bogota-zat",
  clusters: [],
  sesCategories: [],
  showNoData: true,
  searchQuery: "",
};

export const DEFAULT_TRACT_FILTERS: TractFilterState = {
  kind: "philadelphia-tract",
  tiers: [],
  withCrashesOnly: false,
  // Filtering on precision is itself a selection — it would drop the tracts
  // whose estimates are least certain, which correlate with small populations.
  // Off by default; the panel marks unreliable values instead.
  reliableAcsOnly: false,
  searchQuery: "",
};

export const DEFAULT_SEGMENT_FILTERS: SegmentFilterState = {
  kind: "philadelphia-segment",
  classes: [],
  tiers: ["Critical", "High", "Moderate", "Low"],
  onewayOnly: false,
  measuredAadtOnly: false,
  withCrashesOnly: false,
  searchQuery: "",
};

export function defaultFiltersFor(dataset: DatasetConfig) {
  switch (dataset.filterKind) {
    case "bogota-zat": return DEFAULT_ZAT_FILTERS;
    case "philadelphia-segment": return DEFAULT_SEGMENT_FILTERS;
    // Missing until 24 Aug 2026: the tract dataset fell through to the
    // intersection filters, whose `philadelphia-crash` kind rejects every
    // tract in matchesFilters — "0 of 408", no polygons, wrong sidebar.
    case "philadelphia-tract": return DEFAULT_TRACT_FILTERS;
    case "philadelphia-crash": return DEFAULT_CRASH_FILTERS;
    default: return assertNever(dataset.filterKind, "filter kind");
  }
}

/** Street_Centerline CLASS values in the walkable network. */
export const SEGMENT_CLASSES: { value: number; label: string }[] = [
  { value: 2, label: "Arterial" },
  { value: 3, label: "Collector" },
  { value: 4, label: "Local" },
  { value: 5, label: "Minor local" },
];

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export interface NavItem {
  label: string;
  href: string;
  disabled?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Map Explorer", href: "/" },
  { label: "City Reports", href: "/reports" },
  { label: "Equity Dashboard", href: "/equity" },
  { label: "Data Downloads", href: "/data" },
  { label: "Research", href: "/research" },
  { label: "About", href: "/about" },
];

/** Cities on the roadmap with no data yet. Rendered as disabled chips. */
export const PLANNED_CITIES: { label: string; note: string }[] = [
  { label: "Salt Lake City", note: "Not built" },
];

// ---------------------------------------------------------------------------
// Bogotá — ZAT cluster profiles
// ---------------------------------------------------------------------------

/**
 * The four clusters are an INTENSITY GRADIENT, not four unrelated types.
 * Median total across all 27 CANVAS features: cluster 1 ≈ 6,500,
 * cluster 3 ≈ 20,200, cluster 2 ≈ 44,400, cluster 4 ≈ 61,700.
 *
 * That ordering is the exposure story behind the relative risks: cluster 4
 * carries the most infrastructure AND the most crashes because it carries the
 * most pedestrians and traffic. The palette is sequential along that gradient
 * so the map reads the way the data actually runs.
 *
 * Deliberately a cool ramp: the warm red/orange palette already means "risk
 * tier" elsewhere in this dashboard, and a cluster is a profile, not a score.
 */
export const CLUSTER_ORDER: ZatCluster[] = [1, 3, 2, 4];

export const CLUSTER_COLORS: Record<ZatCluster, string> = {
  1: "#BFE0E6",
  3: "#7FBFD0",
  2: "#3D8FAE",
  4: "#1D4E6B",
};

/**
 * Labels derived from the cluster feature and crash profiles, not invented.
 * Cluster 4's description is the one documented in data/source/README.md.
 */
export const CLUSTER_LABELS: Record<ZatCluster, string> = {
  1: "Peripheral, low-density",
  3: "Residential, moderate density",
  2: "Dense local street network",
  4: "Dense arterial / mass-transit corridor",
};

export const CLUSTER_DESCRIPTIONS: Record<ZatCluster, string> = {
  1: "Lowest counts on every feature. Median zero traffic lights, bike lanes and bus lanes; the highest share of roads outside the collector/local classes. Lowest crash burden.",
  3: "About a third of cluster 2's infrastructure. The lowest-SES cluster — 45% of its zones are in stratum 2.",
  2: "The highest population density and walking/transit trips, but below average on traffic lights, pedestrian signals and bus lanes. Managed by signage and speed bumps rather than signals.",
  4: "Highest on all 27 features and the only cluster with BRT stations and bus lanes at the median. Highest crash burden. This is the model's reference category.",
};

export const NO_DATA_FILL = "#D8D5CE";
export const NO_DATA_FILL_DARK = "#4B5563";

/**
 * No-data colour for LINE datasets, darker than the polygon equivalent.
 *
 * A line one to three pixels wide needs far more contrast than a zone-sized
 * fill to read at all. The segment layers used to draw gated-out features in
 * #C9C5BD at 0.28 opacity, which composites to rgb(235,233,229) over the
 * light basemap — a contrast ratio of 1.13:1, against a WCAG non-text
 * minimum of 3:1. On the Observed mode, where only 1.5% of Philadelphia
 * segments and 10.3% of Bogotá's carry a crash, that made the map look
 * empty and the toggle look broken.
 *
 * These are drawn at full layer opacity, so the colour alone carries the
 * distinction, as it already does for unscored intersections on the Imagery
 * layer. 2.4:1 on light and 2.9:1 on dark: clearly present as network
 * structure, still obviously inert. Neutral rather than warm on purpose —
 * the data ramps are all orange-to-red, so hue separates no-data from a low
 * value even where luminance is similar.
 */
export const NO_DATA_LINE = "#A8A197";
export const NO_DATA_LINE_DARK = "#6B7280";

/**
 * Step breaks from the empirical distributions in bogota_zats.geojson
 * (n = 783 for casualties, 851 for the 60+ share).
 */
export const CASUALTY_DENSITY_BREAKS = [22, 44, 73, 114, 153];
export const CASUALTY_DENSITY_RAMP = [
  "#FEF0D9", "#FDD49E", "#FDBB84", "#FC8D59", "#E34A33", "#B30000",
];

/**
 * Philadelphia tract ramps, from the empirical distributions in
 * data/tracts.geojson (n = 407 with a model, 408 with crashes, 388 with an
 * ACS poverty estimate). Added 24 Aug 2026: the tract layer shipped with a
 * data file, filters, sidebar and info panel but no paint or legend of its
 * own, so it rendered every tract grey under the Bogotá zone-profile legend.
 *
 * Excess KSI is observed minus the SPF expectation and is DIVERGING about 0
 * (247 of 407 tracts sit below expectation): quantiles p10 −3.5, p25 −2.2,
 * p50 −0.8, p75 +1.1, p90 +3.8, p95 +6.2. Blue = fewer than expected, red =
 * more. The breaks are symmetric so the ramp does not imply that "below
 * expectation" is the neutral state.
 */
export const TRACT_EXCESS_BREAKS = [-3, -1, 1, 3, 6];
export const TRACT_EXCESS_RAMP = [
  "#2166AC", "#92C5DE", "#E6E6E6", "#F4A582", "#D6604D", "#B2182B",
];
/** Observed pedestrian KSI, 2015–2024: p50 3, p75 5, p90 8, p95 11, max 27. */
export const TRACT_OBSERVED_BREAKS = [1, 3, 5, 8, 12];
export const TRACT_OBSERVED_RAMP = [
  "#FEF0D9", "#FDD49E", "#FDBB84", "#FC8D59", "#E34A33", "#B30000",
];
/** Share below the poverty level, ACS 2020–2024: p25 10, p50 18, p75 30, p90 43. */
export const TRACT_POVERTY_BREAKS = [10, 20, 30, 40, 50];
export const TRACT_POVERTY_RAMP = [
  "#F2F0F7", "#DADAEB", "#BCBDDC", "#9E9AC8", "#756BB1", "#54278F",
];

/**
 * Bogotá casualties per 10,000 walking + public-transport trips (2019
 * mobility survey, `walk_pubt`), n = 783 zones with crash data: p25 3.1,
 * p50 5.3, p75 9.3, p90 14.9, p95 21. Replaced the per-km² density as the
 * mapped quantity on 24 Aug 2026 — area is not exposure; trips are the
 * offset the published ZAT models use.
 */
export const TRIP_RATE_BREAKS = [3, 6, 10, 15, 25];
/**
 * Denominator floor for the RANKED list only (the map colours every zone).
 * Below ~5,000 trips (the 5th–10th percentile) one or two crashes swing the
 * rate: 12 of the top 20 unfloored zones had under 5,000 trips, led by a zone
 * with 8 casualties over 345 trips. 62 of 783 zones sit under the floor.
 */
export const MIN_TRIPS_FOR_RANKING = 5000;
/** Philadelphia tracts, share aged 65+, ACS 2020–2024: p25 9.4, p50 13.9, p75 19.5, p90 24.7. */
export const TRACT_AGE_BREAKS = [8, 12, 16, 20, 25];
export const TRACT_AGE_RAMP = [
  "#F0F9E8", "#CCEBC5", "#A8DDB5", "#7BCCC4", "#43A2CA", "#0868AC",
];

export const PCT60_BREAKS = [10, 14, 18, 22, 25];
export const PCT60_RAMP = [
  "#F2F0F7", "#DADAEB", "#BCBDDC", "#9E9AC8", "#756BB1", "#54278F",
];

export const SES_CATEGORIES: SesCategory[] = [1, 2, 3, 4, 5, 6];

/**
 * Colombian *estrato*. Rendered without a colour gradient on purpose: the
 * SES–crash relationship is NOT monotonic (it peaks at stratum 2), so a 1→6
 * ramp would assert a gradient the data do not support.
 */
export const SES_LABEL = "Estrato";

// Segment SPF and observed-count cut-points now live on each dataset, in
// `SegmentFieldConfig` — see lib/cities.ts. Keeping them here as free constants
// let the legend read one city's scale while the paint expression used
// another's. Bogotá's quantiles (p75 2.73, p95 7.73, p99 23.21) are recorded in
// that config alongside the field names they belong to.

// ---------------------------------------------------------------------------
// Trend icons
// ---------------------------------------------------------------------------

export const TREND_CONFIG: Record<
  string,
  { label: string; color: string; arrow: string }
> = {
  higher: { label: "Trending up", color: "#C44536", arrow: "↑" },
  lower: { label: "Trending down", color: "#1B6B4A", arrow: "↓" },
  // The data pipeline emits "flat"; "same" kept as an alias.
  flat: { label: "No change", color: "#6B7280", arrow: "→" },
  same: { label: "No change", color: "#6B7280", arrow: "→" },
};

/** Fallback used when a trend value is missing or unrecognized. */
export const TREND_FALLBACK = {
  label: "No data",
  color: "#9CA3AF",
  arrow: "–",
};
