/**
 * Per-city, per-dataset configuration.
 *
 * The dashboard began as Philadelphia intersection POINTS. Bogotá's results are
 * ZAT POLYGONS, and Philadelphia's street network is LINES. Rather than force
 * one schema onto all three, each DATASET declares its own analysis-unit type
 * and the map picks a rendering path from it.
 *
 * Geography and research maturity belong to the CITY. Everything about the
 * analysis unit belongs to the DATASET. Philadelphia has two datasets that
 * share a map: intersections and street segments. They are two views of one
 * city, not two cities — and they are deliberately NOT layered simultaneously,
 * because their risk measures are not comparable and stacking two ramps invites
 * exactly the cross-reading that is wrong.
 *
 * Adding a city or a layer should mean adding an entry here, not branching in
 * components.
 */

export type UnitType = "point" | "line" | "polygon";
export type CityId = "philadelphia" | "bogota";
export type DatasetId =
  | "philadelphia-intersections"
  | "philadelphia-segments"
  | "philadelphia-tracts"
  | "bogota-zats"
  | "bogota-segments";

/** One entry in the map's layer-mode toolbar. */
export interface LayerModeConfig {
  id: string;
  label: string;
  title: string;
  icon: "rings" | "crosshair" | "image" | "grid" | "people" | "road";
  /**
   * Always-present boolean property saying whether THIS mode's variable was
   * joined for a given unit. Required for every line and polygon mode.
   *
   * It cannot be inferred from the value: MapLibre's `["has", k]` compiles to
   * `k in properties` and returns true for a null-valued key, and
   * `["to-number", ["get", k], fallback]` short-circuits null to 0 before it
   * ever reaches the fallback. Both would silently paint a no-data unit as a
   * real value.
   *
   * The gate differs per mode — for Bogotá 301 zones have no cluster, 358 no
   * crash data, 290 no population; for Philadelphia segments 10,343 are outside
   * the model and 26,459 have no genuine traffic count.
   */
  gateField?: string;
}

/**
 * How this dataset's numbers are named and scaled.
 *
 * Required on every dataset. `distanceUnit` and `outcomeLabel` used to be
 * optional, with Philadelphia's values supplied as `?? "KSI"` / `?? "mi"`
 * defaults at the call sites — so any component that forgot to ask printed
 * Philadelphia's vocabulary over Bogotá's data. The segment sidebar said
 * "expected KSI per mile" directly above a legend reading "expected crashes
 * per km", two units and two outcomes on one screen. Making these required
 * turns that from a runtime accident into a compile error.
 */
export interface MeasureConfig {
  /** Denominator for rates, in the compact form used beside numbers. */
  distanceUnit: "mi" | "km";
  /** The same unit in prose: "mile", "km". */
  distanceUnitLong: string;
  /** Sentence form, e.g. "mid-block pedestrian KSI". */
  outcomeLabel: string;
  /** Chip and column-heading form, e.g. "KSI", "crashes". */
  outcomeLabelShort: string;
  /** Crash years these numbers cover, e.g. "2015–2024". */
  crashWindow: string;
}

/**
 * Feature-property names and scales for a line dataset.
 *
 * Philadelphia and Bogotá emit different keys for the same concepts, and the
 * paint expression read Philadelphia's for both: `mu_per_mile` and
 * `ped_ksi_seg` do not exist on a Bogotá feature, so the choropleth was
 * stepping a null and dropping every segment into the first ramp colour while
 * the legend beside it advertised Bogotá's cut-points. Nothing errored.
 *
 * This lives on the LINE arm of the union, so a new line dataset cannot
 * compile without stating its own field names.
 */
