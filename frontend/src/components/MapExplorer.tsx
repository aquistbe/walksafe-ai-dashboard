"use client";

/**
 * MapExplorer — Interactive MapLibre GL JS map for the WalkSafe-AI dashboard.
 *
 * Renders Philadelphia intersections as color-coded circles by risk tier,
 * supports click-to-select, hover popups, layer toggling, and a legend.
 *
 * Base style: CARTO Positron (free, no token required).
 * Dependencies: maplibre-gl (in package.json)
 */

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { IntersectionCollection, FilterState, RiskTier } from "@/lib/types";
import {
  MAP_STYLE_URL,
  PHILADELPHIA_CENTER,
  PHILADELPHIA_ZOOM,
  PHILADELPHIA_BOUNDS,
  RISK_TIER_COLORS,
  RISK_TIER_LABELS,
  RISK_TIER_RADIUS,
  RISK_TIERS,
} from "@/lib/constants";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_ID = "intersections";
const CIRCLE_LAYER_ID = "intersections-circles";
const CIRCLE_HOVER_LAYER_ID = "intersections-circles-hover";
const SELECTED_LAYER_ID = "intersections-selected";
const SELECTED_PULSE_LAYER_ID = "intersections-selected-pulse";

const STYLE_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const STYLE_LIGHT = MAP_STYLE_URL;

type LayerMode = "risk" | "crashes" | "imagery";
type BasemapMode = "light" | "dark";

/** Colour ramp for the blind imagery safety score (0 hostile → 100 protected). */
const IMAGERY_COLOR_EXPR: maplibregl.ExpressionSpecification = [
  "case",
  ["!", ["has", "img_score"]],
  "#E5E7EB", // not scored
  [
    "interpolate",
    ["linear"],
    ["to-number", ["get", "img_score"], 50],
    0,
    "#7F1D1D",
    25,
    "#C44536",
    50,
    "#D4820A",
    75,
    "#65A30D",
    100,
    "#1B6B4A",
  ],
];

// Empty GeoJSON used as initial / fallback source data
const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MapExplorerProps {
  /** FULL, unfiltered collection. Uploaded to the map once; filtering is done
   *  GPU-side via `setFilter` so large filter changes stay instant. */
  geojson: IntersectionCollection | null;
  filters: FilterState;
  selectedNodeId: number | null;
  onSelectIntersection: (nodeId: number | null) => void;
  loading?: boolean;
  /** Counts per tier AFTER filtering, for the legend. */
  tierCounts?: Record<RiskTier, number>;
}

// ---------------------------------------------------------------------------
// Translate FilterState into a MapLibre filter expression
// ---------------------------------------------------------------------------

/** Fields that are null for most rows — coalesce to 0 before comparing. */
const num = (field: string): maplibregl.ExpressionSpecification => [
  "coalesce",
  ["to-number", ["get", field], 0],
  0,
];

