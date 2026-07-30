import type { RiskTier, FilterState } from "./types";

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

/** Philadelphia default center and zoom. */
export const PHILADELPHIA_CENTER: [number, number] = [-75.1652, 39.9526];
export const PHILADELPHIA_ZOOM = 12;

/** Bounding box for Philadelphia [sw_lng, sw_lat, ne_lng, ne_lat]. */
export const PHILADELPHIA_BOUNDS: [number, number, number, number] = [
  -75.2803, 39.8670, -74.9558, 40.1380,
];

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

export const DEFAULT_FILTERS: FilterState = {
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

export const CITIES = [
  { id: "philadelphia" as const, label: "Philadelphia", enabled: true },
  { id: "salt-lake-city" as const, label: "Salt Lake City", enabled: false },
];

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
