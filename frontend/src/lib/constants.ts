import type {
  RiskTier,
  CrashFilterState,
  SegmentFilterState,
  ZatFilterState,
  ZatCluster,
  SesCategory,
} from "./types";
import type { DatasetConfig } from "./cities";

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
    default: return DEFAULT_CRASH_FILTERS;
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
 * Step breaks from the empirical distributions in bogota_zats.geojson
 * (n = 783 for casualties, 851 for the 60+ share).
 */
export const CASUALTY_DENSITY_BREAKS = [22, 44, 73, 114, 153];
export const CASUALTY_DENSITY_RAMP = [
  "#FEF0D9", "#FDD49E", "#FDBB84", "#FC8D59", "#E34A33", "#B30000",
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

/**
 * Bogotá segment SPF, expected pedestrian-involved crashes per km. Breaks are
 * the fitted distribution's quantiles (p75 2.73, p95 7.73, p99 23.21), NOT the
 * Philadelphia segment cut-points — different outcome and different unit.
 */
export const BOG_SPF_BREAKS = [0.8, 1.6, 2.7, 7.7, 23.2];

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