export interface SegmentFieldConfig {
  /** Property holding the modelled rate. */
  rateField: "mu_per_mile" | "mu_per_km";
  /** Property holding the observed outcome count. */
  outcomeField: "ped_ksi_seg" | "ped_crashes_seg";
  /** Property holding block length. */
  lengthField: "length_mi" | "length_km";
  /** SPF ramp cut-points. A different model on a different scale — these are
   *  not interchangeable between cities. */
  spfBreaks: number[];
  /** Observed-count ramp cut-points, from this city's own distribution. */
  observedBreaks: number[];
  /** Whether a traffic-volume covariate exists at all. Bogotá has none, so the
   *  filter chip, the layer mode and the AADT panel rows are all suppressed. */
  hasTrafficVolume: boolean;
  /** Why a unit can sit outside the model. The reason differs per city. */
  outsideModelNote: string;
  /** Footer line for the hover popup. */
  popupNote: string;
  /** Legend footnote, keyed by layer-mode id. */
  legendNotes: Record<string, string>;
}

interface DatasetBase {
  id: DatasetId;
  /** Shown on the layer toggle when a city has more than one dataset. */
  label: string;

  /** Outcome name, unit and crash window. Never hardcode these in a component. */
  measure: MeasureConfig;

  /**
   * Feature property holding the unit id. These must stay distinct across
   * datasets: the analysis-unit type guards discriminate on which id key is
   * present, so reusing one would route a feature to the wrong panel.
   */
  idField: string;
  nameField: string;
  unitLabel: string;
  unitLabelPlural: string;

  /**
   * Data location. A relative path is served from the site's own origin and
   * gets BASE_PATH prefixed. An absolute http(s) URL is used as-is — the
   * Bogotá segment layer is ~55 MB, over Cloudflare Workers' 25 MiB per-asset
   * limit, so it lives in R2 and is fetched cross-origin.
   */
  dataUrl: string;
  /**
   * Object key under NEXT_PUBLIC_R2_BASE_URL. When that env var is set the
   * dataset loads from R2; otherwise it falls back to `dataUrl` so local
   * development still reads from public/data.
   */
  remoteKey?: string;
  /** Shown in the legend footer. Required where we republish open data. */
  attribution?: string;
  /** Companion summary file, or null when the collection carries its own. */
  summaryUrl: string | null;
  /** API route used when NEXT_PUBLIC_API_URL is set, or null when none exists. */
  apiPath: string | null;

  layerModes: LayerModeConfig[];
  defaultLayerMode: string;
  /** Which arm of the FilterState union this dataset uses. */
  filterKind:
    | "philadelphia-crash"
    | "philadelphia-segment"
    | "bogota-zat"
    | "philadelphia-tract";

  /** The measure and its denominator, stated so a colour cannot be misread. */
  measureLabel: string;
  /** Caveat pinned to the map itself, not buried in methods text. */
  mapCaveat: string | null;
  /** Why this dataset's numbers cannot be compared with a sibling's. */
  notComparableTo?: string;
}

/**
 * A dataset, discriminated on its analysis-unit type.
 *
 * The union is what makes the field names above enforceable: `segment` is
 * reachable only after narrowing to `unitType === "line"`, and a fifth line
 * layer cannot be added without declaring its own property names, ramp breaks
 * and legend notes. That is the whole point — the previous shape let a new
 * dataset inherit Philadelphia's silently.
 */
export interface PointDatasetConfig extends DatasetBase {
  unitType: "point";
}
export interface PolygonDatasetConfig extends DatasetBase {
  unitType: "polygon";
}
export interface LineDatasetConfig extends DatasetBase {
  unitType: "line";
  segment: SegmentFieldConfig;
  /**
   * This dataset renders through the LINE path but its geometry is POLYGONS.
   *
   * Bogotá's segments are street FOOTPRINTS about 6 m wide. MapLibre draws a
   * polygon's rings when a line layer reads it, but at z10 one pixel is ~150 m,
   * so the class-scaled stroke lands at 0.36-0.50 px for most of the network
   * and antialiases to nothing. When this is set, the builder adds a fill
   * beneath the outline and gives the outline a zoom-interpolated PIXEL width,
   * so the network is visible at city scale and the true footprint shows when
   * zoomed in. Philadelphia's segments are real LineStrings and do not need it.
   */
  polygonGeometry?: boolean;
}

