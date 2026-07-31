"use client";

/**
 * MapExplorer — MapLibre GL JS map for the WalkSafe-AI dashboard.
 *
 * Renders an "analysis unit" layer whose shape comes from the city config:
 * Philadelphia intersections as circles, Bogotá ZAT zones as a choropleth.
 * Layer construction lives in ./map/layers.ts so the load handler and the
 * basemap-swap handler share one builder.
 *
 * Base style: CARTO Positron / Dark Matter (free, no token required).
 */

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { UnitCollection, UnitFeature, FilterState } from "@/lib/types";
import { isSegmentFeature, isZatFeature } from "@/lib/types";
import type { CityConfig, DatasetConfig } from "@/lib/cities";
import { MAP_STYLE_URL } from "@/lib/constants";
import { buildMapFilter, searchMatchIds } from "@/lib/filters";
import { featureBounds } from "@/lib/geo";
import {
  addUnitLayers,
  applyLayerMode,
  EMPTY_FC,
  SOURCE_ID,
  CIRCLE_LAYER_ID,
  FILL_LAYER_ID,
  LINE_HIT_LAYER_ID,
  filterableLayerIds,
  interactionFilter,
  hoverLayerId,
  interactiveLayerId,
  selectionLayerIds,
  type BasemapMode,
  type UnitLayerOptions,
} from "./map/layers";
import { buildPopupHtml } from "./map/popup";
import Legend, { type LegendCounts } from "./map/Legend";
import { matchId, matchNothing } from "@/lib/filters";

const STYLE_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const STYLE_LIGHT = MAP_STYLE_URL;

interface MapExplorerProps {
  city: CityConfig;
  dataset: DatasetConfig;
  onSelectDataset: (id: string) => void;
  /** FULL, unfiltered collection. Filtering is GPU-side via setFilter. */
  collection: UnitCollection | null;
  featureIndex: ReadonlyMap<number, UnitFeature>;
  filters: FilterState;
  selectedId: number | null;
  onSelectUnit: (id: number | null) => void;
  loading?: boolean;
  legendCounts: LegendCounts;
}