function buildMapFilter(
  filters: FilterState,
  searchIds: number[] | null
): maplibregl.FilterSpecification {
  const conds: unknown[] = ["all"];

  // Risk tiers (skip when all four selected — no-op)
  if (filters.riskTiers.length > 0 && filters.riskTiers.length < 4) {
    conds.push(["in", ["get", "risk_tier"], ["literal", filters.riskTiers]]);
  } else if (filters.riskTiers.length === 0) {
    return ["==", ["get", "node_id"], -1] as maplibregl.FilterSpecification;
  }

  // EB KSI score range
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MapExplorer({
  geojson,
  filters,
  selectedNodeId,
  onSelectIntersection,
  loading = false,
  tierCounts: tierCountsProp,
}: MapExplorerProps) {
  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const hoveredIdRef = useRef<number | null>(null);
  /** Latest geojson, readable from inside the map `load` handler closure. */
  const geojsonRef = useRef<IntersectionCollection | null>(geojson);
  geojsonRef.current = geojson;

  // State
  // Counter (not a boolean) so React StrictMode's double-mount — which destroys
  // and recreates the map — always re-triggers the data effect below.
  const [mapVersion, setMapVersion] = useState(0);
  const mapReady = mapVersion > 0;
  const [layerMode, setLayerMode] = useState<LayerMode>("risk");
  const [basemap, setBasemap] = useState<BasemapMode>("light");

  // Derived: count by tier for legend (parent supplies filtered counts)
  const tierCounts = useMemo(() => {
    if (tierCountsProp) return tierCountsProp;
    const counts: Record<RiskTier, number> = {
      Critical: 0,
      High: 0,
      Moderate: 0,
      Low: 0,
    };
    if (geojson) {
      for (const f of geojson.features) {
        counts[f.properties.risk_tier]++;
      }
    }
    return counts;
  }, [geojson, tierCountsProp]);

  // Node ids matching the search query (null when no query is active)
  const searchIds = useMemo(() => {
    const q = filters.searchQuery.trim().toLowerCase();
    if (!q || !geojson) return null;
    const ids: number[] = [];
    for (const f of geojson.features) {
      if (f.properties.int_name?.toLowerCase().includes(q)) {
        ids.push(f.properties.node_id);
      }
    }
    return ids;
  }, [filters.searchQuery, geojson]);

  // MapLibre filter expression — recomputed only when filters actually change
  const mapFilter = useMemo(
    () => buildMapFilter(filters, searchIds),
    [filters, searchIds]
  );

  // ------------------------------------------------------------------
  // Build circle-color and circle-radius expressions
  // ------------------------------------------------------------------

  const circleColorExpr: maplibregl.ExpressionSpecification = [
    "match",
    ["get", "risk_tier"],
    "Critical",
    RISK_TIER_COLORS.Critical,
    "High",
    RISK_TIER_COLORS.High,
    "Moderate",
    RISK_TIER_COLORS.Moderate,
    "Low",
    RISK_TIER_COLORS.Low,
    "#6B7280", // fallback
  ];

  // Base radius by tier, scaled down when zoomed out to cut GPU overdraw
  // across ~17k points.
  const circleRadiusExprRisk: maplibregl.ExpressionSpecification = [
    "interpolate",
    ["linear"],
    ["zoom"],
    10,
    [
      "*",
      0.45,
      [
        "match",
        ["get", "risk_tier"],
        "Critical",
        RISK_TIER_RADIUS.Critical,
        "High",
        RISK_TIER_RADIUS.High,
        "Moderate",
        RISK_TIER_RADIUS.Moderate,
        "Low",
        RISK_TIER_RADIUS.Low,
        3,
      ],
    ],
    14,
    [
      "match",
      ["get", "risk_tier"],
      "Critical",
      RISK_TIER_RADIUS.Critical,
      "High",
      RISK_TIER_RADIUS.High,
      "Moderate",
      RISK_TIER_RADIUS.Moderate,
      "Low",
      RISK_TIER_RADIUS.Low,
      3,
    ],
  ];

  const circleRadiusExprCrashes: maplibregl.ExpressionSpecification = [
    "interpolate",
    ["linear"],
    ["get", "ped_ksi"],
    0,
    3,
    2,
    5,
    5,
    8,
    10,
    12,
  ];

  // ------------------------------------------------------------------
  // Initialize map
  // ------------------------------------------------------------------

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_LIGHT,
      center: PHILADELPHIA_CENTER,
      zoom: PHILADELPHIA_ZOOM,
      maxBounds: [
        [PHILADELPHIA_BOUNDS[0] - 0.1, PHILADELPHIA_BOUNDS[1] - 0.05],
        [PHILADELPHIA_BOUNDS[2] + 0.1, PHILADELPHIA_BOUNDS[3] + 0.05],
      ],
      attributionControl: false,
    });

    // Controls
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: true }),
      "top-right"
    );
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 150 }), "bottom-right");
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right"
    );

    // Persistent popup for hover
    popupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      maxWidth: "280px",
      offset: 12,
    });

    map.on("load", () => {
      // Seed with whatever data has already arrived; the effect below keeps it
      // in sync afterwards.
      const initialData =
        geojsonRef.current && geojsonRef.current.features.length > 0
          ? (geojsonRef.current as unknown as GeoJSON.FeatureCollection)
          : EMPTY_FC;

      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: initialData,
        promoteId: "node_id",
      });

      // --- Circle layer (main) ---
      map.addLayer({
        id: CIRCLE_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": circleRadiusExprRisk,
          "circle-color": circleColorExpr,
          "circle-opacity": 0.75,
          "circle-stroke-color": "#ffffff",
          // Strokes are expensive across 17k points — fade them in with zoom.
          "circle-stroke-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            11,
            0,
            13.5,
            1,
          ],
          "circle-stroke-opacity": 0.9,
        },
      });

      // --- Hover highlight layer ---
      map.addLayer({
        id: CIRCLE_HOVER_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": ["+", circleRadiusExprRisk, 3],
          "circle-color": circleColorExpr,
          "circle-opacity": 0.4,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
        filter: ["==", "node_id", -1],
      });

      // --- Selected intersection outer ring ---
      map.addLayer({
        id: SELECTED_PULSE_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": 18,
          "circle-color": "transparent",
          "circle-stroke-color": "#1B6B4A",
          "circle-stroke-width": 3,
          "circle-opacity": 0,
          "circle-stroke-opacity": 0.6,
        },
        filter: ["==", "node_id", -1],
      });

      map.addLayer({
        id: SELECTED_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": 12,
          "circle-color": "transparent",
          "circle-stroke-color": "#1B6B4A",
          "circle-stroke-width": 2.5,
          "circle-opacity": 0,
          "circle-stroke-opacity": 1,
        },
        filter: ["==", "node_id", -1],
      });

      setMapVersion((v) => v + 1);
    });

    // --- Hover interactions ---
    map.on("mousemove", CIRCLE_LAYER_ID, (e) => {
      if (!e.features || e.features.length === 0) return;

      map.getCanvas().style.cursor = "pointer";

      const feat = e.features[0];
      const nodeId = feat.properties?.node_id as number;

      if (hoveredIdRef.current !== nodeId) {
        hoveredIdRef.current = nodeId;
        map.setFilter(CIRCLE_HOVER_LAYER_ID, ["==", "node_id", nodeId]);
      }

      // Popup content
      const p = feat.properties!;
      const coords = (feat.geometry as GeoJSON.Point).coordinates.slice() as [
        number,
        number
      ];

      const tierColor =
        RISK_TIER_COLORS[p.risk_tier as RiskTier] ?? "#6B7280";

      const html = `
        <div style="font-family: 'DM Sans', system-ui, sans-serif; font-size: 12px; line-height: 1.5; color: #2D2D2D;">
          <div style="font-weight: 700; font-size: 13px; margin-bottom: 4px;">${p.int_name || "Unknown"}</div>
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
            <span style="display: inline-flex; align-items: center; gap: 4px; background: ${tierColor}18; color: ${tierColor}; font-weight: 600; font-size: 10px; padding: 2px 8px; border-radius: 999px;">
              <span style="width: 6px; height: 6px; border-radius: 50%; background: ${tierColor};"></span>
              ${p.risk_tier} Risk
            </span>
            <span style="color: #9CA3AF; font-size: 10px;">Rank #${p.rank_eb}</span>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; font-size: 11px;">
            <span style="color: #6B7280;">EB KSI:</span>
            <span style="font-weight: 600;">${typeof p.eb_ksi === "number" ? p.eb_ksi.toFixed(2) : p.eb_ksi}</span>
            <span style="color: #6B7280;">KSI crashes:</span>
            <span style="font-weight: 600;">${p.ped_ksi}</span>
            <span style="color: #6B7280;">Total ped:</span>
            <span style="font-weight: 600;">${p.ped_crashes}</span>
            ${p.on_hin ? '<span style="color: #6B7280;">HIN:</span><span style="font-weight: 600; color: #C44536;">On HIN</span>' : ""}
          </div>
        </div>
      `;

      popupRef.current?.setLngLat(coords).setHTML(html).addTo(map);
    });

    map.on("mouseleave", CIRCLE_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
      hoveredIdRef.current = null;
      map.setFilter(CIRCLE_HOVER_LAYER_ID, ["==", "node_id", -1]);
      popupRef.current?.remove();
    });

    // --- Click ---
    map.on("click", CIRCLE_LAYER_ID, (e) => {
      if (!e.features || e.features.length === 0) return;
      const nodeId = e.features[0].properties?.node_id as number;
      onSelectIntersection(nodeId);
    });

    // Click on empty space to deselect
    map.on("click", (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [CIRCLE_LAYER_ID],
      });
      if (features.length === 0) {
        onSelectIntersection(null);
      }
    });

    mapRef.current = map;

    return () => {
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------
  // Update GeoJSON data when features change
  // ------------------------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    if (geojson && geojson.features.length > 0) {
      source.setData(geojson as unknown as GeoJSON.FeatureCollection);
    } else {
      source.setData(EMPTY_FC);
    }
  }, [geojson, mapVersion, mapReady]);

  // ------------------------------------------------------------------
  // Apply filters GPU-side (no data re-upload)
  // ------------------------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getLayer(CIRCLE_LAYER_ID)) return;
    map.setFilter(CIRCLE_LAYER_ID, mapFilter);
  }, [mapFilter, mapVersion, mapReady]);

  // ------------------------------------------------------------------
  // Update selected intersection highlight
  // ------------------------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (selectedNodeId !== null) {
      map.setFilter(SELECTED_LAYER_ID, ["==", "node_id", selectedNodeId]);
      map.setFilter(SELECTED_PULSE_LAYER_ID, ["==", "node_id", selectedNodeId]);

      // Fly to selected intersection
      if (geojson) {
        const feat = geojson.features.find(
          (f) => f.properties.node_id === selectedNodeId
        );
        if (feat) {
          map.flyTo({
            center: feat.geometry.coordinates as [number, number],
            zoom: Math.max(map.getZoom(), 14),
            duration: 800,
          });
        }
      }
    } else {
      map.setFilter(SELECTED_LAYER_ID, ["==", "node_id", -1]);
      map.setFilter(SELECTED_PULSE_LAYER_ID, ["==", "node_id", -1]);
    }
  }, [selectedNodeId, mapVersion, mapReady, geojson]);

  // ------------------------------------------------------------------
  // Update circle radius based on layer mode
  // ------------------------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getLayer(CIRCLE_LAYER_ID)) return;

    const radiusExpr =
      layerMode === "crashes" ? circleRadiusExprCrashes : circleRadiusExprRisk;

    map.setPaintProperty(CIRCLE_LAYER_ID, "circle-radius", radiusExpr);
    map.setPaintProperty(CIRCLE_HOVER_LAYER_ID, "circle-radius", [
      "+",
      radiusExpr,
      3,
    ]);

    // Colour by imagery score in imagery mode, by risk tier otherwise.
    const colorExpr =
      layerMode === "imagery" ? IMAGERY_COLOR_EXPR : circleColorExpr;
    map.setPaintProperty(CIRCLE_LAYER_ID, "circle-color", colorExpr);
    map.setPaintProperty(CIRCLE_HOVER_LAYER_ID, "circle-color", colorExpr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerMode, mapVersion, mapReady]);

  // ------------------------------------------------------------------
  // Switch basemap
  // ------------------------------------------------------------------

  const switchBasemap = useCallback(
    (mode: BasemapMode) => {
      const map = mapRef.current;
      if (!map || !mapReady) return;
      if (mode === basemap) return;

      setBasemap(mode);

      const styleUrl = mode === "dark" ? STYLE_DARK : STYLE_LIGHT;

      // Save current data so we can restore layers after style swap
      const currentData: GeoJSON.FeatureCollection =
        geojson && geojson.features.length > 0
          ? (geojson as unknown as GeoJSON.FeatureCollection)
          : EMPTY_FC;

      map.setStyle(styleUrl);

      map.once("style.load", () => {
        // Re-add source and layers
        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: currentData,
          promoteId: "node_id",
        });

        const radiusExpr =
          layerMode === "crashes"
            ? circleRadiusExprCrashes
            : circleRadiusExprRisk;

        map.addLayer({
          id: CIRCLE_LAYER_ID,
          type: "circle",
          source: SOURCE_ID,
          paint: {
            "circle-radius": radiusExpr,
            "circle-color": circleColorExpr,
            "circle-opacity": 0.75,
            "circle-stroke-color": mode === "dark" ? "#374151" : "#ffffff",
            "circle-stroke-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              11,
              0,
              13.5,
              1,
            ],
            "circle-stroke-opacity": 0.9,
          },
          filter: mapFilter,
        });

        map.addLayer({
          id: CIRCLE_HOVER_LAYER_ID,
          type: "circle",
          source: SOURCE_ID,
          paint: {
            "circle-radius": ["+", radiusExpr, 3],
            "circle-color": circleColorExpr,
            "circle-opacity": 0.4,
            "circle-stroke-color": mode === "dark" ? "#9CA3AF" : "#ffffff",
            "circle-stroke-width": 2,
          },
          filter: ["==", "node_id", -1],
        });

        map.addLayer({
          id: SELECTED_PULSE_LAYER_ID,
          type: "circle",
          source: SOURCE_ID,
          paint: {
            "circle-radius": 18,
            "circle-color": "transparent",
            "circle-stroke-color": mode === "dark" ? "#2A8F64" : "#1B6B4A",
            "circle-stroke-width": 3,
            "circle-opacity": 0,
            "circle-stroke-opacity": 0.6,
          },
          filter:
            selectedNodeId !== null
              ? ["==", "node_id", selectedNodeId]
              : ["==", "node_id", -1],
        });

        map.addLayer({
          id: SELECTED_LAYER_ID,
          type: "circle",
          source: SOURCE_ID,
          paint: {
            "circle-radius": 12,
            "circle-color": "transparent",
            "circle-stroke-color": mode === "dark" ? "#2A8F64" : "#1B6B4A",
            "circle-stroke-width": 2.5,
            "circle-opacity": 0,
            "circle-stroke-opacity": 1,
          },
          filter:
            selectedNodeId !== null
              ? ["==", "node_id", selectedNodeId]
              : ["==", "node_id", -1],
        });
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [basemap, mapReady, geojson, layerMode, selectedNodeId, mapFilter]
  );

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div className="relative w-full h-full">
      {/* Map container */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 bg-walksafe-bg/60 backdrop-blur-sm z-30 flex items-center justify-center">
          <div className="text-center">
            <div className="w-10 h-10 mx-auto mb-3 rounded-full border-2 border-walksafe-green/30 border-t-walksafe-green animate-spin" />
            <p className="text-sm font-medium text-walksafe-text">
              Loading map data...
            </p>
          </div>
        </div>
      )}

      {/* Toolbar — top left */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-white/95 backdrop-blur-sm rounded-lg shadow-md border border-gray-200 p-1">
        <ToolbarButton
          active={layerMode === "risk"}
          onClick={() => setLayerMode("risk")}
          title="Size circles by risk tier"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="6" />
            <circle cx="12" cy="12" r="2" />
          </svg>
          <span>Risk Tiers</span>
        </ToolbarButton>

        <ToolbarButton
          active={layerMode === "crashes"}
          onClick={() => setLayerMode("crashes")}
          title="Size circles by KSI crash count"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2v20M2 12h20" />
            <circle cx="12" cy="12" r="4" />
          </svg>
          <span>Crash Count</span>
        </ToolbarButton>

        <ToolbarButton
          active={layerMode === "imagery"}
          onClick={() => setLayerMode("imagery")}
          title="Colour by blind imagery safety score"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <span>Imagery</span>
        </ToolbarButton>

        <div className="w-px h-5 bg-gray-200 mx-0.5" />

        <ToolbarButton
          active={basemap === "dark"}
          onClick={() => switchBasemap(basemap === "dark" ? "light" : "dark")}
          title="Toggle dark basemap"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
          <span>Dark</span>
        </ToolbarButton>
      </div>

      {/* Legend — bottom left */}
      <div className="absolute bottom-14 left-3 z-10 bg-white/95 backdrop-blur-sm rounded-lg shadow-md border border-gray-200 p-3 min-w-[160px]">
        {layerMode === "imagery" ? (
          <>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Imagery Safety Score
            </div>
            <div
              className="h-2.5 rounded-full mb-1.5"
              style={{
                background:
                  "linear-gradient(to right, #7F1D1D, #C44536, #D4820A, #65A30D, #1B6B4A)",
              }}
            />
            <div className="flex justify-between text-[10px] text-gray-400 mb-2">
              <span>0 hostile</span>
              <span>100 protected</span>
            </div>
            <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: "#E5E7EB" }}
              />
              <span className="text-[11px] text-walksafe-text-muted">
                Not yet scored
              </span>
            </div>
            <p className="text-[10px] text-gray-400 mt-2 leading-snug">
              Scored from street imagery only — the model never saw crash data.
            </p>
          </>
        ) : (
        <>
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Risk Tier
        </div>
        <div className="space-y-1.5">
          {RISK_TIERS.map((tier) => (
            <div key={tier} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: RISK_TIER_COLORS[tier] }}
                />
                <span className="text-xs text-walksafe-text">
                  {RISK_TIER_LABELS[tier]}
                </span>
              </div>
              <span className="text-[10px] tabular-nums text-gray-400 font-medium">
                {tierCounts[tier].toLocaleString()}
              </span>
            </div>
          ))}
        </div>

        {/* Radius legend when in crash count mode */}
        {layerMode === "crashes" && (
          <>
            <div className="mt-3 pt-2 border-t border-gray-100">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Circle Size = KSI Count
              </div>
              <div className="flex items-end gap-2 px-1">
                {[3, 5, 8, 12].map((r, i) => (
                  <div
                    key={i}
                    className="flex flex-col items-center gap-0.5"
                  >
                    <div
                      className="rounded-full bg-gray-300"
                      style={{ width: r * 2, height: r * 2 }}
                    />
                    <span className="text-[9px] text-gray-400">
                      {[0, 2, 5, 10][i]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
        </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar button sub-component
// ---------------------------------------------------------------------------

function ToolbarButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`
        flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium
        transition-colors duration-150
        ${
          active
            ? "bg-walksafe-green text-white shadow-sm"
            : "text-gray-600 hover:bg-gray-100 hover:text-walksafe-text"
        }
      `}
    >
      {children}
    </button>
  );
}