export type DatasetConfig =
  | PointDatasetConfig
  | PolygonDatasetConfig
  | LineDatasetConfig;

export interface CityConfig {
  id: CityId;
  label: string;
  enabled: boolean;

  center: [number, number];
  zoom: number;
  /** Camera clamp, already padded: [[west, south], [east, north]]. */
  maxBounds: [[number, number], [number, number]];

  /**
   * Research maturity. Bogotá is a completed, published analysis; Philadelphia
   * is a crash-based prototype. Surfacing this stops the city switcher from
   * implying the two are at equal stages.
   */
  maturity: "demonstrated" | "prototype";
  maturityLabel: string;
  maturityNote: string;

  datasets: DatasetConfig[];
  defaultDatasetId: DatasetId;
}

const PHILLY_INTERSECTIONS: PointDatasetConfig = {
  id: "philadelphia-intersections",
  label: "Intersections",
  unitType: "point",
  measure: {
    distanceUnit: "mi",
    distanceUnitLong: "mile",
    outcomeLabel: "pedestrian KSI",
    outcomeLabelShort: "KSI",
    crashWindow: "2015–2024",
  },
  idField: "node_id",
  nameField: "int_name",
  unitLabel: "intersection",
  unitLabelPlural: "intersections",
  dataUrl: "/data/intersections.geojson",
  summaryUrl: "/data/summary.json",
  apiPath: "/api/intersections",
  layerModes: [
    { id: "risk", label: "Risk Tiers", title: "Size circles by risk tier", icon: "rings" },
    { id: "crashes", label: "Crash Count", title: "Size circles by KSI crash count", icon: "crosshair" },
    { id: "imagery", label: "Imagery", title: "Colour by blind imagery safety score", icon: "image" },
  ],
  defaultLayerMode: "risk",
  filterKind: "philadelphia-crash",
  measureLabel:
    "Expected pedestrian KSI per intersection, 2015–2024 (empirical Bayes)",
  mapCaveat: null,
  notComparableTo:
    "Not comparable with the segment layer: different denominator, a disjoint " +
    "crash set, and different covariates.",
};

const PHILLY_SEGMENTS: LineDatasetConfig = {
  id: "philadelphia-segments",
  label: "Segments",
  unitType: "line",
  measure: {
    distanceUnit: "mi",
    distanceUnitLong: "mile",
    outcomeLabel: "mid-block pedestrian KSI",
    outcomeLabelShort: "KSI",
    crashWindow: "2015–2024",
  },
  segment: {
    rateField: "mu_per_mile",
    outcomeField: "ped_ksi_seg",
    lengthField: "length_mi",
    // Quantiles of the fitted mid-block KSI-per-mile distribution.
    spfBreaks: [0.15, 0.32, 0.8, 1.86, 2.7],
    observedBreaks: [1, 2, 3, 5],
    hasTrafficVolume: true,
    outsideModelNote:
      "This block lies entirely within the influence zones of the " +
      "intersections at its ends, so it has no mid-block exposure of its own " +
      "and is excluded from the model. Its crashes are still counted.",
    popupNote: "Mid-block only — not comparable with intersection risk.",
    legendNotes: {
      spf:
        "Mid-block only, with length as an offset. NOT comparable with " +
        "intersection risk — different denominator and a disjoint crash set.",
      observed:
        "Killed or suspected serious injury, 2015–2024. Most streets have none " +
        "in ten years — grey is an absence of crashes, not an absence of risk. " +
        "Counts, not a rate: long blocks accumulate more.",
      aadt:
        "PennDOT assigns a nominal 300 veh/day to local roads. Only genuine " +
        "counts are coloured — the rest is not a measurement.",
    },
  },
  // NOT unit_id — that key means "Bogotá ZAT" to the type guards.
  idField: "seg_id",
  nameField: "unit_name",
  unitLabel: "street segment",
  unitLabelPlural: "street segments",
  dataUrl: "/data/segments.geojson",
  summaryUrl: null, // stats live in the collection's own metadata
  apiPath: null,
  layerModes: [
    {
      id: "spf",
      label: "Expected KSI/mi",
      title: "Colour by expected mid-block pedestrian KSI per mile",
      icon: "road",
      gateField: "has_model",
    },
    {
      id: "observed",
      label: "Observed",
      title: "Colour by observed mid-block pedestrian KSI, 2015–2024",
      icon: "crosshair",
      gateField: "has_crashes",
    },
    {
      id: "aadt",
      label: "Traffic",
      title: "Colour by traffic volume — only where a genuine count exists",
      icon: "rings",
      gateField: "has_aadt",
    },
  ],
  defaultLayerMode: "spf",
  filterKind: "philadelphia-segment",
  measureLabel:
    "Expected MID-BLOCK pedestrian KSI per mile, 2015–2024 (length as offset)",
  mapCaveat:
    "Mid-block crashes only. This layer and the intersection layer split the " +
    "crash set — a crash appears in exactly one of them. Their risk numbers " +
    "are not comparable and must not be summed.",
  notComparableTo:
    "Not comparable with the intersection layer: per mile rather than per " +
    "intersection, a disjoint crash set, and no High Injury Network term.",
};

