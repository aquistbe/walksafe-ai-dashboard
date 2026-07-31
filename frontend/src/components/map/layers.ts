/**
 * MapLibre source and layer construction for both analysis-unit types.
 *
 * Everything here used to live inline in MapExplorer, declared TWICE — once in
 * `map.on("load")` and again in `switchBasemap`'s `style.load` handler — and
 * the two copies had already drifted (the load path hardcoded light-mode
 * strokes, and the style.load path forgot to make the colour expression
 * layer-mode aware, so toggling dark mode while in Imagery silently reverted
 * the ramp to risk tiers). One builder, called from both places, is what makes
 * a polygon path tractable at all.
 */

import type maplibregl from "maplibre-gl";
import type { CityConfig } from "@/lib/cities";
import {
  RISK_TIER_COLORS,
  RISK_TIER_RADIUS,
  CLUSTER_COLORS,
  NO_DATA_FILL,
  NO_DATA_FILL_DARK,
  CASUALTY_DENSITY_BREAKS,
  CASUALTY_DENSITY_RAMP,
  PCT60_BREAKS,
  PCT60_RAMP,
} from "@/lib/constants";
import { matchNothing, matchId } from "@/lib/filters";

export type BasemapMode = "light" | "dark";

export const SOURCE_ID = "units";

// Point stack
export const CIRCLE_LAYER_ID = "units-circles";
export const CIRCLE_HOVER_LAYER_ID = "units-circles-hover";
export const SELECTED_PULSE_LAYER_ID = "units-selected-pulse";
export const SELECTED_LAYER_ID = "units-selected";

// Polygon stack
export const FILL_LAYER_ID = "units-fill";
export const FILL_HOVER_LAYER_ID = "units-fill-hover";
export const OUTLINE_LAYER_ID = "units-outline";
export const SELECTED_GLOW_LAYER_ID = "units-selected-glow";
export const SELECTED_OUTLINE_LAYER_ID = "units-selected-outline";

/** Removal order: topmost first, so nothing is orphaned mid-teardown. */
const ALL_LAYER_IDS = [
  SELECTED_LAYER_ID,
  SELECTED_PULSE_LAYER_ID,
  CIRCLE_HOVER_LAYER_ID,
  CIRCLE_LAYER_ID,
  SELECTED_OUTLINE_LAYER_ID,
  SELECTED_GLOW_LAYER_ID,
  OUTLINE_LAYER_ID,
  FILL_HOVER_LAYER_ID,
  FILL_LAYER_ID,
];

/** The layer that receives hover and click handlers, per unit type. */
export function interactiveLayerId(city: CityConfig): string {
  return city.unitType === "polygon" ? FILL_LAYER_ID : CIRCLE_LAYER_ID;
}

export function hoverLayerId(city: CityConfig): string {
  return city.unitType === "polygon" ? FILL_HOVER_LAYER_ID : CIRCLE_HOVER_LAYER_ID;
}

export function selectionLayerIds(city: CityConfig): string[] {
  return city.unitType === "polygon"
    ? [SELECTED_GLOW_LAYER_ID, SELECTED_OUTLINE_LAYER_ID]
    : [SELECTED_PULSE_LAYER_ID, SELECTED_LAYER_ID];
}

export const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

// ---------------------------------------------------------------------------
// Philadelphia — point paint
// ---------------------------------------------------------------------------

const tierMatch = (scale: number, bump: number): unknown[] => [
  "match",
  ["get", "risk_tier"],
  "Critical", RISK_TIER_RADIUS.Critical * scale + bump,
  "High", RISK_TIER_RADIUS.High * scale + bump,
  "Moderate", RISK_TIER_RADIUS.Moderate * scale + bump,
  "Low", RISK_TIER_RADIUS.Low * scale + bump,
  3 * scale + bump,
];

export const circleColorExpr: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "risk_tier"],
  "Critical", RISK_TIER_COLORS.Critical,
  "High", RISK_TIER_COLORS.High,
  "Moderate", RISK_TIER_COLORS.Moderate,
  "Low", RISK_TIER_COLORS.Low,
  "#6B7280",
];

/** Colour ramp for the blind imagery safety score (0 hostile → 100 protected). */
export const IMAGERY_COLOR_EXPR: maplibregl.ExpressionSpecification = [
  "case",
  ["!", ["has", "img_score"]],
  "#E5E7EB",
  [
    "interpolate",
    ["linear"],
    ["to-number", ["get", "img_score"], 50],
    0, "#7F1D1D",
    25, "#C44536",
    50, "#D4820A",
    75, "#65A30D",
    100, "#1B6B4A",
  ],
];

/**
 * Circle radius, with `bump` added for the hover layer.
 *
 * The bump is baked into each stop rather than wrapped as
 * `["+", radiusExpr, 3]`. MapLibre rejects that outright — "zoom expression may
 * only be used as input to a top-level step or interpolate expression" — so the
 * wrapped form made addLayer fail and the hover-highlight layer was never
 * added at all. That was true of the original code too; hover highlighting has
 * silently never worked.
 *
 * Base radius is scaled down when zoomed out to cut GPU overdraw across ~17k
 * points.
 */
