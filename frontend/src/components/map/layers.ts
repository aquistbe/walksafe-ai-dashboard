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
// ExpressionSpecification lives in the style-spec package, not in
// maplibre-gl's own d.ts: maplibre-gl 4.x re-exports only some spec
// types (FilterSpecification, StyleSpecification) and not this one.
// Pinned to v20 to match maplibre-gl 4.7.1's own dependency range.
import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { DatasetConfig, SegmentFieldConfig } from "@/lib/cities";
import {
  RISK_TIER_COLORS,
  RISK_TIER_RADIUS,
  CLUSTER_COLORS,
  NO_DATA_FILL,
  NO_DATA_FILL_DARK,
  NO_DATA_LINE,
  NO_DATA_LINE_DARK,
  CASUALTY_DENSITY_BREAKS,
  TRACT_EXCESS_BREAKS, TRACT_EXCESS_RAMP,
  TRACT_OBSERVED_BREAKS, TRACT_OBSERVED_RAMP,
  TRACT_POVERTY_BREAKS, TRACT_POVERTY_RAMP,
  TRACT_AGE_BREAKS, TRACT_AGE_RAMP,
  TRIP_RATE_BREAKS,
  ZAT_EXCESS_BREAKS, ZAT_EXCESS_RAMP,
  CASUALTY_DENSITY_RAMP,
  PCT60_BREAKS,
  PCT60_RAMP,
} from "@/lib/constants";
import { matchNothing, matchId } from "@/lib/filters";
import { assertNever } from "@/lib/types";

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

// Line stack
export const LINE_LAYER_ID = "units-lines";
/** Fill beneath the outline, for line-rendered datasets whose geometry is
 *  actually polygons. See DatasetConfig.polygonGeometry. */
export const LINE_FILL_LAYER_ID = "units-lines-fill";
/** Invisible wide line that exists only to be clickable — see addLineLayers. */
export const LINE_HIT_LAYER_ID = "units-lines-hit";
export const LINE_HOVER_LAYER_ID = "units-lines-hover";
export const LINE_SELECTED_GLOW_ID = "units-lines-selected-glow";
export const LINE_SELECTED_ID = "units-lines-selected";

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
  LINE_SELECTED_ID,
  LINE_SELECTED_GLOW_ID,
  LINE_HIT_LAYER_ID,
  LINE_HOVER_LAYER_ID,
  LINE_LAYER_ID,
  LINE_FILL_LAYER_ID,
];

/** The layer that receives hover and click handlers, per unit type. */
export function interactiveLayerId(ds: DatasetConfig): string {
  switch (ds.unitType) {
    case "polygon": return FILL_LAYER_ID;
    case "line": return LINE_HIT_LAYER_ID;
    default: return CIRCLE_LAYER_ID;
  }
}

export function hoverLayerId(ds: DatasetConfig): string {
  switch (ds.unitType) {
    case "polygon": return FILL_HOVER_LAYER_ID;
    case "line": return LINE_HOVER_LAYER_ID;
    default: return CIRCLE_HOVER_LAYER_ID;
  }
}

export function selectionLayerIds(ds: DatasetConfig): string[] {
  switch (ds.unitType) {
    case "polygon": return [SELECTED_GLOW_LAYER_ID, SELECTED_OUTLINE_LAYER_ID];
    case "line": return [LINE_SELECTED_GLOW_ID, LINE_SELECTED_ID];
    default: return [SELECTED_PULSE_LAYER_ID, SELECTED_LAYER_ID];
  }
}

/**
 * Layers that carry the user's filter directly.
 *
 * LINE_HIT_LAYER_ID is excluded on purpose — it takes the narrower
 * `interactionFilter` instead, so units with no value for the active layer mode
 * stay visible but cannot be clicked. See interactionFilter.
 */
export function filterableLayerIds(): string[] {
  return [CIRCLE_LAYER_ID, FILL_LAYER_ID, OUTLINE_LAYER_ID, LINE_LAYER_ID,
          LINE_FILL_LAYER_ID];
}

