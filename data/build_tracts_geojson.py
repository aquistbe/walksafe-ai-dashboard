#!/usr/bin/env python3
"""
Build data/tracts.geojson — Philadelphia census tracts carrying the COMPLETE
geocoded pedestrian KSI set, a tract-level SPF with empirical Bayes, and ACS
5-year equity characteristics with their margins of error.

Inputs (produced by `make tracts`):
  pipeline/work/tract_ranked.csv         408 tracts, model output + ACS
  pipeline/work/tiger/tl_2020_42_tract.zip   geometry

Output:
  data/tracts.geojson

Design notes
------------
* The id property is `tract_id`, NOT `unit_id`, `seg_id` or `node_id`. The
  dashboard's type guards discriminate the analysis-unit union on which
  top-level id key is present, so reusing one would route a tract to the wrong
  InfoPanel and the wrong filter set. `tract_id` is the 11-digit GEOID as an
  integer — 42101000101 is well inside the exact-integer range of a double, and
  MapLibre filter expressions compare it numerically. The string form ships too,
  as `geoid`, because that is what joins to any other census product.

* Geometry is reduced by coordinate QUANTISATION, not Douglas-Peucker, for the
  same reason as the segment and Bogotá builds: neighbouring tracts share
  boundary vertices, and quantising to a common grid maps a shared vertex to
  the same cell so the tiling stays gap-free. Simplifying each polygon
  independently would open slivers along every shared edge.

* Properties are FLAT. MapLibre encodes GeoJSON sources to vector tiles and
  JSON.stringify()s any value that is not a string, boolean or number, so a
  nested object arrives at a map event handler as a string.

* Three always-present boolean gate flags — has_model, has_crashes, has_acs.
  MapLibre cannot test for missing data: `["has", k]` compiles to
  `k in properties` and is true for a null-valued key, and
  `["to-number", ["get", k], fallback]` short-circuits null to 0 before
  reaching the fallback. A choropleth must gate on a real boolean.

* EVERY ACS estimate ships with its margin of error and coefficient of
  variation. At tract level these are large — the median CV on the poverty
  share is 30% and on the Hispanic share 43% — so a point estimate alone would
  misrepresent the data. The dashboard renders the 90% interval beside the
  value and marks the unreliable ones. Zeros are NOT omitted from the MOE
  fields for that reason: an absent MOE would read as a precise estimate.

* This layer is NOT summable with the intersection or segment layers. It
  re-counts the same crashes under a different unit. The metadata carries the
  three-layer accounting so the relationship is stated with the data rather
  than only in the UI.
"""

import gzip
import json
import math
import os
import sys
from datetime import datetime
from pathlib import Path

import geopandas as gpd
import pandas as pd

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
WORK = Path(os.getenv("WALKSAFE_WORK_DIR", REPO / "pipeline" / "work"))
OUT = REPO / "data" / "tracts.geojson"

TRACT_CSV = WORK / "tract_ranked.csv"
TIGER_ZIP = WORK / "tiger" / "tl_2020_42_tract.zip"

#: ~11 m. Tracts are administrative polygons hundreds of metres across; their
#: boundaries are not a measurement and do not deserve 1 m precision. The
#: segment build uses 5 (~1.1 m) because a street's shape is the data.
COORD_DECIMALS = 4
SIZE_TARGET_GZ_MB = 1.5

#: ACS fields, with the label the dashboard prints and whether the value is a
#: percentage. Order is the order the panel renders them in.
ACS_DISPLAY = [
    ("pct_pov",        "Below the poverty level",     "pct"),
    ("med_hh_income",  "Median household income",     "usd"),
    ("pct_no_vehicle", "Households with no vehicle",  "pct"),
    ("pct_65plus",     "Aged 65 and over",            "pct"),
    ("pct_under18",    "Under 18",                    "pct"),
    ("pct_hispanic",   "Hispanic or Latino",          "pct"),
    ("pct_nh_white",   "Non-Hispanic White alone",    "pct"),
    ("pct_nh_black",   "Non-Hispanic Black alone",    "pct"),
]