const BOGOTA_ZATS: PolygonDatasetConfig = {
  id: "bogota-zats",
  label: "Zones",
  unitType: "polygon",
  measure: {
    // ZAT results are densities per km², not per road length, but the unit is
    // still declared so nothing falls back to Philadelphia's mile.
    distanceUnit: "km",
    distanceUnitLong: "km",
    outcomeLabel: "pedestrian casualties",
    outcomeLabelShort: "casualties",
    crashWindow: "2015–2019",
  },
  idField: "unit_id",
  nameField: "unit_name",
  unitLabel: "zone",
  unitLabelPlural: "zones",
  dataUrl: "/data/bogota_zats.geojson",
  summaryUrl: null,
  apiPath: null,
  layerModes: [
    { id: "cluster", label: "Zone Profile", title: "Colour by built-environment cluster", icon: "grid", gateField: "has_features" },
    { id: "casualties", label: "Casualties", title: "Colour by pedestrian casualties per km², 2015–2019", icon: "crosshair", gateField: "has_covariates" },
    { id: "age60", label: "Age 60+", title: "Colour by share of population aged 60+, 2018 census", icon: "people", gateField: "has_pop60" },
  ],
  defaultLayerMode: "cluster",
  filterKind: "bogota-zat",
  measureLabel: "Built-environment cluster profile, 840 ZAT zones",
  mapCaveat:
    "Ecological. Colours describe zones, not people — these are area-level " +
    "associations, not individual risk. Zones with more infrastructure also " +
    "carry more pedestrians and traffic.",
};

const PHILADELPHIA_TRACTS: PolygonDatasetConfig = {
  id: "philadelphia-tracts",
  label: "Tracts",
  unitType: "polygon",
  measure: {
    distanceUnit: "mi",
    distanceUnitLong: "miles",
    outcomeLabel: "pedestrian KSI",
    outcomeLabelShort: "KSI",
    crashWindow: "2015–2024",
  },
  idField: "tract_id",
  nameField: "unit_name",
  unitLabel: "tract",
  unitLabelPlural: "tracts",
  dataUrl: "/data/tracts.geojson",
  summaryUrl: null,
  apiPath: null,
  layerModes: [
    { id: "excess", label: "Excess KSI", title: "Observed minus the safety-performance-function expectation", icon: "crosshair", gateField: "has_model" },
    // No gateField: has_crashes is false for exactly the tracts with zero
    // pedestrian KSI, and zero is a value. Gating would grey them as no data.
    { id: "observed", label: "Observed KSI", title: "Pedestrian killed or seriously injured, 2015–2024", icon: "grid" },
    { id: "poverty", label: "Poverty", title: "Share below the poverty level, ACS 2020–2024", icon: "people", gateField: "has_pov" },
  ],
  // Excess rather than raw count. A large tract with many crashes and many road
  // miles is not a priority; one with more than its exposure predicts is.
  defaultLayerMode: "excess",
  filterKind: "philadelphia-tract",
  measureLabel: "Pedestrian KSI against an exposure-adjusted expectation, 408 tracts",
  mapCaveat:
    "Ecological, and NOT summable with the intersection or segment layers. " +
    "This is the only Philadelphia layer holding the complete geocoded set — " +
    "1,494 pedestrian KSI, intersection and mid-block together — because a " +
    "tract contains a crash rather than being assigned one. The other two " +
    "partition the same crashes between them, so adding this to either counts " +
    "every crash twice. Tract-level association, not individual risk.",
};