export default function MapExplorer({
  city,
  dataset,
  onSelectDataset,
  collection,
  featureIndex,
  filters,
  selectedId,
  onSelectUnit,
  loading = false,
  legendCounts,
}: MapExplorerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const hoveredIdRef = useRef<number | null>(null);

  const [mapVersion, setMapVersion] = useState(0);
  const mapReady = mapVersion > 0;
  const [layerMode, setLayerMode] = useState<string>(dataset.defaultLayerMode);
  const [basemap, setBasemap] = useState<BasemapMode>("light");

  const gateField = useMemo(
    () => dataset.layerModes.find((m) => m.id === layerMode)?.gateField,
    [dataset, layerMode]
  );

  const searchIds = useMemo(
    () => (collection ? searchMatchIds(collection.features as UnitFeature[], filters.searchQuery) : null),
    [collection, filters.searchQuery]
  );

  const mapFilter = useMemo(
    () => buildMapFilter(filters, searchIds, gateField),
    [filters, searchIds, gateField]
  );

  const data = useMemo(
    () =>
      collection && collection.features.length > 0
        ? (collection as unknown as GeoJSON.FeatureCollection)
        : EMPTY_FC,
    [collection]
  );

  /**
   * Current values, readable from the map's own event handlers.
   *
   * Those handlers are registered once in a []-dep effect, so anything they
   * close over is frozen at mount. That was already true of
   * `onSelectIntersection` and worked only because the parent memoised it with
   * []. It stops working the moment the handler needs to know the city, so
   * every value the handlers need goes through a ref instead.
   */
  const optsRef = useRef<UnitLayerOptions>({
    dataset, data, basemap, layerMode, gateField, mapFilter, selectedId,
  });
  optsRef.current = { dataset, data, basemap, layerMode, gateField, mapFilter, selectedId };

  const onSelectRef = useRef(onSelectUnit);
  onSelectRef.current = onSelectUnit;

  const featureIndexRef = useRef(featureIndex);
  featureIndexRef.current = featureIndex;

  /** Which dataset's layer stack is currently installed on the map. */
  const installedDatasetRef = useRef<string | null>(null);
  const installedCityRef = useRef<string | null>(null);

  const install = useCallback((map: maplibregl.Map) => {
    addUnitLayers(map, optsRef.current);
    installedDatasetRef.current = optsRef.current.dataset.id;
  }, []);

  // ------------------------------------------------------------------
  // Initialise map
  // ------------------------------------------------------------------

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const startCity = city;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_LIGHT,
      center: startCity.center,
      zoom: startCity.zoom,
      maxBounds: startCity.maxBounds,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 150 }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    popupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      maxWidth: "280px",
      offset: 12,
    });

    map.on("load", () => {
      install(map);
      setMapVersion((v) => v + 1);
    });

    // Map-level handlers rather than layer-scoped ones: the interactive layer
    // id changes with the unit type, and a listener bound to "units-circles"
    // would go deaf the moment the city switches to polygons.
    const hitLayers = () =>
      [CIRCLE_LAYER_ID, FILL_LAYER_ID, LINE_HIT_LAYER_ID]
        .filter((id) => map.getLayer(id));

    const clearHover = () => {
      if (hoveredIdRef.current === null) return;
      hoveredIdRef.current = null;
      map.getCanvas().style.cursor = "";
      const hid = hoverLayerId(optsRef.current.dataset);
      if (map.getLayer(hid)) {
        map.setFilter(hid, matchNothing(optsRef.current.dataset.idField));
      }
      popupRef.current?.remove();
    };

    map.on("mousemove", (e) => {
      const layers = hitLayers();
      if (layers.length === 0) return;
      const hits = map.queryRenderedFeatures(e.point, { layers });
      if (hits.length === 0) {
        clearHover();
        return;
      }

      const cfg = optsRef.current.dataset;
      const id = Number(hits[0].properties?.[cfg.idField]);
      if (!Number.isFinite(id)) return;

      map.getCanvas().style.cursor = "pointer";

      // Look the feature up in memory. Nested properties (Bogotá's `rr` and
      // `features`) come back from map events as JSON strings, because
      // MapLibre encodes GeoJSON sources to vector tiles and stringifies any
      // non-primitive on the way.
      const feat = featureIndexRef.current.get(id);
      if (!feat) return;

      if (hoveredIdRef.current !== id) {
        hoveredIdRef.current = id;
        const hid = hoverLayerId(cfg);
        if (map.getLayer(hid)) map.setFilter(hid, matchId(cfg.idField, id));
        // Rebuild the HTML only on change — mousemove fires per pixel, and over
        // a large polygon that would be a continuous re-parse.
        popupRef.current?.setHTML(buildPopupHtml(feat, cfg));
      }

      // Areas and lines anchor under the cursor; a line's first vertex could be
      // far off-screen.
      const anchor: [number, number] =
        isZatFeature(feat) || isSegmentFeature(feat)
          ? [e.lngLat.lng, e.lngLat.lat]
          : (feat.geometry.coordinates.slice() as [number, number]);

      popupRef.current?.setLngLat(anchor).addTo(map);
    });

    map.on("mouseout", clearHover);

    map.on("click", (e) => {
      const layers = hitLayers();
      const hits = layers.length ? map.queryRenderedFeatures(e.point, { layers }) : [];
      if (hits.length === 0) {
        onSelectRef.current(null);
        return;
      }
      const id = Number(hits[0].properties?.[optsRef.current.dataset.idField]);
      onSelectRef.current(Number.isFinite(id) ? id : null);
    });

    mapRef.current = map;

    return () => {
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      installedDatasetRef.current = null;
      installedCityRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------
  // City change: move the camera, then swap the layer stack
  // ------------------------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (installedCityRef.current === city.id) return;
    installedCityRef.current = city.id;

    // Order matters. Applying the new clamp while the camera still sits over
    // the old city makes MapLibre clamp mid-move, and with disjoint bounds the
    // camera can wedge. Release, move, then re-clamp.
    map.setMaxBounds(null);
    map.jumpTo({ center: city.center, zoom: city.zoom });
    map.setMaxBounds(city.maxBounds);
  }, [city, mapVersion, mapReady]);

  /**
   * Dataset change rebuilds the layer stack. The camera does NOT move — same
   * city, same bounds — so switching Intersections/Segments keeps the view.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (installedDatasetRef.current === dataset.id) return;
    popupRef.current?.remove();
    hoveredIdRef.current = null;
    install(map);
  }, [dataset, mapVersion, mapReady, install]);

  /**
   * A layer mode the new dataset does not offer would paint every unit the
   * fallback colour — indistinguishable from a failed load.
   */
  useEffect(() => {
    if (!dataset.layerModes.some((m) => m.id === layerMode)) {
      setLayerMode(dataset.defaultLayerMode);
    }
  }, [dataset, layerMode]);

  // ------------------------------------------------------------------
  // Sync data / filter / selection / paint
  // ------------------------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(data);
  }, [data, mapVersion, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const id of filterableLayerIds()) {
      if (map.getLayer(id)) map.setFilter(id, mapFilter);
    }
    // The click target is narrower than the visible layer: units with no value
    // for the active mode render muted but are not selectable.
    if (map.getLayer(LINE_HIT_LAYER_ID)) {
      map.setFilter(LINE_HIT_LAYER_ID, interactionFilter(mapFilter, gateField));
    }
  }, [mapFilter, gateField, mapVersion, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const ids = selectionLayerIds(dataset);
    const expr = selectedId !== null
      ? matchId(dataset.idField, selectedId)
      : matchNothing(dataset.idField);
    for (const id of ids) {
      if (map.getLayer(id)) map.setFilter(id, expr);
    }

    if (selectedId === null) return;
    const feat = featureIndex.get(selectedId);
    if (!feat) return;

    if (isZatFeature(feat) || isSegmentFeature(feat)) {
      map.fitBounds(featureBounds(feat), {
        // Clear the 384px (w-96) InfoPanel plus its 16px inset on the right.
        padding: { top: 60, bottom: 90, left: 60, right: 420 },
        // Without this a small downtown zone slams to street level.
        maxZoom: 14,
        duration: 800,
      });
    } else {
      map.flyTo({
        center: feat.geometry.coordinates as [number, number],
        zoom: Math.max(map.getZoom(), 14),
        duration: 800,
      });
    }
  }, [selectedId, mapVersion, mapReady, dataset, featureIndex]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    applyLayerMode(map, optsRef.current);
  }, [layerMode, basemap, gateField, mapVersion, mapReady]);

  // ------------------------------------------------------------------
  // Basemap
  // ------------------------------------------------------------------

  const switchBasemap = useCallback(
    (mode: BasemapMode) => {
      const map = mapRef.current;
      if (!map || !mapReady || mode === basemap) return;
      setBasemap(mode);
      // optsRef is stale for one tick — the render carrying the new basemap has
      // not run yet — so hand the new value straight to the rebuild.
      optsRef.current = { ...optsRef.current, basemap: mode };
      map.setStyle(mode === "dark" ? STYLE_DARK : STYLE_LIGHT);
      map.once("style.load", () => install(map));
    },
    [basemap, mapReady, install]
  );

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="absolute inset-0" />

      {loading && (
        <div className="absolute inset-0 bg-walksafe-bg/60 backdrop-blur-sm z-30 flex items-center justify-center">
          <div className="text-center">
            <div className="w-10 h-10 mx-auto mb-3 rounded-full border-2 border-walksafe-green/30 border-t-walksafe-green animate-spin" />
            <p className="text-sm font-medium text-walksafe-text">
              Loading {city.label} data…
            </p>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-white/95 backdrop-blur-sm rounded-lg shadow-md border border-gray-200 p-1">
        {/* Dataset toggle. Deliberately EXCLUSIVE rather than a pair of
            simultaneous layers: intersection and segment risk are not on the
            same scale, and stacking two ramps invites exactly the cross-reading
            that is wrong. Only rendered when the city has more than one. */}
        {city.datasets.length > 1 && (
          <>
            {city.datasets.map((d) => (
              <ToolbarButton
                key={d.id}
                active={dataset.id === d.id}
                onClick={() => onSelectDataset(d.id)}
                title={d.measureLabel}
              >
                <ModeIcon icon={d.unitType === "line" ? "road" : "rings"} />
                <span>{d.label}</span>
              </ToolbarButton>
            ))}
            <div className="w-px h-5 bg-gray-200 mx-0.5" />
          </>
        )}

        {dataset.layerModes.map((m) => (
          <ToolbarButton
            key={m.id}
            active={layerMode === m.id}
            onClick={() => setLayerMode(m.id)}
            title={m.title}
          >
            <ModeIcon icon={m.icon} />
            <span>{m.label}</span>
          </ToolbarButton>
        ))}

        <div className="w-px h-5 bg-gray-200 mx-0.5" />

        <ToolbarButton
          active={basemap === "dark"}
          onClick={() => switchBasemap(basemap === "dark" ? "light" : "dark")}
          title="Toggle dark basemap"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
          <span>Dark</span>
        </ToolbarButton>
      </div>

      {/* Maturity + the ecological caveat. Pinned to the map, non-dismissable:
          a notice that can be dismissed fails the moment someone dismisses it
          and screenshots the map. */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1.5 max-w-[min(560px,calc(100%-2rem))]">
        <span
          className={`px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider shadow-sm border ${
            city.maturity === "demonstrated"
              ? "bg-walksafe-green text-white border-walksafe-green"
              : "bg-white/95 text-gray-600 border-gray-200"
          }`}
          title={city.maturityNote}
        >
          {city.label} · {city.maturityLabel}
        </span>

        {dataset.mapCaveat && (
          <div className="bg-amber-50/95 backdrop-blur-sm border border-amber-200 rounded-lg px-3 py-2 shadow-sm">
            <p className="text-[11px] text-amber-900 leading-snug text-center">
              {dataset.mapCaveat}
            </p>
          </div>
        )}
      </div>

      <Legend dataset={dataset} layerMode={layerMode} counts={legendCounts} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ModeIcon({ icon }: { icon: string }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (icon) {
    case "crosshair":
      return (
        <svg {...common}>
          <path d="M12 2v20M2 12h20" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      );
    case "image":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      );
    case "grid":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case "road":
      return (
        <svg {...common}>
          <path d="M4 21 L9 3" />
          <path d="M20 21 L15 3" />
          <path d="M12 5v3M12 11v3M12 17v3" />
        </svg>
      );
    case "people":
      return (
        <svg {...common}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      );
  }
}

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