/**
 * Filter for the invisible click-target layer.
 *
 * A unit with no value for the active mode is drawn in the muted "no data"
 * colour rather than removed — removing 39,162 of 39,761 segments on the
 * Observed mode would leave a map that reads as broken. But it should not be
 * selectable either: opening a panel for a street whose colour means "nothing
 * measured here" invites reading absence as a low value.
 *
 * So the visible line keeps the user's filter and the hit target adds the mode
 * gate on top. Hover follows automatically, since hover is driven by
 * queryRenderedFeatures against this layer.
 */
export function interactionFilter(
  mapFilter: maplibregl.FilterSpecification,
  gateField: string | undefined
): maplibregl.FilterSpecification {
  if (!gateField) return mapFilter;
  return ["all", mapFilter, ["==", ["get", gateField], true]] as
    maplibregl.FilterSpecification;
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

export const circleColorExpr: ExpressionSpecification = [
  "match",
  ["get", "risk_tier"],
  "Critical", RISK_TIER_COLORS.Critical,
  "High", RISK_TIER_COLORS.High,
  "Moderate", RISK_TIER_COLORS.Moderate,
  "Low", RISK_TIER_COLORS.Low,
  "#6B7280",
];

/** Colour ramp for the blind imagery safety score (0 hostile → 100 protected). */
export const IMAGERY_COLOR_EXPR: ExpressionSpecification = [
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
): ExpressionSpecification {
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
  ] as unknown as ExpressionSpecification;
}

export function pointColorExpr(layerMode: string): ExpressionSpecification {
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
): ExpressionSpecification {
  const step: unknown[] = ["step", ["to-number", ["get", field], 0], ramp[0]];
  breaks.forEach((b, i) => step.push(b, ramp[i + 1]));
  // Variadic `step` cannot be expressed in MapLibre's tuple types.
  return step as unknown as ExpressionSpecification;
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
): ExpressionSpecification {
  const grey = noDataColor(basemap);

  if (layerMode === "casualties") {
    return [
      "case",
      ["!", ["get", "has_covariates"]],
      grey,
      // Per 10,000 walking + public-transport trips, not per km²: area is
      // not exposure (24 Aug 2026).
      stepExpr("casualties_per_10k_trips", TRIP_RATE_BREAKS, CASUALTY_DENSITY_RAMP),
    ] as ExpressionSpecification;
  }

  // Bogotá: observed minus the offset model's expectation. Gated on
  // has_expected (770 of 879 zones); a zone the model could not fit is grey,
  // not "average".
  if (layerMode === "excess_casualties") {
    return [
      "case",
      ["!", ["get", "has_expected"]],
      grey,
      stepExpr("excess_casualties", ZAT_EXCESS_BREAKS, ZAT_EXCESS_RAMP),
    ] as ExpressionSpecification;
  }

  if (layerMode === "age60") {
    return [
      "case",
      ["!", ["get", "has_pop60"]],
      grey,
      stepExpr("pct60plus", PCT60_BREAKS, PCT60_RAMP),
    ] as ExpressionSpecification;
  }

  // Philadelphia tracts. Excess is signed, so the step starts in the blue
  // arm; `["to-number", ..., 0]` would put a null in the neutral middle bin,
  // which is why the gate on has_model comes first.
  if (layerMode === "excess") {
    return [
      "case",
      ["!", ["get", "has_model"]],
      grey,
      stepExpr("excess_ksi", TRACT_EXCESS_BREAKS, TRACT_EXCESS_RAMP),
    ] as ExpressionSpecification;
  }

  // Observed KSI has no gate: a tract with no crashes has a count of ZERO,
  // which is a value, not missing (has_crashes is false for exactly the 66
  // tracts with ped_ksi = 0). Greying them would paint zero as no data.
  if (layerMode === "observed") {
    return stepExpr("ped_ksi", TRACT_OBSERVED_BREAKS, TRACT_OBSERVED_RAMP);
  }

  if (layerMode === "poverty") {
    return [
      "case",
      ["!", ["get", "has_pov"]],
      grey,
      stepExpr("pct_pov", TRACT_POVERTY_BREAKS, TRACT_POVERTY_RAMP),
    ] as ExpressionSpecification;
  }

  if (layerMode === "age65") {
    return [
      "case",
      ["!", ["get", "has_age"]],
      grey,
      stepExpr("pct_65plus", TRACT_AGE_BREAKS, TRACT_AGE_RAMP),
    ] as ExpressionSpecification;
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
  ] as ExpressionSpecification;
}

