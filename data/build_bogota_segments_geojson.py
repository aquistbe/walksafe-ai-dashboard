#!/usr/bin/env python3
"""
Build data/bogota_segments.geojson — Bogotá street segments with pedestrian
crash counts and a segment-level safety performance estimate.

Inputs (produced by `make bogota-segments`):
  data/source/Calles_datos.shp                geometry + attributes
  pipeline/work/bogota_segment_ranked.csv     model output from step 15

Output:
  data/bogota_segments.geojson

This artefact is NOT committed and is NOT served from the site's own origin.
At ~30 MB it exceeds Cloudflare Workers' 25 MiB per-asset limit, so it lives
in R2 and the browser fetches it directly. `make upload-bogota-segments`
publishes it. See data/source/README.md.

Design notes
------------
* SIMPLIFICATION TOLERANCE IS CONSTRAINED BY THE GEOMETRY. These are street
  FOOTPRINT polygons — long thin rectangles with a median width of 6.14 m.
  Douglas-Peucker at a tolerance above roughly half the width collapses the
  rectangle into a triangle, so the 5-10 m tolerances that suit a zone
  boundary would destroy the street. The tolerance here is deliberately small
  and the vertex count is reported before and after.

* Quantisation to 5 dp (~1.1 m) is applied after simplifying, and is
  topology-safe: adjacent footprints that share a boundary map their shared
  vertices to the same cell.

* Field names match data/segments.geojson wherever the concepts map, so the
  existing line rendering, SegmentSidebar and SegmentInfoPanel work with
  minimal change. Distances are in KILOMETRES, not miles — the dataset config
  declares the unit and the UI formats accordingly.

* Bogotá's outcome is pedestrian-INVOLVED crashes, not KSI, and exposure
  includes junctions. Neither is comparable to Philadelphia's segment layer.
  metadata.not_comparable_to says so in the file.
"""

import gzip
import json
import math
import os
import sys
from datetime import datetime
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
SRC = HERE / "source"
WORK = Path(os.getenv("WALKSAFE_WORK_DIR", REPO / "pipeline" / "work"))
OUT = HERE / "bogota_segments.geojson"

SHP = SRC / "Calles_datos.shp"
RANKED = WORK / "bogota_segment_ranked.csv"

#: Metres. Kept well under half the median carriageway width (6.14 m) so a
#: street footprint stays a rectangle rather than degenerating to a triangle.
SIMPLIFY_M = 1.0
COORD_DECIMALS = 5
METRIC_CRS = 3116

for p in (SHP, RANKED):
    if not p.exists():
        sys.exit(f"Missing {p}\nRun: make bogota-segments")


def nz(v, digits=4):
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
print("Loading model output ...")
r = pd.read_csv(RANKED)
print(f"  {len(r):,} segments, {int(r.si_act_pea.fillna(0).sum()):,} pedestrian crashes")

print("Loading geometry ...")
g = gpd.read_file(SHP, columns=["CodigoCL"])
print(f"  {len(g):,} polygons, CRS {str(g.crs)[:40]}...")

gdf = g.merge(r, on="CodigoCL", how="inner")
print(f"  joined: {len(gdf):,}")

# ---------------------------------------------------------------------------
# 2. Simplify, then reproject, then quantise
# ---------------------------------------------------------------------------
metric = gdf.geometry.to_crs(METRIC_CRS)


def count_vertices(geoseries):
    def nv(geom):
        if geom is None or geom.is_empty:
            return 0
        polys = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
        return sum(len(p.exterior.coords) + sum(len(i.coords) for i in p.interiors)
                   for p in polys)
    return int(geoseries.apply(nv).sum())


before = count_vertices(metric)
simp = metric.simplify(SIMPLIFY_M, preserve_topology=True)
after = count_vertices(simp)
print(f"\nSimplify at {SIMPLIFY_M} m (median street width is 6.14 m, so the")
print(f"tolerance stays well below half-width and rectangles survive):")
print(f"  vertices before: {before:,}")
print(f"  vertices after:  {after:,}  ({after/before:.1%}, "
      f"{(1-after/before)*100:.0f}% removed)")

