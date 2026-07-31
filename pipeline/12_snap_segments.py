"""
12_snap_segments.py
WALKSAFE-AI street-segment extension - Step 12 (Part A1)

Recovers the mid-block pedestrian crashes the intersection ranking excludes by
design, and assigns them to street centerline segments.

Of 1,494 geocoded pedestrian KSI 2015-2024, 727 are coded mid-block
(INTERSECT_TYPE = 0). The intersection pipeline keeps the 269 of those that
happen to lie within 25 m of a node and silently drops the other 458. Roughly
half the citywide burden is invisible to an intersection-based ranking.

Assignment rule: the CODE decides, not the distance.
  INTERSECT_TYPE  > 0  -> intersection layer
  INTERSECT_TYPE == 0  -> segment layer, wherever it falls

This partitions the crash set cleanly: intersection + segment = 1,494 with no
double counting, so the two layers together account for the full burden. It
also means 269 crashes MOVE OUT of the intersection counts, which refits the
intersection SPF and reorders its ranking. That is intended.

INTERSECTION_RELATED is not used anywhere: it is 70.2% missing in these
extracts and carries only 12 'Y' values across the decade.

Outputs
  work/segment_counts.csv              per-segment crash counts and exposure
  outputs/segment_crash_assignment.csv one row per crash, all diagnostics
  outputs/qc_logs/qc_segments.txt      bucket accounting; asserts the total
"""
import geopandas as gpd
import pandas as pd
import numpy as np
from shapely.geometry import Point
from config import (GIS, WORK, OUTPUTS, QC_LOGS, CRS, M2FT, SNAP_BUFFER_M,
                    WALKABLE_CLASSES, CLASS_LABELS, QCLog)

L = QCLog("segments")

# ---------------------------------------------------------------------------
# 1. Segment universe
# ---------------------------------------------------------------------------
cl = gpd.read_file(GIS / "Street_Centerline").to_crs(CRS)
L(f"Street_Centerline features: {len(cl):,}")

cl["CLASS"] = pd.to_numeric(cl.CLASS, errors="coerce")

# CLASS 14 is the city boundary line — a cartographic artifact, not a street.
# Leaving it in would attract crashes near the county line onto a non-street.
assign_uni = cl[cl.CLASS.notna() & (cl.CLASS != 14)].copy()
assign_uni["modelled"] = assign_uni.CLASS.isin(WALKABLE_CLASSES)

L(f"Assignment universe (all but CLASS 14): {len(assign_uni):,}")
L(f"Modelled universe (CLASS {WALKABLE_CLASSES}): {int(assign_uni.modelled.sum()):,}")
L("\nCLASS composition of the assignment universe:")
for c, g in assign_uni.groupby("CLASS"):
    mi = g.geometry.length.sum() / 5280
    flag = "modelled" if c in WALKABLE_CLASSES else "assignment sink"
    L(f"   {int(c):>2} {CLASS_LABELS.get(int(c), '?'):<16} n={len(g):>6,}  {mi:>7.0f} mi   {flag}")

assign_uni["length_ft"] = assign_uni.geometry.length

# ---------------------------------------------------------------------------
# 2. Intersection influence zone (IIZ)
#
# Exposure for a segment is the roadway that is NOT already represented by the
# intersection product. FNODE_/TNODE_ resolve to Street_Nodes.NODE_ID at 100%,
# so a segment's endpoints ARE nodes and the zone can be subtracted exactly
# rather than approximated by proximity.
#
# A node is IIZ-eligible if it is a real junction: degree >= 3 over the
# assignment universe, or present in Intersection_Controls (the universe the
# intersection ranking actually uses). Degree-2 nodes are centerline breaks at
# name changes and carriageway splits, not intersections.
# ---------------------------------------------------------------------------
nodes = gpd.read_file(GIS / "Street_Nodes").to_crs(CRS).drop_duplicates("NODE_ID")
ctrl = gpd.read_file(GIS / "Intersection_Controls.geojson")[["node_id"]].drop_duplicates()