for p in (TRACT_CSV, TIGER_ZIP):
    if not p.exists():
        sys.exit(f"Missing {p}\nRun: make tracts")


def nz(v, digits=4):
    """JSON-safe scalar: NaN/Inf -> None, numpy -> python, floats rounded."""
    if v is None:
        return None
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
        return round(v, digits)
    if hasattr(v, "item"):
        v = v.item()
        return nz(v, digits) if isinstance(v, float) else v
    return v


# ---------------------------------------------------------------------------
# 1. Load
# ---------------------------------------------------------------------------
print("Loading tract model output ...")
df = pd.read_csv(TRACT_CSV)
print(f"  tracts: {len(df):,}")

print("Loading TIGER geometry ...")
g = gpd.read_file(TIGER_ZIP)
g = g[g.COUNTYFP == "101"].copy()
g["tract_id"] = g.GEOID.astype("int64")
g = g[["tract_id", "geometry"]].to_crs(4326)
gdf = g.merge(df, on="tract_id", how="inner")
print(f"  joined geometry to {len(gdf):,} of {len(df):,} tracts")
if len(gdf) != len(df):
    sys.exit(f"  {len(df) - len(gdf)} tracts have no geometry — refusing to "
             "ship a layer with holes in it")


# ---------------------------------------------------------------------------
# 2. Geometry reduction
# ---------------------------------------------------------------------------
def quantise_ring(coords, decimals):
    out = []
    for pt in coords:
        p = (round(pt[0], decimals), round(pt[1], decimals))
        if not out or p != out[-1]:
            out.append(p)
    # A ring needs 4 positions with the first repeated last.
    if len(out) < 4:
        return None
    if out[0] != out[-1]:
        out.append(out[0])
    return out


def quantise(geom, decimals):
    def poly(p):
        ext = quantise_ring(list(p.exterior.coords), decimals)
        if ext is None:
            return None
        rings = [ext]
        for r in p.interiors:
            q = quantise_ring(list(r.coords), decimals)
            if q is not None:
                rings.append(q)
        return rings

    if geom.geom_type == "Polygon":
        r = poly(geom)
        return {"type": "Polygon", "coordinates": r} if r else None
    if geom.geom_type == "MultiPolygon":
        parts = [r for r in (poly(p) for p in geom.geoms) if r]
        if not parts:
            return None
        if len(parts) == 1:
            return {"type": "Polygon", "coordinates": parts[0]}
        return {"type": "MultiPolygon", "coordinates": parts}
    return None


print(f"Quantising to {COORD_DECIMALS} decimals "
      f"(~{110_000 / 10 ** COORD_DECIMALS:.0f} m grid) ...")
geoms, dropped = {}, []
for tid, geom in zip(gdf.tract_id, gdf.geometry):
    q = quantise(geom, COORD_DECIMALS)
    if q is None:
        dropped.append(tid)
        continue
    geoms[tid] = q
n_vert = 0
for c in geoms.values():
    polys = [c["coordinates"]] if c["type"] == "Polygon" else c["coordinates"]
    n_vert += sum(len(r) for p in polys for r in p)
print(f"  {len(geoms):,} polygons, {n_vert:,} vertices")
if dropped:
    sys.exit(f"  {len(dropped)} tracts collapsed under quantisation "
             f"({dropped}) — lower COORD_DECIMALS is too aggressive")


# ---------------------------------------------------------------------------
# 3. Features
# ---------------------------------------------------------------------------
print("Building features ...")

# Always emitted, even when zero or false. Everything else is dropped when it
# is zero/null/false to keep the payload lean — safe because every consumer
# either gates on a boolean flag or coalesces with `?? 0`.
#
# The ACS MOE and CV fields are in this set deliberately. A missing MOE would
# render as a bare point estimate, which is the exact failure this layer is
# supposed to prevent.
ALWAYS = {"tract_id", "geoid", "unit_name",
          "has_model", "has_crashes", "has_acs", "has_pov", "has_age", "ped_ksi"}
