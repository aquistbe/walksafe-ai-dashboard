/**
 * Per-city configuration.
 *
 * The dashboard was built around Philadelphia intersection POINTS. Bogotá's
 * results are ZAT POLYGONS. Rather than force zones into the intersection
 * schema, each city declares its own analysis-unit type and the map picks a
 * rendering path from it.
 *
 * Adding a third city should mean adding an entry here, not branching in
 * components.
 */

export type UnitType = "point" | "polygon";
export type CityId = "philadelphia" | "bogota";

/** One entry in the map's layer-mode toolbar. */
export interface LayerModeConfig {
  id: string;
  label: string;
  title: string;
  icon: "rings" | "crosshair" | "image" | "grid" | "people";
  /**
   * Always-present boolean property that says whether THIS mode's variable was
   * joined for a given unit. Required for every polygon mode.
   *
   * It cannot be inferred from the value itself: MapLibre's `["has", k]`
   * compiles to `k in properties` and returns true for a null-valued key, and
   * `["to-number", ["get", k], fallback]` short-circuits null to 0 before it
   * ever reaches the fallback. Both would silently paint a no-data zone as a
   * real value — the exact failure the handoff doc warns about.
   *
   * The gate differs per mode: 301 zones have no cluster, 358 no crash data,
   * 290 no population. The union flag `has_data` is wrong for all three.
   */
  gateField?: string;
}

export interface CityConfig {
  id: CityId;
  label: string;
  enabled: boolean;

  unitType: UnitType;
  /**
   * Feature property holding the unit id.
   *
   * Philadelphia's `intersections.geojson` cannot be regenerated — its build
   * script points at a sandbox path that no longer exists — so `node_id` is
   * permanent. Bogotá uses the generic `unit_id`.
   */
  idField: string;
  /** Property used for the hover title and text search. */
  nameField: string;
  unitLabel: string;
  unitLabelPlural: string;

  /** Static data path, relative to BASE_PATH. */
  dataUrl: string;
  /** Companion summary file, or null when the collection carries its own. */
  summaryUrl: string | null;
  /** API route used when NEXT_PUBLIC_API_URL is set. */
  apiPath: string;

  center: [number, number];
  zoom: number;
  /** Camera clamp, already padded: [[west, south], [east, north]]. */
  maxBounds: [[number, number], [number, number]];

  layerModes: LayerModeConfig[];
  defaultLayerMode: string;

  /**
   * Research maturity. Bogotá is a completed, published analysis; Philadelphia
   * is a crash-based prototype. Surfacing this stops the city switcher from
   * implying the two are at equal stages.
   */
  maturity: "demonstrated" | "prototype";
  maturityLabel: string;
  maturityNote: string;

  /**
   * Caveat pinned to the map itself, not buried in methods text. Area-level
   * results need this; a choropleth invites exactly the misreading it blocks.
   */
  mapCaveat: string | null;
}

export const CITY_CONFIGS: Record<CityId, CityConfig> = {
  philadelphia: {
    id: "philadelphia",
    label: "Philadelphia",
    enabled: true,

    unitType: "point",
    idField: "node_id",
    nameField: "int_name",
    unitLabel: "intersection",
    unitLabelPlural: "intersections",

    dataUrl: "/data/intersections.geojson",
    summaryUrl: "/data/summary.json",
    apiPath: "/api/intersections",

    center: [-75.1652, 39.9526],
    zoom: 12,
    // The pre-padded form of the ±0.1 / ±0.05 arithmetic that used to live
    // inline in MapExplorer, so the clamp is unchanged.
    maxBounds: [
      [-75.3803, 39.817],
      [-74.8558, 40.188],
    ],

    layerModes: [
      { id: "risk", label: "Risk Tiers", title: "Size circles by risk tier", icon: "rings" },
      { id: "crashes", label: "Crash Count", title: "Size circles by KSI crash count", icon: "crosshair" },
      { id: "imagery", label: "Imagery", title: "Colour by blind imagery safety score", icon: "image" },
    ],
    defaultLayerMode: "risk",

    maturity: "prototype",
    maturityLabel: "Phase 0 prototype",
    maturityNote:
      "Crash-based intersection ranking from PennDOT data, plus one completed " +
      "imagery measurement-validation study. The Senior Pedestrian Mobility " +
      "Index is not built yet — these are not SPMI scores.",
    mapCaveat: null,
  },

  bogota: {
    id: "bogota",
    label: "Bogotá",
    enabled: true,

    unitType: "polygon",
    idField: "unit_id",
    nameField: "unit_name",
    unitLabel: "zone",
    unitLabelPlural: "zones",

    dataUrl: "/data/bogota_zats.geojson",
    summaryUrl: null, // summary lives in the collection's own metadata
    apiPath: "/api/bogota/units",

    // Framed on the urban core. The full extent spans 1.8° × 2.1° because 29
    // rural Sumapaz zones reach far south and east — one is 2,353 km² — so
    // fitting the raw bbox would zoom out past anything useful.
    center: [-74.08, 4.65],
    zoom: 10.5,
    // The clamp, unlike the opening camera, must cover every zone or the rural
    // ones become unreachable.
    maxBounds: [
      [-74.98, 3.6],
      [-72.95, 5.93],
    ],

    layerModes: [
      {
        id: "cluster",
        label: "Zone Profile",
        title: "Colour by built-environment cluster",
        icon: "grid",
        gateField: "has_features",
      },
      {
        id: "casualties",
        label: "Casualties",
        title: "Colour by pedestrian casualties per km², 2015–2019",
        icon: "crosshair",
        gateField: "has_covariates",
      },
      {
        id: "age60",
        label: "Age 60+",
        title: "Colour by share of population aged 60+, 2018 census",
        icon: "people",
        gateField: "has_pop60",
      },
    ],
    defaultLayerMode: "cluster",

    maturity: "demonstrated",
    maturityLabel: "Demonstrated",
    maturityNote:
      "Published DINO/STRIDE extraction over ~312,000 Google Street View " +
      "prediction points, 27 built-environment features, 840 ZATs, and " +
      "2015–2019 crash models.",
    mapCaveat:
      "Ecological. Colours describe zones, not people — these are area-level " +
      "associations across 1,141 ZATs, not individual risk. Zones with more " +
      "infrastructure also carry more pedestrians and traffic.",
  },
};

export const CITY_LIST: CityConfig[] = Object.values(CITY_CONFIGS);

export const DEFAULT_CITY: CityId = "philadelphia";

export function getCityConfig(id: string | null | undefined): CityConfig {
  if (id && id in CITY_CONFIGS) return CITY_CONFIGS[id as CityId];
  return CITY_CONFIGS[DEFAULT_CITY];
}