deg = pd.concat([
    pd.to_numeric(assign_uni.FNODE_, errors="coerce"),
    pd.to_numeric(assign_uni.TNODE_, errors="coerce"),
]).dropna().astype(int).value_counts()

nodes["NODE_ID"] = pd.to_numeric(nodes.NODE_ID, errors="coerce")
nodes["degree"] = nodes.NODE_ID.map(deg).fillna(0).astype(int)
nodes["in_controls"] = nodes.NODE_ID.isin(ctrl.node_id)
nodes["iiz"] = (nodes.degree >= 3) | nodes.in_controls

L(f"\nStreet_Nodes: {len(nodes):,}")
L(f"  degree >= 3 .................. {int((nodes.degree >= 3).sum()):,}")
L(f"  in Intersection_Controls ..... {int(nodes.in_controls.sum()):,}")
L(f"  IIZ-eligible (either) ........ {int(nodes.iiz.sum()):,}")

BUF_FT = SNAP_BUFFER_M * M2FT
iiz_pt = nodes.loc[nodes.iiz, ["NODE_ID", "geometry"]].set_index("NODE_ID").geometry

# Subtract only the segment's OWN endpoint discs. Because endpoints are nodes
# by construction, a disc from any other node cannot fall in a segment's
# interior without the centerline having been split there.
fn = pd.to_numeric(assign_uni.FNODE_, errors="coerce")
tn = pd.to_numeric(assign_uni.TNODE_, errors="coerce")
elig = set(iiz_pt.index)
assign_uni["n_iiz_ends"] = fn.isin(elig).astype(int) + tn.isin(elig).astype(int)


def exposure_of(row):
    """Length of the segment lying outside its own endpoints' influence discs."""
    if row.n_iiz_ends == 0:
        return row.length_ft
    geom = row.geometry
    for nid in (row.FNODE_, row.TNODE_):
        try:
            nid = int(nid)
        except (TypeError, ValueError):
            continue
        if nid in elig:
            geom = geom.difference(iiz_pt.loc[nid].buffer(BUF_FT))
            if geom.is_empty:
                return 0.0
    return geom.length


assign_uni["exposure_ft"] = assign_uni.apply(exposure_of, axis=1)
assign_uni["exposure_mi"] = assign_uni.exposure_ft / 5280
assign_uni["length_mi"] = assign_uni.length_ft / 5280

mod = assign_uni[assign_uni.modelled]
zero_exp = int((mod.exposure_ft <= 1).sum())
L(f"\nExposure (modelled segments, length outside the {SNAP_BUFFER_M} m influence zone):")
L(f"  segments with ~zero exposure ... {zero_exp:,} of {len(mod):,} ({zero_exp/len(mod):.1%})")
L(f"  exposure_ft quantiles .......... "
  f"{ {q: round(float(mod.exposure_ft.quantile(q)), 1) for q in (.1,.25,.5,.75,.9)} }")
L(f"  total network length ........... {mod.length_ft.sum()/5280:,.0f} mi")
L(f"  total exposure length .......... {mod.exposure_ft.sum()/5280:,.0f} mi "
  f"({mod.exposure_ft.sum()/mod.length_ft.sum():.1%} of network)")

# ---------------------------------------------------------------------------
# 3. Crashes
# ---------------------------------------------------------------------------
cr = pd.read_parquet(WORK / "ped_crashes_snapped.parquet")
cr = cr[cr.coord_ok].copy()
ksi = cr[cr.ped_ksi_final]
L(f"\nGeocoded pedestrian crashes: {len(cr):,}  (KSI {len(ksi):,})")

cr["is_midblock"] = cr.itype.fillna(0) == 0
L(f"KSI INTERSECT_TYPE: {ksi.itype.value_counts(dropna=False).sort_index().to_dict()}")
L(f"KSI mid-block-coded (itype 0): {int(ksi.itype.fillna(0).eq(0).sum()):,}")

pts = gpd.GeoDataFrame(
    cr, geometry=[Point(xy) for xy in zip(cr.lon, cr.lat)], crs=4326
).to_crs(CRS)