/**
 * No-data zones are drawn fainter as well as greyer. A zone with no data must
 * not occupy a legible position on the ramp; "absent" needs its own visual
 * grammar, not the palest value.
 */
export function polygonFillOpacity(
  gateField: string | undefined
): ExpressionSpecification | number {
  if (!gateField) return 0.72;
  return ["case", ["!", ["get", gateField]], 0.3, 0.72] as ExpressionSpecification;
}

// ---------------------------------------------------------------------------
// Philadelphia — segment (line) paint
// ---------------------------------------------------------------------------

/**
 * Segment ramps. The RAMPS are shared; the BREAKS are not — they come from the
 * dataset, because each city's SPF is a different model on a different scale.
 *
 * The break arrays used to be module constants applied to every line dataset,
 * alongside hardcoded `mu_per_mile` and `ped_ksi_seg` property reads. Bogotá
 * emits `mu_per_km` and `ped_crashes_seg`, so its choropleth was stepping a
 * missing property and collapsing the whole network into the first ramp
 * colour, while the legend beside it advertised Bogotá's cut-points. Nothing
 * threw. Field names and breaks now both arrive from SegmentFieldConfig.
 */
/** Layer opacity for line datasets. Constant across the gate — see NO_DATA_LINE. */
export const LINE_OPACITY = 0.9;
export const LINE_FILL_OPACITY = 0.75;

export const SEG_SPF_RAMP = [
  "#FEF0D9", "#FDD49E", "#FDBB84", "#FC8D59", "#E34A33", "#B30000",
];
export const SEG_OBSERVED_RAMP = [
  "#FEE5D9", "#FCAE91", "#FB6A4A", "#DE2D26", "#A50F15",
];
export const SEG_AADT_BREAKS = [2000, 6000, 12000, 25000];
export const SEG_AADT_RAMP = [
  "#EFF3FF", "#BDD7E7", "#6BAED6", "#3182BD", "#08519C",
];

export function lineColorExpr(
  layerMode: string,
  basemap: BasemapMode,
  seg: SegmentFieldConfig
): ExpressionSpecification {
  // Full-opacity no-data colour. See NO_DATA_LINE: the gated-out features used
  // to be dimmed to 0.28 as well as greyed, which put them at 1.13:1 against
  // the basemap and made a mode where 98.5% of segments have no value look
  // like a failed render.
  const grey = basemap === "dark" ? NO_DATA_LINE_DARK : NO_DATA_LINE;

  if (layerMode === "observed") {
    return ["case", ["!", ["get", "has_crashes"]], grey,
      stepExpr(seg.outcomeField, seg.observedBreaks, SEG_OBSERVED_RAMP),
    ] as ExpressionSpecification;
  }
  if (layerMode === "aadt") {
    // Gated on has_aadt, not on the value: two thirds of segments carry
    // PennDOT's nominal 300 placeholder, and colouring those would assert a
    // traffic count that was never taken.
    return ["case", ["!", ["get", "has_aadt"]], grey,
      stepExpr("aadt", SEG_AADT_BREAKS, SEG_AADT_RAMP),
    ] as ExpressionSpecification;
  }
  return ["case", ["!", ["get", "has_model"]], grey,
    stepExpr(seg.rateField, seg.spfBreaks, SEG_SPF_RAMP),
  ] as ExpressionSpecification;
}