wgs = simp.to_crs(4326)


def quant_ring(coords, d):
    out = []
    for x, y in coords:
        p = (round(x, d), round(y, d))
        if not out or p != out[-1]:
            out.append(p)
    if len(out) >= 3 and out[0] != out[-1]:
        out.append(out[0])
    return out if len(out) >= 4 else None


def encode(geom, d):
    if geom is None or geom.is_empty:
        return None
    polys = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
    kept = []
    for p in polys:
        rings = [r for r in ([quant_ring(p.exterior.coords, d)]
                             + [quant_ring(i.coords, d) for i in p.interiors]) if r]
        if rings:
            kept.append(rings)
    if not kept:
        return None
    return ({"type": "Polygon", "coordinates": kept[0]} if len(kept) == 1
            else {"type": "MultiPolygon", "coordinates": kept})


print(f"\nQuantising to {COORD_DECIMALS} dp (~1.1 m) ...")
geoms, dropped = {}, 0
for idx, geom in wgs.items():
    e = encode(geom, COORD_DECIMALS)
    if e is None:
        dropped += 1
        continue
    geoms[idx] = e
final_v = sum(len(c["coordinates"]) if c["type"] == "Polygon"
              else sum(len(p) for p in c["coordinates"]) for c in geoms.values())
print(f"  {len(geoms):,} polygons, {final_v:,} vertices"
      + (f", {dropped} collapsed and dropped" if dropped else ""))
print(f"  total reduction from source: {before:,} -> {final_v:,} "
      f"({(1-final_v/before)*100:.0f}% removed)")

# ---------------------------------------------------------------------------
# 3. Features
# ---------------------------------------------------------------------------
# Calles_datos carries NO road-class field (CodigoCL is uniformly "CL", a
# sequential id). This hierarchy is DERIVED from lanes and width so the shared
# line renderer, which styles width by class, has something to work with. It is
# a display convenience, not a source attribute.
def road_class(lanes, width):
    if lanes >= 4 or width >= 15:
        return 2      # arterial
    if lanes >= 3 or width >= 10:
        return 3      # collector
    if lanes >= 2 or width >= 6:
        return 4      # local
    return 5          # minor local


ALWAYS = {"seg_id", "has_model", "has_crashes", "has_ses", "in_ranking"}

print("Building features ...")
features = []
for i, row in enumerate(gdf.to_dict("records")):
    if i not in geoms:
        continue
    code = str(row["CodigoCL"])
    try:
        seg_id = int(code.replace("CL", ""))
    except ValueError:
        seg_id = i

    crashes = int(row.get("si_act_pea") or 0)
    lanes = float(row.get("lanes") or 0)
    width = float(row.get("width_m") or 0)
    in_model = bool(row.get("in_model"))
    length_m = row.get("length_m")
    length_km = (length_m / 1000) if pd.notna(length_m) else None

    props = {
        "seg_id": seg_id,
        "unit_name": code,
        "class": road_class(lanes, width),

        # Exposure is not emitted separately: it EQUALS length here. Unlike
        # Philadelphia there is no intersection influence zone to subtract, so
        # junctions are included. Duplicating the value would cost ~1.4 MB
        # across 100,743 features to say the same thing twice.
        "length_km": nz(length_km, 4),

        "ped_crashes_seg": crashes,
        "mu_per_km": nz(row.get("mu_per_km"), 2),
        "eb_ksi_seg": nz(row.get("eb_ksi_seg"), 3),
        "eb_weight_seg": nz(row.get("eb_weight_seg"), 3),
        "rank_seg_spf": nz(row.get("rank_seg_spf"), 0),
        "tier": (str(row["tier"]) if pd.notna(row.get("tier")) else None),

        "width_m": nz(width, 1),
        "lanes": nz(lanes, 1),
        "speed": nz(row.get("speed"), 0),
        "has_signal": bool(row.get("has_signal")),
        "ses_cat": nz(row.get("ses_cat"), 0),

        "has_model": in_model,
        "has_crashes": crashes > 0,
        "has_ses": bool(pd.notna(row.get("ses_cat"))),
        "in_ranking": in_model,
    }
    props = {k: v for k, v in props.items()
             if k in ALWAYS or (v is not None and v != 0 and v is not False)}
    features.append({"type": "Feature", "geometry": geoms[i], "properties": props})