ALWAYS |= {f"{k}_moe" for k, _, _ in ACS_DISPLAY}
ALWAYS |= {f"{k}_cv" for k, _, _ in ACS_DISPLAY}

features = []
for r in gdf.to_dict("records"):
    tid = r["tract_id"]
    if tid not in geoms:
        continue

    ksi = int(r.get("ped_ksi_tract") or 0)
    in_model = bool(r.get("in_model"))
    has_acs = pd.notna(r.get("pop"))

    props = {
        # --- identity. `tract_id`, never `unit_id` — see module docstring. ---
        "tract_id": int(tid),
        "geoid": str(r["GEOID"]),
        "unit_name": str(r["tract_name"]),

        # --- observed. The COMPLETE geocoded set, both crash types. ---
        "ped_ksi": ksi,
        "ped_deaths": int(r.get("ped_deaths_tract") or 0),
        "ped_any": int(r.get("ped_any_tract") or 0),
        # The intersection/mid-block split WITHIN this tract. Not a partition
        # of this layer — both are counted here — but it is what makes the
        # relationship to the other two layers legible in the panel.
        "ksi_intersection": int(r.get("ksi_intersection") or 0),
        "ksi_midblock": int(r.get("ksi_midblock") or 0),
        # How much of this tract's burden sits within 50 m of its own edge.
        # A tract whose count is a boundary artefact can be spotted here.
        "ksi_near_boundary": int(r.get("near_bound_ksi") or 0),

        # --- model. NOT comparable to eb_ksi or eb_ksi_seg. ---
        "mu_spf": nz(r.get("mu_spf"), 3),
        "eb_ksi": nz(r.get("eb_ksi_tract"), 3),
        "eb_weight": nz(r.get("eb_weight"), 3),
        "eb_per_road_mi": nz(r.get("eb_per_road_mi"), 3),
        "mu_per_road_mi": nz(r.get("mu_per_road_mi"), 3),
        "excess_ksi": nz(r.get("excess_ksi"), 2),
        "rank_eb": nz(r.get("rank_eb"), 0),
        "rank_raw": nz(r.get("rank_raw"), 0),
        "tier": (str(r["tract_risk_tier"])
                 if pd.notna(r.get("tract_risk_tier")) else None),

        # --- exposure and form ---
        "road_mi": nz(r.get("road_mi"), 2),
        "pct_arterial": nz(r.get("pct_arterial"), 1),
        "n_nodes": int(r.get("n_nodes") or 0),
        "n_segments": int(r.get("n_segments") or 0),
        "aadt_mean": nz(r.get("aadt_mean_real"), 0),
        "land_km2": nz(r.get("land_km2"), 3),
        "schools": int(r.get("schools") or 0),
        "parks": int(r.get("parks") or 0),

        # --- the confounded denominator, shipped and labelled as such ---
        "ksi_per_10k_pop": nz(r.get("ksi_per_10k_pop"), 1),

        # --- gate flags: always present, always boolean, never null ---
        "has_model": in_model,
        "has_crashes": ksi > 0,
        # Any ACS data at all, i.e. a population estimate.
        "has_acs": bool(has_acs),
        # The poverty share SPECIFICALLY. Not the same thing: all 408 tracts
        # have a population estimate but 18 have no poverty estimate, and the
        # equity choropleth colours the poverty share. Gating that ramp on
        # `has_acs` would send those 18 through
        # ["to-number", ["get","pct_pov"], 0] — which yields 0, lands them in
        # the lowest bucket and paints "no estimate" as "least poor".
        "has_pov": bool(pd.notna(r.get("pct_pov"))),
        # The 65+ share specifically, for the same reason: the Age 65+ mode
        # colours pct_65plus, and 17 tracts have a population estimate but no
        # age estimate. Mirrored by data/rederive_tract_flags.py.
        "has_age": bool(pd.notna(r.get("pct_65plus"))),
    }

    # ACS: estimate, 90% margin of error, coefficient of variation. All three
    # travel together or none of them do.
    props["pop"] = nz(r.get("pop"), 0)
    props["pop_moe"] = nz(r.get("pop_moe"), 0)
    for key, _label, _kind in ACS_DISPLAY:
        props[key] = nz(r.get(key), 1)
        props[f"{key}_moe"] = nz(r.get(f"{key}_moe"), 1)
        props[f"{key}_cv"] = nz(r.get(f"{key}_cv"), 1)

    props = {k: v for k, v in props.items()
             if k in ALWAYS or (v is not None and v != 0 and v is not False)}
    features.append({"type": "Feature", "geometry": geoms[tid],
                     "properties": props})