/**
 * Line width by road class, interpolated over zoom.
 *
 * The class term is baked into each zoom stop rather than multiplied over the
 * interpolate. MapLibre rejects a zoom expression used as anything but the
 * direct input to a top-level step/interpolate — the same rule that made the
 * old `["+", radiusExpr, 3]` hover radius fail silently and leave the point
 * hover layer missing entirely.
 */
function classWidth(scale: number, bump: number): unknown[] {
  return [
    "match", ["get", "class"],
    2, 2.4 * scale + bump,   // arterial
    3, 1.8 * scale + bump,   // collector
    4, 1.1 * scale + bump,   // local
    5, 0.8 * scale + bump,   // minor local
    1.0 * scale + bump,
  ];
}

export function lineWidthExpr(bump = 0): ExpressionSpecification {
  return [
    "interpolate", ["linear"], ["zoom"],
    10, classWidth(0.45, bump),
    14, classWidth(1.0, bump),
    17, classWidth(2.2, bump),
  ] as unknown as ExpressionSpecification;
}

/**
 * Outline width for a polygon-geometry dataset, in PIXELS and independent of
 * road class.
 *
 * The class-scaled width above is right for a LineString network, where the
 * stroke IS the street and its thickness encodes hierarchy. Here the polygon
 * already carries the true width, so the stroke's only job is to keep the
 * network visible when the footprint goes sub-pixel — which at ~6 m wide it
 * does below roughly z15. A flat ramp guarantees that: nothing falls under
 * 0.75 px at city zoom, regardless of class.
 */
export function polygonOutlineWidthExpr(
  bump = 0
): ExpressionSpecification {
  return [
    "interpolate", ["linear"], ["zoom"],
    10, 0.75 + bump,
    13, 1.5 + bump,
    16, 3 + bump,
  ] as ExpressionSpecification;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface UnitLayerOptions {
  dataset: DatasetConfig;
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
  // Idempotent: a style swap, a city swap and a dataset swap all land here.
  removeUnitLayers(map);

  map.addSource(SOURCE_ID, {
    type: "geojson",
    data: o.data,
    // Currently unread — nothing in this codebase uses feature-state; hover is
    // done by swapping a duplicate layer's filter. Kept because it is now
    // correct per dataset and is the prerequisite for moving to feature-state
    // if line or polygon hover ever costs a frame.
    promoteId: o.dataset.idField,
  });

  // Read the discriminant into a local first. DatasetConfig is a union now, so
  // switching on `o.dataset.unitType` narrows `o.dataset` itself to `never` in
  // the default arm and the exhaustiveness check no longer compiles.
  const kind = o.dataset.unitType;
  switch (kind) {
    case "polygon": addPolygonLayers(map, o); return;
    case "line": addLineLayers(map, o); return;
    case "point": addPointLayers(map, o); return;
    default: assertNever(kind, "unit type");
  }
}

function addPointLayers(map: maplibregl.Map, o: UnitLayerOptions): void {
  const { dataset, basemap, layerMode, mapFilter, selectedId } = o;
  const radius = pointRadiusExpr(layerMode);
  const color = pointColorExpr(layerMode);
  const ring = basemap === "dark" ? "#2A8F64" : "#1B6B4A";
  const sel = selectedId !== null ? matchId(dataset.idField, selectedId) : matchNothing(dataset.idField);

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
    filter: matchNothing(dataset.idField),
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
  const { dataset, basemap, layerMode, gateField, mapFilter, selectedId } = o;
  const ring = basemap === "dark" ? "#5EEAD4" : "#1B6B4A";
  const sel = selectedId !== null ? matchId(dataset.idField, selectedId) : matchNothing(dataset.idField);

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
    filter: matchNothing(dataset.idField),
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

function addLineLayers(map: maplibregl.Map, o: UnitLayerOptions): void {
  const { dataset, basemap, layerMode, gateField, mapFilter, selectedId } = o;
  const ring = basemap === "dark" ? "#5EEAD4" : "#1B6B4A";
  const sel = selectedId !== null
    ? matchId(dataset.idField, selectedId)
    : matchNothing(dataset.idField);
  // addLineLayers is only reached for unitType "line", but the narrowing has to
  // be explicit for `dataset.segment` to be reachable.
  if (dataset.unitType !== "line") return;
  const poly = !!dataset.polygonGeometry;
  const colour = lineColorExpr(layerMode, basemap, dataset.segment);
  const width = poly ? polygonOutlineWidthExpr : lineWidthExpr;

  // Fill first, so the outline draws on top of it. Only for datasets whose
  // geometry is polygons: a fill layer over LineString data renders nothing,
  // so Philadelphia does not get one. At city zoom the footprint is sub-pixel
  // and contributes nothing; from about z15 it carries the true street shape.
  if (poly) {
    map.addLayer({
      id: LINE_FILL_LAYER_ID,
      type: "fill",
      source: SOURCE_ID,
      paint: {
        // Constant. The gate is expressed in the COLOUR, not in opacity —
        // dimming a no-data feature on top of greying it made it invisible.
        "fill-color": colour,
        "fill-opacity": LINE_FILL_OPACITY,
        "fill-antialias": true,
      },
      filter: mapFilter,
    });
  }

  map.addLayer({
    id: LINE_LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": colour,
      "line-width": width(),
      // Constant, for the reason above: "absent" needs its own visual grammar,
      // and that grammar is a distinct colour, not a fade.
      "line-opacity": LINE_OPACITY,
    },
    filter: mapFilter,
  });

  // A 2 px line is effectively unclickable. This invisible wide line sits above
  // it purely as a hit target — opacity 0 still hit-tests, whereas
  // visibility:"none" would not.
  map.addLayer({
    id: LINE_HIT_LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    paint: { "line-color": "#000000", "line-opacity": 0, "line-width": 14 },
    filter: interactionFilter(mapFilter, gateField),
  });

  map.addLayer({
    id: LINE_HOVER_LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": basemap === "dark" ? "#ffffff" : "#1B6B4A",
      "line-width": width(2.5),
      "line-opacity": 0.55,
    },
    filter: matchNothing(dataset.idField),
  });

  map.addLayer({
    id: LINE_SELECTED_GLOW_ID,
    type: "line",
    source: SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ring, "line-width": 10, "line-opacity": 0.3, "line-blur": 2 },
    filter: sel,
  });

  map.addLayer({
    id: LINE_SELECTED_ID,
    type: "line",
    source: SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ring, "line-width": width(1.5), "line-opacity": 1 },
    filter: sel,
  });
}