export function pointRadiusExpr(
  layerMode: string,
  bump = 0
): maplibregl.ExpressionSpecification {
  if (layerMode === "crashes") {
    return [
      "interpolate",
      ["linear"],
      ["get", "ped_ksi"],
      0, 3 + bump,
      2, 5 + bump,
      5, 8 + bump,
      10, 12 + bump,
    ];
  }
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    10, tierMatch(0.45, bump),
    14, tierMatch(1, bump),
  ] as unknown as maplibregl.ExpressionSpecification;
}

export function pointColorExpr(layerMode: string): maplibregl.ExpressionSpecification {
  return layerMode === "imagery" ? IMAGERY_COLOR_EXPR : circleColorExpr;
}

// ---------------------------------------------------------------------------
// Bogotá — polygon paint
// ---------------------------------------------------------------------------

function noDataColor(basemap: BasemapMode): string {
  return basemap === "dark" ? NO_DATA_FILL_DARK : NO_DATA_FILL;
}

function stepExpr(
  field: string,
  breaks: number[],
  ramp: string[]
): maplibregl.ExpressionSpecification {
  const step: unknown[] = ["step", ["to-number", ["get", field], 0], ramp[0]];
  breaks.forEach((b, i) => step.push(b, ramp[i + 1]));
  // Variadic `step` cannot be expressed in MapLibre's tuple types.
  return step as unknown as maplibregl.ExpressionSpecification;
}

/**
 * Fill colour for a polygon layer mode.
 *
 * Every branch gates on the mode's own always-present boolean flag. It cannot
 * gate on the value: `["has", k]` is `k in properties` and returns true for a
 * null-valued key, and `["to-number", ["get", k], fallback]` short-circuits
 * null to 0 before reaching `fallback`. Either would paint a zone with no data
 * as a real value — precisely the "missing zones must render as no data, not as
 * low risk" failure the handoff document warns about.
 */
export function polygonFillColor(
  layerMode: string,
  basemap: BasemapMode
): maplibregl.ExpressionSpecification {
  const grey = noDataColor(basemap);

  if (layerMode === "casualties") {
    return [
      "case",
      ["!", ["get", "has_covariates"]],
      grey,
      stepExpr("casualties_per_km2", CASUALTY_DENSITY_BREAKS, CASUALTY_DENSITY_RAMP),
    ] as maplibregl.ExpressionSpecification;
  }

  if (layerMode === "age60") {
    return [
      "case",
      ["!", ["get", "has_pop60"]],
      grey,
      stepExpr("pct60plus", PCT60_BREAKS, PCT60_RAMP),
    ] as maplibregl.ExpressionSpecification;
  }

  // Default: cluster profile.
  return [
    "case",
    ["!", ["get", "has_features"]],
    grey,
    [
      "match",
      ["to-number", ["get", "clus"], 0],
      1, CLUSTER_COLORS[1],
      2, CLUSTER_COLORS[2],
      3, CLUSTER_COLORS[3],
      4, CLUSTER_COLORS[4],
      grey,
    ],
  ] as maplibregl.ExpressionSpecification;
}

/**
 * No-data zones are drawn fainter as well as greyer. A zone with no data must
 * not occupy a legible position on the ramp; "absent" needs its own visual
 * grammar, not the palest value.
 */