# ---------------------------------------------------------------------------
# 4. Assign mid-block crashes to segments
# ---------------------------------------------------------------------------
mb = pts[pts.is_midblock].copy()
segs = assign_uni[["SEG_ID", "CLASS", "modelled", "geometry"]].copy()

j = gpd.sjoin_nearest(mb, segs, how="left", distance_col="seg_dist_ft",
                      max_distance=SNAP_BUFFER_M * M2FT)

# sjoin_nearest returns EVERY tied row. The intersection pipeline broke ties
# with `~index.duplicated(keep="first")` — arbitrary, and at segment level ties
# are systematic (divided carriageways, parallel alleys). Break them
# deterministically: nearest, then the larger road, then a stable id.
n_tied = int(j.index.duplicated(keep=False).sum())
j = (j.sort_values(["seg_dist_ft", "CLASS", "SEG_ID"])
       .loc[lambda d: ~d.index.duplicated(keep="first")])
j["seg_dist_m"] = j.seg_dist_ft / M2FT

assigned = j[j.SEG_ID.notna()].copy()
unplaced = j[j.SEG_ID.isna()].copy()
L(f"\nMid-block crashes snapped to a segment within {SNAP_BUFFER_M} m: "
  f"{len(assigned):,} of {len(mb):,}")
L(f"  rows decided by the tie-break: {n_tied:,}")
L(f"  seg_dist_m quantiles: "
  f"{ {q: round(float(assigned.seg_dist_m.quantile(q)), 1) for q in (.25,.5,.75,.9)} }")

# ---------------------------------------------------------------------------
# 5. Bucket accounting — every geocoded ped KSI lands in exactly one bucket
# ---------------------------------------------------------------------------
k = j.ped_ksi_final if len(j) else pd.Series(dtype=bool)
ksi_all = pts[pts.ped_ksi_final]
n_geo = len(ksi_all)

int_coded = ksi_all[~ksi_all.is_midblock]
i_near = int(((int_coded.dist_m <= SNAP_BUFFER_M)).sum())
i_far = len(int_coded) - i_near

mb_ksi = j[j.ped_ksi_final]
s_assigned = int(mb_ksi.SEG_ID.notna().sum())
s_unplaced = int(mb_ksi.SEG_ID.isna().sum())

L("\n" + "=" * 70)
L("CRASH ACCOUNTING — pedestrian KSI 2015-2024")
L("=" * 70)
L(f"Geocoded pedestrian KSI ................................. {n_geo:>6,}")
L("")
L(f"  INTERSECTION layer (INTERSECT_TYPE > 0) ............... {len(int_coded):>6,}")
L(f"     within {SNAP_BUFFER_M} m of a node (enters the ranking) ....... {i_near:>6,}")
L(f"     beyond {SNAP_BUFFER_M} m — snap failures, not placeable ...... {i_far:>6,}")
L("")
L(f"  SEGMENT layer (INTERSECT_TYPE == 0) ................... {len(mb_ksi):>6,}")
L(f"     assigned to a segment ............................. {s_assigned:>6,}")
L(f"     no segment within {SNAP_BUFFER_M} m ......................... {s_unplaced:>6,}")
L("-" * 70)
total = len(int_coded) + len(mb_ksi)
L(f"  SUM ................................................... {total:>6,}")
assert total == n_geo, f"bucket accounting does not close: {total} != {n_geo}"
L("  reconciles to the geocoded total.")
L("=" * 70)

# How many crashes MOVED out of the intersection counts under this rule.
moved = int(((ksi_all.is_midblock) & (ksi_all.dist_m <= SNAP_BUFFER_M)).sum())
L(f"\nMid-block-coded KSI that were within {SNAP_BUFFER_M} m of a node and are")
L(f"therefore REMOVED from the intersection counts by this rule: {moved:,}")
L("The intersection SPF must be refit; its ranking will change.")

if i_far:
    L(f"\nThe {i_far} intersection-coded crashes that failed to snap "
      "(auditable individually):")
    cols = ["CRN", "lat", "lon", "itype", "dist_m"]
    L(int_coded[int_coded.dist_m > SNAP_BUFFER_M][cols].to_string(index=False))

