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

* QUANTISATION MUST STAY FINE RELATIVE TO THE CARRIAGEWAY. 5 dp was used
  originally and was too coarse: at latitude 4.65 it is a 1.24 m grid, so a
  6.12 m median carriageway spans only 5 cells. Vertices snapped onto that
  grid stopped being parallel, kerb lines went ragged, 15.5% of rings
  collapsed to a triangle or quad and 1,481 polygons (1.5%) became
  self-intersecting. Median boundary displacement was 0.76 m — 13% of street
  width, 27% at p90. 6 dp gives a 0.11 m grid and ~55 cells across the same
  street. Do not reintroduce 5 dp as a size optimisation: the file is served
  from R2, where the 25 MiB asset cap that motivated it does not apply.

* Simplification and quantisation were verified NOT to be a georeferencing
  problem. Registering the footprints against 5,011 OSM carriageway
  centreline points put 99.9% of them inside a footprint at zero shift, with
  a sharp peak — the source CRS resolves correctly despite pyproj reporting
  only a ballpark datum shift, because CGS_CarMAGBOG is MAGNA-SIRGAS-based
  (GRS80 flattening, semi-major inflated by 2,550 m for Bogotá's elevation).

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
from shapely.geometry import shape
from shapely.ops import unary_union
from shapely.validation import explain_validity, make_valid

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
SRC = HERE / "source"
WORK = Path(os.getenv("WALKSAFE_WORK_DIR", REPO / "pipeline" / "work"))
OUT = HERE / "bogota_segments.geojson"

SHP = SRC / "Calles_datos.shp"
RANKED = WORK / "bogota_segment_ranked.csv"

#: Metres. Kept well under half the median carriageway width (6.12 m) so a
#: street footprint stays a rectangle rather than degenerating to a triangle.
#: 1.0 m was 16% of that width — defensible under a size cap, unnecessary once
#: the file moved to R2. DP is kept rather than dropped because 5.1M raw
#: vertices is a rendering cost, and measured on its own DP is well behaved
#: (max displacement 1.52 m, 2 invalid in 809).
SIMPLIFY_M = 0.5

#: Decimal places for output coordinates. 6 dp is ~0.11 m at this latitude.
#: See the quantisation note in the module docstring before lowering this.
COORD_DECIMALS = 6

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
print(f"\nSimplify at {SIMPLIFY_M} m (median street width is 6.12 m, so the")
print(f"tolerance stays well below half-width and rectangles survive):")
print(f"  vertices before: {before:,}")
print(f"  vertices after:  {after:,}  ({after/before:.1%}, "
      f"{(1-after/before)*100:.0f}% removed)")


def polygonal(geom):
    """Keep only the polygonal part of whatever make_valid returns.

    make_valid resolves a self-intersecting ring by splitting it, and can hand
    back a GeometryCollection carrying stray LineStrings alongside the polygons.
    Those are not street footprints and would break the fill layer, so they are
    discarded and only the areal parts kept.
    """
    if geom is None or geom.is_empty:
        return geom
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom
    if geom.geom_type == "GeometryCollection":
        parts = [p for p in geom.geoms if p.geom_type in ("Polygon", "MultiPolygon")]
        if not parts:
            return None
        return parts[0] if len(parts) == 1 else unary_union(parts)
    return None


bad = ~simp.is_valid
print(f"\nRepairing invalid geometry after simplification ...")
print(f"  invalid before make_valid: {int(bad.sum()):,} of {len(simp):,} "
      f"({bad.mean():.1%})")
simp.loc[bad] = simp.loc[bad].apply(lambda g: polygonal(make_valid(g)))
still = simp.isna() | ~simp.is_valid
print(f"  invalid after  make_valid: {int(still.sum()):,}")

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


_grid_m = 10 ** -COORD_DECIMALS * 111_320 * math.cos(math.radians(4.65))
print(f"\nQuantising to {COORD_DECIMALS} dp (~{_grid_m:.2f} m at latitude 4.65, "
      f"~{6.12 / _grid_m:.0f} cells across a median carriageway) ...")
geoms, dropped_idx = {}, []
for idx, geom in wgs.items():
    e = encode(geom, COORD_DECIMALS)
    if e is None:
        dropped_idx.append(idx)
        continue
    geoms[idx] = e
dropped = len(dropped_idx)
def encoded_stats(enc):
    """Vertices and rings in an encoded geometry dict.

    The previous version summed len(c["coordinates"]), which for a Polygon is
    the number of RINGS, not vertices. It under-reported the shipped geometry
    by a factor of ten (101,955 rings read as vertices against 1,067,509
    actual) and made the simplification look far more aggressive than it was.
    """
    v = r_ = 0
    polys = [enc["coordinates"]] if enc["type"] == "Polygon" else enc["coordinates"]
    for rings in polys:
        for ring in rings:
            v += len(ring)
            r_ += 1
    return v, r_


final_v = final_r = 0
for c in geoms.values():
    v, r_ = encoded_stats(c)
    final_v += v
    final_r += r_
print(f"  {len(geoms):,} polygons, {final_v:,} vertices in {final_r:,} rings"
      + (f", {dropped} collapsed and dropped" if dropped else ""))
print(f"  total reduction from source: {before:,} -> {final_v:,} "
      f"({(1-final_v/before)*100:.0f}% removed)")

# Quantisation can re-introduce self-intersection after make_valid by snapping
# distinct vertices onto the same cell, so validity is re-checked on what is
# actually written rather than on the pre-quantisation geometry.
print("\nValidity of the encoded output ...")
enc_invalid = {}
for idx, c in geoms.items():
    gg = shape(c)
    if not gg.is_valid:
        enc_invalid[idx] = explain_validity(gg).split("[")[0].strip()
print(f"  invalid after quantisation: {len(enc_invalid):,} of {len(geoms):,} "
      f"({len(enc_invalid)/max(len(geoms),1):.2%})")

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

# Anything still invalid, or dropped for collapsing, is named. A geometry that
# vanishes silently takes its crash count out of the map with it, and at this
# scale nobody would notice a handful going missing.
codes = {i: str(rec["CodigoCL"]) for i, rec in enumerate(gdf.to_dict("records"))}


def _seg_id(code, i):
    try:
        return int(code.replace("CL", ""))
    except ValueError:
        return i


if dropped_idx:
    print(f"\n  DROPPED (geometry collapsed under quantisation): {len(dropped_idx)}")
    for i in dropped_idx:
        print(f"    seg_id {_seg_id(codes[i], i)}  ({codes[i]})")
if enc_invalid:
    print(f"\n  STILL INVALID after make_valid + quantisation: {len(enc_invalid)}")
    for i, why in sorted(enc_invalid.items())[:50]:
        print(f"    seg_id {_seg_id(codes[i], i)}  ({codes[i]})  {why}")
    if len(enc_invalid) > 50:
        print(f"    ... and {len(enc_invalid) - 50} more")

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
        f"to {COORD_DECIMALS} dp (~0.11 m at this latitude): {before:,} source "
        f"vertices reduced to {final_v:,} in {final_r:,} rings. Invalid "
        f"geometry is repaired with make_valid after simplification; "
        f"{len(enc_invalid)} polygons remain invalid and are named in the "
        f"build log."
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
