"""
02_snap_intersections.py
WALKSAFE-AI intersection ranking - Step 2
Snap pedestrian crashes to intersection nodes and aggregate ped KSI per
intersection, 2015-2024.

PRIMARY snapping target: city Street_Nodes (covers all city intersections;
captures 98.6% of intersection-coded ped KSI within 25 m).
SENSITIVITY: PennDOT RMS at-grade intersections (state-route network only;
captures 65.8%) - the brief's original primary; retained for comparison.

Assignment rule (primary): crash assigned to nearest street node within the
buffer (25 m primary; 15/30 m sensitivity). INTERSECTION_RELATED is ~70%
missing in these extracts, so INTERSECT_TYPE (00 = mid-block per dictionary)
is used to characterize assigned crashes; a sensitivity aggregation restricted
to INTERSECT_TYPE>0 crashes is also produced.
"""
import geopandas as gpd
import pandas as pd
import numpy as np
from pathlib import Path
from config import GIS, WORK, QC_LOGS  # repo-relative paths; see pipeline/README.md

OUT = WORK
CRS = 2272  # PA State Plane South, US survey ft
M2FT = 3.280839895

log = []
def L(m):
    print(m); log.append(str(m))

# ---------- Intersection nodes (primary: city Street_Nodes) ----------
sn = gpd.read_file(GIS / "Street_Nodes").to_crs(CRS)
sn = sn.drop_duplicates("NODE_ID")
sn["int_name"] = sn["INTERSECTI"].fillna("").str.strip()
nodes = sn[["NODE_ID", "int_name", "geometry"]].rename(columns={"NODE_ID": "node_id"})
L(f"City street nodes: {len(nodes)}; with intersection name: {(nodes.int_name != '').sum()}")

# ---------- RMS nodes (sensitivity) ----------
rms = gpd.read_file(GIS / "PA_AtGradeIntersections2024_03")
rms = rms[rms.CTY_CODE == "67"].to_crs(CRS)
def rms_name(g):
    names = pd.unique(pd.concat([g.STREET_N_1, g.STREET_NAM]).dropna().str.strip())
    return " & ".join([n for n in names if n][:3])
rnames = rms.groupby("NODE_ID").apply(rms_name, include_groups=False).rename("int_name")
rnodes = rms.dissolve(by="NODE_ID").reset_index()[["NODE_ID", "geometry"]]
rnodes["geometry"] = rnodes.geometry.centroid
rnodes = rnodes.merge(rnames, on="NODE_ID").rename(columns={"NODE_ID": "node_id"})
L(f"RMS Philadelphia nodes: {len(rnodes)} (from {len(rms)} leg records)")

# ---------- Ped crashes ----------
ped = pd.read_parquet(OUT / "ped_crashes.parquet")
pts = gpd.GeoDataFrame(
    ped[ped.coord_ok].copy(),
    geometry=gpd.points_from_xy(ped.loc[ped.coord_ok, "lon"], ped.loc[ped.coord_ok, "lat"]),
    crs=4326).to_crs(CRS)
pts["itype"] = pd.to_numeric(pts["INTERSECT_TYPE"], errors="coerce")
L(f"Ped crashes with usable coords: {len(pts)} of {len(ped)}; ped KSI: {pts.ped_ksi_final.sum()}")
L("ped KSI INTERSECT_TYPE: " + str(pts.loc[pts.ped_ksi_final, "itype"].value_counts(dropna=False).sort_index().to_dict()))
L("ped KSI INTERSECTION_RELATED: " + str(pts.loc[pts.ped_ksi_final, "INTERSECTION_RELATED"].value_counts(dropna=False).to_dict()))

def snap(points, target, idcol="node_id"):
    jj = gpd.sjoin_nearest(points, target[[idcol, "geometry"]], how="left", distance_col="dist_ft")
    jj = jj[~jj.index.duplicated(keep="first")]
    jj["dist_m"] = jj["dist_ft"] / M2FT
    return jj.drop(columns=["index_right"], errors="ignore")

joined = snap(pts, nodes)                     # primary
joined_rms = snap(pts.copy(), rnodes)         # sensitivity