avg = sum(len(f["properties"]) for f in features) / max(len(features), 1)
print(f"  {len(features):,} features, {avg:.1f} properties each")


# ---------------------------------------------------------------------------
# 4. Metadata — the caveats travel WITH the data
# ---------------------------------------------------------------------------
total_ksi = int(df.ped_ksi_tract.sum())
near_bound = int(df.near_bound_ksi.sum())
near_25 = int(df.near_bound_ksi_25.sum())
near_100 = int(df.near_bound_ksi_100.sum())
near_pct = near_bound / total_ksi * 100
w_cw = float((df.eb_weight * df.ped_ksi_tract).sum() / df.ped_ksi_tract.sum())
with_ksi = int((df.ped_ksi_tract > 0).sum())


def sibling_layer_ksi() -> dict:
    """KSI actually RENDERED on the other two Philadelphia layers.

    Read from the built files rather than restated here. The whole point of the
    accounting block is that these three numbers are the same crashes under
    different units; a hardcoded copy would drift the moment either sibling is
    rebuilt, and the drift would be invisible.
    """
    out = {}
    ipath = REPO / "data" / "intersections.geojson"
    if ipath.exists():
        ic = json.loads(ipath.read_text())
        out["intersection_layer_rendered"] = int(
            sum(f["properties"].get("ped_ksi", 0) for f in ic["features"]))
    spath = REPO / "data" / "segments.geojson"
    if spath.exists():
        sc = json.loads(spath.read_text())
        acc = sc.get("metadata", {}).get("crash_accounting", {})
        if "segment_on_walkable_network" in acc:
            out["segment_layer_rendered"] = int(acc["segment_on_walkable_network"])
    return out


siblings = sibling_layer_ksi()
for k in ("intersection_layer_rendered", "segment_layer_rendered"):
    if k not in siblings:
        print(f"  WARNING: could not read {k} from its sibling layer — "
              "the cross-layer accounting will omit it.")