/** Repaint in place on a layer-mode change, without rebuilding the stack. */
export function applyLayerMode(map: maplibregl.Map, o: UnitLayerOptions): void {
  if (o.dataset.unitType === "polygon") {
    if (!map.getLayer(FILL_LAYER_ID)) return;
    map.setPaintProperty(FILL_LAYER_ID, "fill-color", polygonFillColor(o.layerMode, o.basemap));
    map.setPaintProperty(FILL_LAYER_ID, "fill-opacity", polygonFillOpacity(o.gateField));
    return;
  }
  if (o.dataset.unitType === "line") {
    if (!map.getLayer(LINE_LAYER_ID)) return;
    const colour = lineColorExpr(o.layerMode, o.basemap, o.dataset.segment);
    map.setPaintProperty(LINE_LAYER_ID, "line-color", colour);
    if (map.getLayer(LINE_FILL_LAYER_ID)) {
      map.setPaintProperty(LINE_FILL_LAYER_ID, "fill-color", colour);
      map.setPaintProperty(LINE_FILL_LAYER_ID, "fill-opacity", LINE_FILL_OPACITY);
    }
    // Opacity no longer varies with the gate — the colour carries it. Both are
    // still reset here so a mode change cannot leave a stale expression behind.
    map.setPaintProperty(LINE_LAYER_ID, "line-opacity", LINE_OPACITY);
    // The gate changes with the mode, so what is clickable changes too.
    if (map.getLayer(LINE_HIT_LAYER_ID)) {
      map.setFilter(LINE_HIT_LAYER_ID, interactionFilter(o.mapFilter, o.gateField));
    }
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