const BOGOTA_SEGMENTS: LineDatasetConfig = {
  id: "bogota-segments",
  label: "Segments",
  unitType: "line",
  measure: {
    distanceUnit: "km",
    distanceUnitLong: "km",
    outcomeLabel: "pedestrian-involved crashes",
    outcomeLabelShort: "crashes",
    crashWindow: "2015–2019",
  },
  segment: {
    rateField: "mu_per_km",
    outcomeField: "ped_crashes_seg",
    lengthField: "length_km",
    spfBreaks: [0.8, 1.6, 2.7, 7.7, 23.2],
    // Quantiles of the observed count among the 10,383 segments carrying at
    // least one crash: p75 = 2, p90 = 4, p99 = 12. Philadelphia's [1,2,3,5]
    // would put a fifth of Bogotá's crash-carrying network in the top bucket.
    observedBreaks: [1, 2, 4, 12],
    // Calles_datos carries width, lanes and speed but no traffic count.
    hasTrafficVolume: false,
    outsideModelNote:
      "This segment has no usable derived length or no socioeconomic stratum " +
      "joined, so it is excluded from the model. Its crashes are still counted.",
    popupNote:
      "Pedestrian-involved, not KSI — not comparable with the Philadelphia layers.",
    legendNotes: {
      spf:
        "Length as an offset, per km. NOT comparable with Philadelphia segment " +
        "risk or with the ZAT layer — different crash definition, exposure and model.",
      observed:
        "Pedestrian-INVOLVED crashes, not killed-or-seriously-injured. A " +
        "different outcome from the Philadelphia layer — the two numbers are " +
        "not comparable.",
    },
  },
  idField: "seg_id",
  nameField: "unit_name",
  unitLabel: "street segment",
  unitLabelPlural: "street segments",
  polygonGeometry: true,
  // ~55 MB, over Cloudflare Workers' 25 MiB per-asset cap, so it is served
  // from R2. The relative path is the local-development fallback.
  dataUrl: "/data/bogota_segments.geojson",
  remoteKey: "bogota_segments.geojson",
  attribution:
    "Source: City of Bogotá open data; processing by Universidad de los Andes.",
  summaryUrl: null,
  apiPath: null,
  layerModes: [
    {
      id: "spf",
      label: "Expected/km",
      title: "Colour by expected pedestrian crashes per km",
      icon: "road",
      gateField: "has_model",
    },
    {
      id: "observed",
      label: "Observed",
      title: "Colour by observed pedestrian-involved crashes",
      icon: "crosshair",
      gateField: "has_crashes",
    },
  ],
  defaultLayerMode: "spf",
  filterKind: "philadelphia-segment",
  measureLabel:
    "Expected pedestrian-involved crashes per km (length as offset)",
  mapCaveat:
    "Pedestrian-INVOLVED crashes, not killed or seriously injured, and " +
    "exposure includes junctions. Not comparable with the Philadelphia " +
    "segment layer or with the ZAT layer.",
  notComparableTo:
    "A different outcome (all pedestrian-involved crashes, not KSI), a " +
    "different exposure (junctions included) and a different model from the " +
    "Philadelphia segment layer.",
};