metadata = {
    "name": "WalkSafe-AI Philadelphia census tracts",
    "city": "philadelphia",
    "unit_type": "polygon",
    "unit_key": "tract",          # distinguishes this from the Bogotá ZAT
    "unit_label": "census tract",
    "description": (
        f"2020 TIGER/Line census tracts, Philadelphia County ({len(features)} "
        "units), carrying every geocoded pedestrian KSI 2015-2024 assigned by "
        "point location, a tract-level safety performance function with "
        "walkable road miles as an offset, and ACS 5-year characteristics "
        "with margins of error."
    ),

    # The single most important sentence on this layer.
    "caveat": (
        f"ECOLOGICAL. This is the only Philadelphia layer showing the complete "
        f"geocoded crash set — all {total_ksi:,} pedestrian KSI 2015-2024, "
        "intersection-snapped and mid-block together, because a tract contains "
        "a crash rather than being assigned one. It still must NOT be summed "
        "with the intersection or segment layers: those two partition the same "
        "crashes, so adding this to them counts every crash twice. Tract-level "
        "association, not individual risk."
    ),

    "crash_window": "2015-2024",
    "crash_accounting": {
        "ped_ksi_total": 1496,
        "geocoded": 1494,
        "no_usable_coordinate": 2,
        "tract_layer": total_ksi,
        **siblings,
        **({"intersection_plus_segment":
            siblings["intersection_layer_rendered"]
            + siblings["segment_layer_rendered"]}
           if len(siblings) == 2 else {}),
        "county_edge_snapped": 9,
        "rule": (
            "A crash belongs to the tract that contains its coordinate. This "
            "is a partition of SPACE, not of the crash set: both "
            "intersection-related and mid-block crashes are counted, so this "
            "layer holds crashes the other two lose — those that fail to snap "
            "to a node, and those on expressways, ramps and private roads "
            "outside the walkable network."
        ),
        "county_edge_note": (
            "9 crashes geocoded 0-5.2 m outside the county's tract coverage, "
            "on City Avenue, the Cobbs Creek boundary and the Delaware "
            "waterfront — all of which ARE the county line. Snapped to the "
            "nearest tract rather than dropped."
        ),
        "not_summable": (
            "tract_layer, intersection_layer_rendered and "
            "segment_layer_rendered describe the SAME crashes under different "
            "units. Never add them."
        ),
    },

    # Measured, not assumed. This is the concrete form MAUP takes here.
    "boundary_effect": {
        "ksi_within_25m_of_boundary": near_25,
        "ksi_within_50m_of_boundary": near_bound,
        "ksi_within_100m_of_boundary": near_100,
        "pct_within_50m": round(near_pct, 1),
        "median_distance_m": 16,
        "note": (
            f"{near_pct:.0f}% of pedestrian KSI fall within 50 m of a tract "
            "boundary, and the median crash is 16 m from one. Tract "
            "boundaries follow streets, and crashes happen on streets, so a "
            "dangerous arterial that divides two tracts has its burden split "
            "between them and reads as roughly half on each. This biases "
            "boundary corridors DOWNWARD on both sides. It is a property of "
            "the zoning scheme, not of the crashes."
        ),
    },

    "spf": {
        "family": "negative binomial (NB2), log link",
        "offset": "log(walkable road miles in the tract), coefficient fixed at 1",
        "offset_note": (
            "Road miles, NOT residents. Crashes per resident ranks Center City "
            "and the Navy Yard catastrophically high — few residents, enormous "
            "pedestrian volume — which is exposure confounding, not a finding. "
            "Population enters as a covariate instead. A per-capita rate is "
            "still shipped as ksi_per_10k_pop and labelled confounded, because "
            "it is what an equity reader reaches for; nothing is ranked on it."
        ),
        "covariates": (
            "log(population), % arterial and collector road miles, node "
            "density, schools, playgrounds, and a traffic-volume slope "
            "identified only where a genuine AADT count exists."
        ),
        "equity_excluded_note": (
            "No ACS variable enters the risk model. Conditioning risk on "
            "poverty would adjust away the very contrast the equity mode "
            "exists to describe."
        ),
        "eb_note": (
            f"{with_ksi} of {len(df)} tracts ({with_ksi / len(df) * 100:.0f}%) "
            "carry at least one pedestrian KSI, against 1.5% of street "
            f"segments. So the empirical Bayes estimate is {(1 - w_cw) * 100:.0f}% "
            "observed data where the crashes are, against 16.5% at the segment "
            "and essentially none at the intersection. At this unit EB is "
            "doing something other than restating the covariates, which is why "
            "the EB estimate rather than the SPF expectation is mapped."
        ),
        "excluded_units": (
            "One tract (9809.02: 0.13 mi of a single street stub, no "
            "residents, no crashes) is outside the model. The 16 other "
            "zero-population tracts — Fairmount Park, the Navy Yard, the "
            "airport, the river tracts — are KEPT, and carry 69 KSI between "
            "them. Excluding them would drop 4.6% of the crash set on the "
            "grounds that nobody sleeps there, which is the per-capita "
            "fallacy this layer avoids."
        ),
    },

    "acs": {
        "vintage": "ACS 2024 5-year (2020-2024)",
        "geography": "2020 census tracts",
        "moe_confidence": 90,
        "fields": [{"key": k, "label": lab, "kind": kind}
                   for k, lab, kind in ACS_DISPLAY],
        "moe_note": (
            "Every estimate ships with its 90% margin of error and a "
            "coefficient of variation. Tract-level ACS margins are large: the "
            "median CV is 30% on the poverty share and 43% on the Hispanic "
            "share, and one tract reports a median household income of "
            "$102,670 with an MOE of $50,798 — an interval spanning most of "
            "the city's distribution. Values with CV > 30% are marked "
            "unreliable and should not be used to rank tracts."
        ),
        "temporal_note": (
            "The ACS sample (2020-2024) does not cover the same period as the "
            "crashes (2015-2024). Tract composition changed over the window; "
            "this is a snapshot of its end."
        ),
        "reliability_thresholds": {"caution_cv": 15, "unreliable_cv": 30},
    },

    "not_comparable_to": {
        "intersections.geojson": (
            "eb_ksi there is expected pedestrian KSI per INTERSECTION. Here it "
            "is expected KSI per TRACT with road miles as an offset, over a "
            "crash set that includes the mid-block crashes the intersection "
            "layer excludes. Different unit, different denominator, "
            "overlapping crashes. Do not rank them against each other."
        ),
        "segments.geojson": (
            "eb_ksi_seg there is expected MID-BLOCK KSI per segment. This "
            "layer counts mid-block AND intersection crashes. Do not rank them "
            "against each other or sum them."
        ),
    },

    "caveats": [
        "Ecological: tract-level association, not individual risk.",
        ("Modifiable areal unit problem: results depend on the zoning scheme. "
         "Tracts are administrative units drawn for census tabulation, not for "
         f"traffic safety, and {near_pct:.0f}% of crashes sit within 50 m of a "
         "tract boundary."),
        ("ACS estimates carry margins of error that are large at tract level. "
         "The 90% interval is shown with every value."),
        ("Not comparable with, and not summable with, the intersection or "
         "segment layers."),
    ],

    "attribution": (
        "Crashes: PennDOT PCDS. Geography: US Census Bureau TIGER/Line 2020. "
        "Characteristics: US Census Bureau ACS 2024 5-year."
    ),
    "coordinate_system": "EPSG:4326 (WGS84)",
    "coordinate_decimals": COORD_DECIMALS,
    "generated": datetime.now().isoformat(timespec="seconds"),
}