# ---------------------------------------------------------------------------
# 6. Per-segment counts
# ---------------------------------------------------------------------------
agg = assigned.groupby("SEG_ID").agg(
    ped_ksi_seg=("ped_ksi_final", "sum"),
    ped_any_seg=("ped_any", "sum"),
    ped_deaths_seg=("PED_DEATH_COUNT", "sum"),
    ped_susp_serious_seg=("PED_SUSP_SERIOUS_INJ_COUNT", "sum"),
    ped_crashes_seg=("CRN", "count"),
).reset_index()

out = assign_uni.drop(columns="geometry").merge(agg, on="SEG_ID", how="left")
for c in ["ped_ksi_seg", "ped_any_seg", "ped_deaths_seg",
          "ped_susp_serious_seg", "ped_crashes_seg"]:
    out[c] = out[c].fillna(0).astype(int)

# ST_CODE already merges divided carriageways: both sides of E Roosevelt Blvd
# share one ST_CODE, so a corridor-level model treats the boulevard as one
# facility without needing a parallel-geometry heuristic. is_divided is carried
# so the split is visible at segment level.
out["corridor_id"] = out.ST_CODE
out["is_divided"] = pd.to_numeric(out.MULTI_REP, errors="coerce").fillna(0) > 0

L(f"\nSegments with >=1 mid-block ped KSI: {int((out.ped_ksi_seg > 0).sum()):,}")
L(f"Mid-block ped KSI on modelled segments: "
  f"{int(out.loc[out.modelled, 'ped_ksi_seg'].sum()):,}")
L(f"Mid-block ped KSI on non-modelled sinks (expressway/ramp/private): "
  f"{int(out.loc[~out.modelled, 'ped_ksi_seg'].sum()):,}")
L(f"Divided-carriageway segments (MULTI_REP > 0): {int(out.is_divided.sum()):,}")

corr = out[out.modelled].groupby("corridor_id").agg(
    n_seg=("SEG_ID", "size"), ksi=("ped_ksi_seg", "sum"),
    mi=("length_mi", "sum"), exp_mi=("exposure_mi", "sum"))
L(f"\nCorridors (ST_CODE) over modelled segments: {len(corr):,}")
L(f"  median segments per corridor: {corr.n_seg.median():.0f}")
L(f"  mean ped KSI per corridor: {corr.ksi.mean():.3f}   "
  f"per segment: {out.loc[out.modelled, 'ped_ksi_seg'].mean():.4f}")

L("\nTop 10 corridors by mid-block ped KSI:")
name = out.groupby("corridor_id").STREETLABE.first()
top = corr.sort_values("ksi", ascending=False).head(10)
for cid, r in top.iterrows():
    L(f"   {str(name.get(cid, '?')):<26} KSI {int(r.ksi):>3}  "
      f"{r.n_seg:>3} segs  {r.mi:>5.2f} mi")

# ---------------------------------------------------------------------------
# 7. Write
# ---------------------------------------------------------------------------
keep = ["SEG_ID", "ST_CODE", "corridor_id", "STREETLABE", "ST_NAME",
        "L_HUNDRED", "R_HUNDRED", "CLASS", "ONEWAY", "MULTI_REP", "is_divided",
        "FNODE_", "TNODE_", "n_iiz_ends", "modelled",
        "length_ft", "length_mi", "exposure_ft", "exposure_mi",
        "ped_ksi_seg", "ped_any_seg", "ped_deaths_seg",
        "ped_susp_serious_seg", "ped_crashes_seg"]
out[keep].to_csv(WORK / "segment_counts.csv", index=False)

diag = ["CRN", "CRASH_YEAR", "lat", "lon", "itype", "is_midblock",
        "ped_ksi_final", "ped_any", "node_id", "dist_m", "SEG_ID",
        "seg_dist_m", "CLASS"]
j.reindex(columns=diag).to_csv(OUTPUTS / "segment_crash_assignment.csv", index=False)

L(f"\nWrote work/segment_counts.csv ({len(out):,} rows)")
L(f"Wrote outputs/segment_crash_assignment.csv ({len(j):,} rows)")
L.close()