for label, jj in (("CITY", joined), ("RMS", joined_rms)):
    for buf in (15, 25, 30):
        a = jj.dist_m <= buf
        k = jj.ped_ksi_final
        ix = jj.itype.fillna(-1) > 0
        L(f"[{label}] buf {buf} m: ped crashes assigned {a.sum()} ({a.mean():.1%}); "
          f"ped KSI {(a & k).sum()}/{k.sum()} ({(a & k).sum()/k.sum():.1%}); "
          f"intersection-coded ped KSI {(a & k & ix).sum()}/{(k & ix).sum()} ({(a & k & ix).sum()/max(1,(k & ix).sum()):.1%})")

BUF = 25
L(f"\nPrimary: CITY nodes, {BUF} m buffer")
k = joined.ped_ksi_final
L(f"ped KSI unassigned: {((joined.dist_m > BUF) & k).sum()} ({((joined.dist_m > BUF) & k).mean() * len(joined) / k.sum() if k.sum() else 0:.3f})")
L("  of unassigned, mid-block coded (itype 0/NA): "
  f"{(((joined.dist_m > BUF) & k) & (joined.itype.fillna(0) == 0)).sum()}")

def aggregate(jj, buf, intersection_coded_only=False):
    m = jj.dist_m <= buf
    if intersection_coded_only:
        m &= jj.itype.fillna(-1) > 0
    return jj[m].groupby("node_id").agg(
        ped_ksi=("ped_ksi_final", "sum"),
        ped_any=("ped_any", "sum"),
        ped_deaths=("PED_DEATH_COUNT", "sum"),
        ped_susp_serious=("PED_SUSP_SERIOUS_INJ_COUNT", "sum"),
        ped_ksi_persons=("ped_ksi_n", "sum"),
        ped_crashes=("CRN", "count"))

# PRIMARY counts are intersection-coded only (INTERSECT_TYPE > 0).
#
# This changed when the segment layer was added (step 12). Mid-block-coded
# crashes that happen to fall within 25 m of a node used to be counted here —
# 269 pedestrian KSI, 26% of the intersection burden — while the 458 that fell
# further away were dropped entirely. Those are the same kind of event and they
# now all belong to the segment layer, so the two layers partition the crash
# set cleanly and sum to the citywide total instead of overlapping.
#
# The all-crashes aggregation is retained as a sensitivity, and is what the
# published 2026-07 ranking used.
for buf in (15, 25, 30):
    aggregate(joined, buf, intersection_coded_only=True).to_csv(
        OUT / f"int_counts_city_buf{buf}.csv")
    aggregate(joined, buf).to_csv(
        OUT / f"int_counts_city_buf{buf}_allcoded.csv")
aggregate(joined_rms, 25, intersection_coded_only=True).to_csv(
    OUT / "int_counts_rms_buf25.csv")

agg25 = aggregate(joined, 25, intersection_coded_only=True)
agg25_all = aggregate(joined, 25)
L(f"\nPRIMARY (intersection-coded only): ped KSI {int(agg25.ped_ksi.sum())} "
  f"at {int((agg25.ped_ksi > 0).sum())} nodes")
L(f"SENSITIVITY (all crashes within 25 m): ped KSI {int(agg25_all.ped_ksi.sum())} "
  f"at {int((agg25_all.ped_ksi > 0).sum())} nodes")
L(f"  difference = mid-block-coded crashes now assigned to segments: "
  f"{int(agg25_all.ped_ksi.sum() - agg25.ped_ksi.sum())}")
L(f"\nIntersections with >=1 assigned ped crash: {len(agg25)}; with >=1 ped KSI: {(agg25.ped_ksi > 0).sum()}")
top = agg25.sort_values(["ped_ksi", "ped_deaths"], ascending=False).head(15).merge(
    nodes.set_index("node_id")["int_name"], left_index=True, right_index=True)
L("Top 15 by ped KSI (city nodes, 25 m):\n" + top.to_string())

joined.drop(columns="geometry").to_parquet(OUT / "ped_crashes_snapped.parquet")
joined_rms.drop(columns="geometry").to_parquet(OUT / "ped_crashes_snapped_rms.parquet")
nodes.to_file(OUT / "nodes_city.geojson", driver="GeoJSON")
rnodes.to_file(OUT / "nodes_rms.geojson", driver="GeoJSON")
(QC_LOGS / "qc_snapping.txt").write_text("\n".join(log))