avg = sum(len(f["properties"]) for f in features) / max(len(features), 1)
print(f"  {len(features):,} features, {avg:.1f} properties each")

# ---------------------------------------------------------------------------
# 4. Metadata and write
# ---------------------------------------------------------------------------
n_model = sum(1 for f in features if f["properties"]["has_model"])
n_crash = sum(1 for f in features if f["properties"]["has_crashes"])
total_crashes = sum(f["properties"].get("ped_crashes_seg", 0) for f in features)

metadata = {
    "name": "WalkSafe-AI Bogotá street segments",
    "city": "bogota",
    "unit_type": "line",
    "unit_label": "street segment",
    "distance_unit": "km",
    "attribution": ("Source: City of Bogotá open data; processing by "
                    "Universidad de los Andes."),
    "description": (
        "Bogotá street segments (footprint polygons) carrying pedestrian-"
        "involved crash counts and a negative-binomial safety performance "
        "function with log segment length as an offset."
    ),
    "caveat": (
        "The outcome is pedestrian-INVOLVED crashes, not killed or seriously "
        "injured. Exposure is derived length (carriageway area / carriageway "
        "width) and INCLUDES junctions, unlike the Philadelphia segment layer "
        "which excludes them."
    ),
    "not_comparable_to": {
        "segments.geojson": (
            "Philadelphia's segment measure is expected MID-BLOCK KSI per mile "
            "with junctions excluded from exposure. Bogotá's is expected "
            "pedestrian-involved crashes per km with junctions included. "
            "Different outcome, different exposure, different covariates."
        ),
        "bogota_zats.geojson": (
            "The ZAT layer reports area-level relative risks for a cluster "
            "profile. This layer reports an expected count per km of street. "
            "They are different units and different models."
        ),
    },
    "crash_window": "2015-2019",
    "crash_window_note": (
        "Assumed, not verified: the shapefile carries no window field. The "
        "sibling source bogota_atropellos_2015_2019_mallavial.json names that "
        "range and the totals are consistent with the ZAT layer. See "
        "pipeline/15_bogota_segment_spf.py."
    ),
    "coverage": {
        "segments": len(features),
        "with_model": n_model,
        "with_crashes": n_crash,
        "pedestrian_crashes": total_crashes,
    },
    "taxonomy_note": (
        "Bogotá's built-environment features and the Gemini scoring taxonomy "
        "in scoring/prompts.py both descend from the CANVAS pedestrian safety "
        "audit instrument. They are not independent instruments."
    ),
    "geometry_note": (
        f"Street footprint polygons simplified at {SIMPLIFY_M} m and quantised "
        f"to {COORD_DECIMALS} dp: {before:,} vertices reduced to {final_v:,}."
    ),
    "coordinate_system": "EPSG:4326 (WGS84)",
    "source_crs": "PCS_CarMAGBOG",
    "generated": datetime.now().isoformat(timespec="seconds"),
}

print(f"\nWriting {OUT.relative_to(REPO)} ...")
with open(OUT, "w") as f:
    json.dump({"type": "FeatureCollection", "metadata": metadata,
               "features": features}, f, separators=(",", ":"))
raw = OUT.stat().st_size / 1_048_576
gz = len(gzip.compress(OUT.read_bytes(), 6)) / 1_048_576
print(f"  Raw:  {raw:6.2f} MB   (exceeds Cloudflare's 25 MiB asset cap -> R2)"
      if raw > 25 else f"  Raw:  {raw:6.2f} MB")
print(f"  Gzip: {gz:6.2f} MB   (transfer cost)")
print(f"\nsegments {len(features):,} | with a model estimate {n_model:,} | "
      f"with a crash {n_crash:,} | crashes {total_crashes:,}")
print("\nDone.")