geojson = {"type": "FeatureCollection", "metadata": metadata,
           "features": features}

print(f"\nWriting {OUT.relative_to(REPO)} ...")
with open(OUT, "w") as f:
    json.dump(geojson, f, separators=(",", ":"))

raw_mb = OUT.stat().st_size / 1_048_576
gz_mb = len(gzip.compress(OUT.read_bytes(), 6)) / 1_048_576
print(f"  Raw:  {raw_mb:6.2f} MB   (parse/memory cost)")
print(f"  Gzip: {gz_mb:6.2f} MB   (transfer cost — what the browser downloads)")
if gz_mb > SIZE_TARGET_GZ_MB:
    print(f"  WARNING: over the {SIZE_TARGET_GZ_MB} MB transfer target.")

print(f"\nPedestrian KSI on the layer: {total_ksi:,} "
      "(the complete geocoded set)")
print(f"Tracts with >=1 KSI:        {with_ksi:,} of {len(features):,}")
print(f"Tracts in the model:        {sum(1 for f in features if f['properties']['has_model']):,}")
print(f"Tracts with ACS data:       {sum(1 for f in features if f['properties']['has_acs']):,}")
print(f"KSI within 50 m of a tract boundary: {near_bound:,} ({near_pct:.1f}%)")
print("\nDone.")
