#!/usr/bin/env python3
"""
Build data/segments.geojson — Philadelphia street segments with mid-block
pedestrian crash counts and segment-level safety performance estimates.

Inputs (produced by `make segments`):
  pipeline/work/segment_ranked.csv        39,761 modelled segments + model output
  pipeline/work/corridor_ranked.csv       3,692 corridors
  pipeline/outputs/segment_crash_assignment.csv   one row per crash
  <WALKSAFE_GIS_DIR>/Street_Centerline    geometry

Output:
  data/segments.geojson

Design notes
------------
* Geometry is reduced by coordinate QUANTISATION, not Douglas-Peucker, for the
  same reason as the Bogotá build: segments share endpoints at street nodes, and
  quantising every vertex to a common grid maps shared endpoints to the same
  cell so the network stays connected. Simplifying each line independently would
  pull junctions apart and open visible gaps across the whole city.

* The id property is `seg_id`, NOT `unit_id`. The dashboard's type guards
  discriminate the analysis-unit union on the presence of a top-level id key,
  and `unit_id` already means "Bogotá ZAT" — a segment carrying it would be
  routed to the wrong InfoPanel and the wrong filter set.

* Properties are FLAT. MapLibre encodes GeoJSON sources to vector tiles and
  JSON.stringify()s any value that is not a string, boolean or number, so a
  nested object arrives at a map event handler as a string.

* Four always-present boolean gate flags. MapLibre cannot test for missing data:
  `["has", k]` compiles to `k in properties` and is true for a null-valued key,
  and `["to-number", ["get", k], fallback]` short-circuits null to 0 before
  reaching the fallback. A choropleth must gate on a real boolean.

* eb_ksi_seg is NOT eb_ksi. Different denominator, disjoint crash set, different
  covariates. The two must never be ranked against each other or summed.
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
PIPE_OUT = Path(os.getenv("WALKSAFE_OUTPUT_DIR", REPO / "pipeline" / "outputs"))
DATA_ROOT = Path(os.getenv(
    "WALKSAFE_DATA_ROOT",
    Path.home() / "Library/CloudStorage/OneDrive-DrexelUniversity"
    / "Grants/WALKSAFE-AI Grant/Data"))
GIS = Path(os.getenv("WALKSAFE_GIS_DIR", DATA_ROOT / "Philadelphia GIS"))
OUT = REPO / "data" / "segments.geojson"

COORD_DECIMALS = 5      # ~1.1 m; matches the Bogotá build
SIZE_TARGET_GZ_MB = 3.0   # transfer size; see the write step

SEG_CSV = WORK / "segment_ranked.csv"
CORR_CSV = WORK / "corridor_ranked.csv"
ASSIGN_CSV = PIPE_OUT / "segment_crash_assignment.csv"

for p in (SEG_CSV, CORR_CSV, ASSIGN_CSV):
    if not p.exists():
        sys.exit(f"Missing {p}\nRun: make segments")


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
print("Loading segment model output ...")
seg = pd.read_csv(SEG_CSV)
corr = pd.read_csv(CORR_CSV)
print(f"  segments: {len(seg):,}   corridors: {len(corr):,}")

corr_meta = corr.set_index("corridor_id")
seg["corridor_name"] = seg.corridor_id.map(corr_meta.STREETLABE)
seg["corridor_n_segments"] = seg.corridor_id.map(corr_meta.n_seg)
seg["ped_ksi_corridor"] = seg.corridor_id.map(corr_meta.ped_ksi_seg)

print("Loading centerline geometry ...")
cl = gpd.read_file(GIS / "Street_Centerline")
cl["SEG_ID"] = pd.to_numeric(cl.SEG_ID, errors="coerce")
cl = cl[["SEG_ID", "geometry"]].to_crs(4326)
gdf = cl.merge(seg, on="SEG_ID", how="inner")
print(f"  joined geometry to {len(gdf):,} of {len(seg):,} segments")
if len(gdf) != len(seg):
    print(f"  WARNING: {len(seg) - len(gdf)} segments have no geometry")


# ---------------------------------------------------------------------------
# 2. Geometry reduction
# ---------------------------------------------------------------------------
def quantise_line(coords, decimals):
    out = []
    for pt in coords:
        p = (round(pt[0], decimals), round(pt[1], decimals))
        if not out or p != out[-1]:
            out.append(p)
    return out if len(out) >= 2 else None


def quantise(geom, decimals):
    t = geom.geom_type
    if t == "LineString":
        q = quantise_line(list(geom.coords), decimals)
        return {"type": "LineString", "coordinates": q} if q else None
    if t == "MultiLineString":
        parts = [q for q in (quantise_line(list(g.coords), decimals)
                             for g in geom.geoms) if q]
        if not parts:
            return None
        if len(parts) == 1:
            return {"type": "LineString", "coordinates": parts[0]}
        return {"type": "MultiLineString", "coordinates": parts}
    return None


print(f"Quantising to {COORD_DECIMALS} decimals "
      f"(~{110_000 / 10 ** COORD_DECIMALS:.1f} m grid) ...")
geoms, dropped = {}, 0
for sid, g in zip(gdf.SEG_ID, gdf.geometry):
    q = quantise(g, COORD_DECIMALS)
    if q is None:
        dropped += 1
        continue
    geoms[sid] = q
n_vert = sum(len(c["coordinates"]) if c["type"] == "LineString"
             else sum(len(p) for p in c["coordinates"]) for c in geoms.values())
print(f"  {len(geoms):,} lines, {n_vert:,} vertices"
      + (f", {dropped} collapsed and dropped" if dropped else ""))

CLASS_LABELS = {2: "Arterial", 3: "Collector", 4: "Local", 5: "Minor local"}


# ---------------------------------------------------------------------------
# 3. Features
# ---------------------------------------------------------------------------
def block_range(r):
    lo, hi = r.get("L_HUNDRED"), r.get("R_HUNDRED")
    vals = [int(v) for v in (lo, hi) if pd.notna(v)]
    return f"{min(vals)}" if vals else ""


print("Building features ...")

# A property name costs its own length on EVERY one of 39,761 features, so the
# schema is deliberately lean: anything the frontend can derive is derived
# there, not shipped 39,761 times. `class_label` comes from `class`,
# `ksi_per_mile` from ped_ksi_seg/exposure_mi, `mu_spf_seg` from
# mu_per_mile*exposure_mi. Emitting all of them cost 36 MB; this costs a third
# of that.
#
# Zero and null values are omitted, which is safe because every consumer either
# gates on a boolean flag or coalesces: MapLibre's ["to-number", ["get", k], 0]
# yields 0 for an absent key, and the frontend reads `?? 0`.
ALWAYS = {"seg_id", "has_model", "has_aadt", "has_crashes", "in_ranking"}

features = []
for r in gdf.to_dict("records"):
    sid = r["SEG_ID"]
    if sid not in geoms:
        continue

    name = str(r.get("STREETLABE") or r.get("ST_NAME") or f"Segment {int(sid)}")
    blk = block_range(r)
    in_model = bool(r.get("in_model"))

    props = {
        # --- identity. `seg_id`, never `unit_id` — see module docstring. ---
        "seg_id": int(sid),
        "unit_name": f"{blk} {name}".strip() if blk else name,
        "corridor_id": nz(r.get("corridor_id"), 0),
        "corridor_n": nz(r.get("corridor_n_segments"), 0),

        # --- form ---
        "class": int(r["CLASS"]),
        "oneway": bool(r.get("is_oneway")),
        "divided": bool(r.get("is_divided")),
        "length_mi": nz(r.get("length_mi"), 3),
        "exposure_mi": nz(r.get("exposure_mi"), 3),

        # --- observed, mid-block only ---
        "ped_ksi_seg": int(r.get("ped_ksi_seg") or 0),
        "ped_any_seg": int(r.get("ped_any_seg") or 0),
        "ped_deaths_seg": int(r.get("ped_deaths_seg") or 0),
        "ksi_corridor": nz(r.get("ped_ksi_corridor"), 0),

        # --- model. NOT comparable to the intersection eb_ksi. ---
        "mu_per_mile": nz(r.get("mu_per_mile"), 3),
        "eb_ksi_seg": nz(r.get("eb_ksi_seg"), 3),
        "eb_weight_seg": nz(r.get("eb_weight_seg"), 3),
        "rank_seg_spf": nz(r.get("rank_seg_spf"), 0),
        "tier": (str(r["seg_risk_tier"])
                 if pd.notna(r.get("seg_risk_tier")) else None),

        # --- corridor model, where empirical Bayes carries real weight ---
        "eb_ksi_corr": nz(r.get("eb_ksi_corr"), 3),
        "eb_weight_corr": nz(r.get("eb_weight_corr"), 3),
        "rank_corr_spf": nz(r.get("rank_corr_spf"), 0),

        # --- context ---
        "aadt": nz(r.get("aadt"), 0),
        "hin_frac": nz(r.get("hin_frac"), 2),
        "pop_800m": nz(r.get("pop_800m"), 0),
        "schools_200m": int(r.get("schools_200m") or 0),
        "parks_200m": int(r.get("parks_200m") or 0),

        # --- gate flags: always present, always boolean, never null ---
        "has_model": in_model,
        "has_aadt": bool(r.get("aadt_real")),
        "has_crashes": int(r.get("ped_ksi_seg") or 0) > 0,
        "in_ranking": in_model,
    }
    props = {k: v for k, v in props.items()
             if k in ALWAYS or (v is not None and v != 0 and v is not False)}
    features.append({"type": "Feature", "geometry": geoms[sid],
                     "properties": props})

avg = sum(len(f["properties"]) for f in features) / max(len(features), 1)
print(f"  {len(features):,} features, {avg:.1f} properties each after omitting "
      "zeros and nulls")

# ---------------------------------------------------------------------------
# 4. Crash accounting, carried with the data
# ---------------------------------------------------------------------------
asg = pd.read_csv(ASSIGN_CSV)
ksi = asg[asg.ped_ksi_final.astype(bool)] if "ped_ksi_final" in asg else asg
seg_assigned = int(ksi.SEG_ID.notna().sum())
seg_unplaced = int(ksi.SEG_ID.isna().sum())

on_modelled = int(sum(f["properties"].get("ped_ksi_seg", 0) for f in features))

metadata = {
    "name": "WalkSafe-AI Philadelphia street segments",
    "city": "philadelphia",
    "unit_type": "line",
    "unit_label": "street segment",
    "description": (
        "Philadelphia street centerline segments (CLASS 2-5, the walkable "
        "network) carrying mid-block pedestrian KSI 2015-2024 and a segment-"
        "level safety performance function with length as an offset."
    ),
    "caveat": (
        "Mid-block crashes only. This layer and the intersection layer "
        "partition the crash set: a crash is counted in exactly one of them, "
        "never both. Their risk measures are NOT comparable — different "
        "denominators, disjoint crash sets, different covariates."
    ),
    "not_comparable_to": {
        "intersections.geojson": (
            "eb_ksi is expected pedestrian KSI per intersection over 10 years. "
            "eb_ksi_seg is expected MID-BLOCK pedestrian KSI per segment over "
            "10 years, with length as an offset and without the High Injury "
            "Network term. Do not rank them against each other or sum them. "
            "The only legitimate combined statement is the crash accounting "
            "below."
        )
    },
    "crash_window": "2015-2024",
    "crash_accounting": {
        "geocoded_ped_ksi": 1494,
        "intersection_layer": 767,
        "intersection_within_25m": 756,
        "intersection_snap_failures": 11,
        "segment_layer": 727,
        "segment_assigned": seg_assigned,
        "segment_unplaced": seg_unplaced,
        "segment_on_walkable_network": on_modelled,
        "segment_on_expressway_ramp_private": 727 - seg_unplaced - on_modelled,
        "rule": (
            "INTERSECT_TYPE decides: >0 goes to the intersection layer, 0 to "
            "the segment layer, regardless of distance to a node. "
            "INTERSECTION_RELATED is unusable (70% missing, 12 'Y' in a decade)."
        ),
    },
    "exposure": {
        "definition": (
            "Segment length outside the 25 m intersection influence zone at "
            "each end, so the segment and intersection layers do not both "
            "claim the same roadway."
        ),
        "network_mi": nz(float(gdf.length_mi.sum()), 0),
        "exposure_mi": nz(float(gdf.exposure_mi.sum()), 0),
        "zero_exposure_segments": int((gdf.exposure_mi <= 0.005).sum()),
    },
    "spf": {
        "family": "negative binomial (NB2), log link",
        "offset": "log(exposure_mi), coefficient fixed at 1",
        "aadt_note": (
            "Only 33.5% of segments carry a genuine AADT count; PennDOT "
            "assigns a nominal 300 veh/day to local roads (8.6% real on minor "
            "local streets). The volume slope is identified only from segments "
            "with a real count; road class carries the hierarchy elsewhere."
        ),
        "hin_note": (
            "The 2020 High Injury Network was derived from crash data over a "
            "period overlapping this outcome window, so it is excluded from "
            "the primary model as endogenous. Carried as a map property and "
            "reported as a secondary fit."
        ),
        "eb_note": (
            "The empirical Bayes weight is near 1 across the mass of zero-"
            "crash units, where there is no data to weight. Measured where "
            "crashes are, observed data carries 16.5% of the segment estimate "
            "and 55.7% of the corridor estimate. Map the SPF expectation per "
            "mile; rank on the corridor EB estimate."
        ),
    },
    "coordinate_system": "EPSG:4326 (WGS84)",
    "coordinate_decimals": COORD_DECIMALS,
    "generated": datetime.now().isoformat(timespec="seconds"),
}

geojson = {"type": "FeatureCollection", "metadata": metadata,
           "features": features}

print(f"\nWriting {OUT.relative_to(REPO)} ...")
with open(OUT, "w") as f:
    json.dump(geojson, f, separators=(",", ":"))

# Report the transfer size, not the raw size. GitHub Pages serves gzipped and
# GeoJSON compresses to under a tenth, so raw bytes badly overstate the cost:
# 20 MB raw is 1.8 MB on the wire, against 0.8 MB for the 16,984-point
# intersection layer. The raw figure still matters for browser parse time and
# memory, so both are printed.
raw_mb = OUT.stat().st_size / 1_048_576
gz_mb = len(gzip.compress(OUT.read_bytes(), 6)) / 1_048_576
print(f"  Raw:  {raw_mb:6.2f} MB   (parse/memory cost)")
print(f"  Gzip: {gz_mb:6.2f} MB   (transfer cost — what the browser downloads)")
if gz_mb > SIZE_TARGET_GZ_MB:
    print(f"  WARNING: over the {SIZE_TARGET_GZ_MB} MB transfer target.")

print(f"\nMid-block ped KSI on the layer: {on_modelled:,}")
print(f"Segments with >=1 KSI: {sum(1 for f in features if f['properties']['has_crashes']):,}")
print(f"Segments in the model: {sum(1 for f in features if f['properties']['has_model']):,}")
print(f"Segments with a real AADT count: {sum(1 for f in features if f['properties']['has_aadt']):,}")
print("\nDone.")