export function polygonFillOpacity(
  gateField: string | undefined
): maplibregl.ExpressionSpecification | number {
  if (!gateField) return 0.72;
  return ["case", ["!", ["get", gateField]], 0.3, 0.72] as maplibregl.ExpressionSpecification;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface UnitLayerOptions {
  city: CityConfig;
  data: GeoJSON.FeatureCollection;
  basemap: BasemapMode;
  layerMode: string;
  gateField?: string;
  mapFilter: maplibregl.FilterSpecification;
  selectedId: number | null;
}

export function removeUnitLayers(map: maplibregl.Map): void {
  for (const id of ALL_LAYER_IDS) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}

export function addUnitLayers(map: maplibregl.Map, o: UnitLayerOptions): void {
  // Idempotent: a style swap and a city swap can both land here.
  removeUnitLayers(map);

  map.addSource(SOURCE_ID, {
    type: "geojson",
    data: o.data,
    // Currently unread — nothing in this codebase uses feature-state; hover is
    // done by swapping a duplicate layer's filter. Kept because it is now
    // correct per city and is the prerequisite for moving to feature-state if
    // polygon hover ever costs a frame.
    promoteId: o.city.idField,
  });

  if (o.city.unitType === "polygon") addPolygonLayers(map, o);
  else addPointLayers(map, o);
}

function addPointLayers(map: maplibregl.Map, o: UnitLayerOptions): void {
  const { city, basemap, layerMode, mapFilter, selectedId } = o;
  const radius = pointRadiusExpr(layerMode);
  const color = pointColorExpr(layerMode);
  const ring = basemap === "dark" ? "#2A8F64" : "#1B6B4A";
  const sel = selectedId !== null ? matchId(city.idField, selectedId) : matchNothing(city.idField);

  map.addLayer({
    id: CIRCLE_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    paint: {
      "circle-radius": radius,
      "circle-color": color,
      "circle-opacity": 0.75,
      "circle-stroke-color": basemap === "dark" ? "#374151" : "#ffffff",
      // Strokes are expensive across 17k points — fade them in with zoom.
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 11, 0, 13.5, 1],
      "circle-stroke-opacity": 0.9,
    },
    filter: mapFilter,
  });

  map.addLayer({
    id: CIRCLE_HOVER_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    paint: {
      "circle-radius": pointRadiusExpr(layerMode, 3),
      "circle-color": color,
      "circle-opacity": 0.4,
      "circle-stroke-color": basemap === "dark" ? "#9CA3AF" : "#ffffff",
      "circle-stroke-width": 2,
    },
    filter: matchNothing(city.idField),
  });

  map.addLayer({
    id: SELECTED_PULSE_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    paint: {
      "circle-radius": 18,
      "circle-color": "transparent",
      "circle-stroke-color": ring,
      "circle-stroke-width": 3,
      "circle-opacity": 0,
      "circle-stroke-opacity": 0.6,
    },
    filter: sel,
  });

  map.addLayer({
    id: SELECTED_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    paint: {
      "circle-radius": 12,
      "circle-color": "transparent",
      "circle-stroke-color": ring,
      "circle-stroke-width": 2.5,
      "circle-opacity": 0,
      "circle-stroke-opacity": 1,
    },
    filter: sel,
  });
}

function addPolygonLayers(map: maplibregl.Map, o: UnitLayerOptions): void {
  const { city, basemap, layerMode, gateField, mapFilter, selectedId } = o;
  const ring = basemap === "dark" ? "#5EEAD4" : "#1B6B4A";
  const sel = selectedId !== null ? matchId(city.idField, selectedId) : matchNothing(city.idField);

  map.addLayer({
    id: FILL_LAYER_ID,
    type: "fill",
    source: SOURCE_ID,
    paint: {
      "fill-color": polygonFillColor(layerMode, basemap),
      "fill-opacity": polygonFillOpacity(gateField),
      "fill-antialias": true,
    },
    filter: mapFilter,
  });

  map.addLayer({
    id: FILL_HOVER_LAYER_ID,
    type: "fill",
    source: SOURCE_ID,
    paint: {
      "fill-color": basemap === "dark" ? "#ffffff" : "#1B6B4A",
      "fill-opacity": 0.18,
    },
    filter: matchNothing(city.idField),
  });

  // Zone boundaries. Hairline when zoomed out so 1,141 outlines do not read as
  // a solid mesh, firming up as zones become individually legible.
  map.addLayer({
    id: OUTLINE_LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    paint: {
      "line-color": basemap === "dark" ? "#6B7280" : "#FFFFFF",
      "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.3, 14, 1.2],
      "line-opacity": 0.7,
    },
    filter: mapFilter,
  });

  map.addLayer({
    id: SELECTED_GLOW_LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    paint: {
      "line-color": ring,
      "line-width": 8,
      "line-opacity": 0.3,
      "line-blur": 2,
    },
    filter: sel,
  });

  map.addLayer({
    id: SELECTED_OUTLINE_LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    paint: {
      "line-color": ring,
      "line-width": 2.5,
      "line-opacity": 1,
    },
    filter: sel,
  });
}

/** Repaint in place on a layer-mode change, without rebuilding the stack. */
export function applyLayerMode(map: maplibregl.Map, o: UnitLayerOptions): void {
  if (o.city.unitType === "polygon") {
    if (!map.getLayer(FILL_LAYER_ID)) return;
    map.setPaintProperty(FILL_LAYER_ID, "fill-color", polygonFillColor(o.layerMode, o.basemap));
    map.setPaintProperty(FILL_LAYER_ID, "fill-opacity", polygonFillOpacity(o.gateField));
    return;
  }
  if (!map.getLayer(CIRCLE_LAYER_ID)) return;
  const radius = pointRadiusExpr(o.layerMode);
  const color = pointColorExpr(o.layerMode);
  map.setPaintProperty(CIRCLE_LAYER_ID, "circle-radius", radius);
  map.setPaintProperty(
    CIRCLE_HOVER_LAYER_ID,
    "circle-radius",
    pointRadiusExpr(o.layerMode, 3)
  );
  map.setPaintProperty(CIRCLE_LAYER_ID, "circle-color", color);
  map.setPaintProperty(CIRCLE_HOVER_LAYER_ID, "circle-color", color);
}