export const CITY_CONFIGS: Record<CityId, CityConfig> = {
  philadelphia: {
    id: "philadelphia",
    label: "Philadelphia",
    enabled: true,
    center: [-75.1652, 39.9526],
    // The pre-padded form of the ±0.1 / ±0.05 arithmetic that used to live
    // inline in MapExplorer, so the clamp is unchanged.
    zoom: 12,
    maxBounds: [
      [-75.3803, 39.817],
      [-74.8558, 40.188],
    ],
    maturity: "prototype",
    maturityLabel: "Phase 0 prototype",
    maturityNote:
      "Crash-based ranking from PennDOT data, now covering both intersections " +
      "and mid-block street segments, plus one completed imagery " +
      "measurement-validation study. The Senior Pedestrian Mobility Index is " +
      "not built yet — these are not SPMI scores.",
    datasets: [PHILLY_INTERSECTIONS, PHILLY_SEGMENTS, PHILADELPHIA_TRACTS],
    defaultDatasetId: "philadelphia-intersections",
  },

  bogota: {
    id: "bogota",
    label: "Bogotá",
    enabled: true,
    // Framed on the urban core. The full extent spans 1.8° × 2.1° because of
    // rural Sumapaz zones, so fitting the raw bbox would zoom out past use.
    center: [-74.08, 4.65],
    zoom: 10.5,
    // The clamp, unlike the opening camera, must cover every zone.
    maxBounds: [
      [-74.98, 3.6],
      [-72.95, 5.93],
    ],
    maturity: "demonstrated",
    maturityLabel: "Demonstrated",
    maturityNote:
      "Published DINO/STRIDE extraction over ~312,000 Google Street View " +
      "prediction points, 27 built-environment features, 840 ZATs, and " +
      "2015–2019 crash models.",
    // ZATs first and default: nobody should load the 55 MB segment file by
    // accident.
    datasets: [BOGOTA_ZATS, BOGOTA_SEGMENTS],
    defaultDatasetId: "bogota-zats",
  },
};

export const CITY_LIST: CityConfig[] = Object.values(CITY_CONFIGS);
export const DEFAULT_CITY: CityId = "philadelphia";
export const DEFAULT_DATASET: DatasetId = "philadelphia-intersections";

const DATASETS: Record<DatasetId, DatasetConfig> = {
  "philadelphia-intersections": PHILLY_INTERSECTIONS,
  "philadelphia-segments": PHILLY_SEGMENTS,
  "philadelphia-tracts": PHILADELPHIA_TRACTS,
  "bogota-zats": BOGOTA_ZATS,
  "bogota-segments": BOGOTA_SEGMENTS,
};

/**
 * Where a dataset's data actually lives.
 *
 * Absolute URLs are used as-is. A dataset with a `remoteKey` resolves against
 * NEXT_PUBLIC_R2_BASE_URL when that is set, so production reads the large
 * artefacts from R2 while local development keeps reading public/data.
 * Everything else is same-origin and gets BASE_PATH prefixed by the caller.
 */
export function resolveDataUrl(ds: DatasetConfig): { url: string; remote: boolean } {
  if (/^https?:\/\//i.test(ds.dataUrl)) return { url: ds.dataUrl, remote: true };
  const base = process.env.NEXT_PUBLIC_R2_BASE_URL;
  if (ds.remoteKey && base) {
    return { url: `${base.replace(/\/$/, "")}/${ds.remoteKey}`, remote: true };
  }
  return { url: ds.dataUrl, remote: false };
}

export function getCityConfig(id: string | null | undefined): CityConfig {
  if (id && id in CITY_CONFIGS) return CITY_CONFIGS[id as CityId];
  return CITY_CONFIGS[DEFAULT_CITY];
}

export function getDataset(id: string | null | undefined): DatasetConfig | null {
  return id && id in DATASETS ? DATASETS[id as DatasetId] : null;
}

/** The dataset to show for a city, falling back to its default. */
export function resolveDataset(city: CityConfig, id: string | null | undefined): DatasetConfig {
  const d = getDataset(id);
  if (d && city.datasets.some((x) => x.id === d.id)) return d;
  return city.datasets.find((x) => x.id === city.defaultDatasetId) ?? city.datasets[0];
}
