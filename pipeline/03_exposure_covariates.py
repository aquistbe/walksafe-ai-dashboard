"""
03_exposure_covariates.py
WALKSAFE-AI intersection ranking - Step 3
Build the intersection analysis table: universe = city intersections in
Intersection_Controls (n~17k, joined to Street_Nodes on node_id), with
ped KSI counts (from step 2), vehicle exposure (PennDOT AADT), population
proxy (CDC PLACES tract population within 800 m), trip generators (schools,
parks/playgrounds within 200 m), control type, and High Injury Network flag.

Exposure caveats (memo): AADT exists only on the state-route network; local
streets have no counts. Nodes with no traffic segment within 30 m get
aadt_measured=0 and an imputed local-street AADT of 2,000 veh/day for the SPF.
No direct pedestrian volumes exist; population within 800 m is a proxy.
"""
import geopandas as gpd
import pandas as pd
import numpy as np
from pathlib import Path
from config import GIS, PLACES, WORK, QC_LOGS  # repo-relative paths; see pipeline/README.md

OUT = WORK
CRS = 2272
M2FT = 3.280839895
LOCAL_AADT = 2000  # imputed veh/day for nodes off the state count network

log = []
def L(m):
    print(m); log.append(str(m))

# ---------- Universe: controlled intersections joined to street nodes ----------
ctrl = gpd.read_file(GIS / "Intersection_Controls.geojson")[["node_id", "stoptype"]]
ctrl = ctrl.drop_duplicates("node_id")
sn = gpd.read_file(GIS / "Street_Nodes").to_crs(CRS).drop_duplicates("NODE_ID")
uni = sn.merge(ctrl, left_on="NODE_ID", right_on="node_id", how="inner")
uni = uni[["NODE_ID", "INTERSECTI", "stoptype", "geometry"]].rename(
    columns={"NODE_ID": "node_id", "INTERSECTI": "int_name"})
L(f"Universe: {len(uni)} intersections with control type "
  f"({uni.stoptype.value_counts().to_dict()})")

# ---------- KSI counts from step 2 (25 m primary) ----------
counts = pd.read_csv(OUT / "int_counts_city_buf25.csv")
uni = uni.merge(counts, on="node_id", how="left")
for c in ["ped_ksi", "ped_any", "ped_deaths", "ped_susp_serious", "ped_ksi_persons", "ped_crashes"]:
    uni[c] = uni[c].fillna(0).astype(int)
n_outside = counts.loc[~counts.node_id.isin(uni.node_id), "ped_ksi"].sum()
L(f"Ped KSI at snapped nodes outside the controls universe (uncontrolled/alley nodes): {n_outside}")
L(f"Ped KSI within universe: {uni.ped_ksi.sum()}; intersections with >=1 KSI: {(uni.ped_ksi > 0).sum()}")

# ---------- AADT (max of traffic segments within 30 m) ----------
tr = gpd.read_file(GIS / "PaTraffic2024_03")
tr = tr[tr.CTY_CODE == "67"].to_crs(CRS)
tr["CUR_AADT"] = pd.to_numeric(tr.CUR_AADT, errors="coerce")
tr = tr[tr.CUR_AADT.notna() & (tr.CUR_AADT > 0)]
L(f"Traffic segments (Phila, AADT>0): {len(tr)}")
buf30 = uni[["node_id", "geometry"]].copy()
buf30["geometry"] = buf30.geometry.buffer(30 * M2FT)
hit = gpd.sjoin(buf30, tr[["CUR_AADT", "ST_RT_NO", "geometry"]], how="left", predicate="intersects")
aadt = hit.groupby("node_id").agg(
    aadt_max=("CUR_AADT", "max"),
    aadt_sum_routes=("CUR_AADT", lambda s: s.sum()),
    n_traffic_segs=("CUR_AADT", "count"))
uni = uni.merge(aadt, on="node_id", how="left")
uni["aadt_measured"] = uni.aadt_max.notna().astype(int)
uni["aadt"] = uni.aadt_max.fillna(LOCAL_AADT)
L(f"Nodes with measured AADT within 30 m: {uni.aadt_measured.sum()} ({uni.aadt_measured.mean():.1%})")
L(f"AADT (measured) quartiles: {uni.loc[uni.aadt_measured==1,'aadt'].quantile([.25,.5,.75]).to_dict()}")

# ---------- Population within 800 m (CDC PLACES tract centroids) ----------
# The PLACES filename embeds its release date, so match on the stable prefix
# rather than pinning a filename that changes with every CDC release.
_places_csv = sorted(PLACES.glob("PLACES__Census_Tract_Data*.csv"))
if not _places_csv:
    raise SystemExit(f"No PLACES tract CSV found in {PLACES}")
pl = pd.read_csv(_places_csv[-1],
                 usecols=["CountyFIPS", "TractFIPS", "TotalPopulation", "Geolocation"])
pl = pl[pl.CountyFIPS == 42101].copy()
pl["geometry"] = gpd.GeoSeries.from_wkt(pl.Geolocation)
plg = gpd.GeoDataFrame(pl, geometry="geometry", crs=4326).to_crs(CRS)
L(f"PLACES Philadelphia tracts: {len(plg)}; total pop {plg.TotalPopulation.sum():,}")
buf800 = uni[["node_id", "geometry"]].copy()
buf800["geometry"] = buf800.geometry.buffer(800 * M2FT)
ph = gpd.sjoin(buf800, plg[["TotalPopulation", "geometry"]], how="left", predicate="intersects")
pop = ph.groupby("node_id")["TotalPopulation"].sum().rename("pop_800m")
uni = uni.merge(pop, on="node_id", how="left")
uni["pop_800m"] = uni.pop_800m.fillna(0)
L(f"pop_800m quartiles: {uni.pop_800m.quantile([.25,.5,.75]).to_dict()}")

# ---------- Trip generators within 200 m: schools, parks/playgrounds ----------
sch = gpd.read_file(GIS / "PhiladelphiaSchool_Facilities2016").to_crs(CRS)
sch = sch[sch.ACTIVE == "Open"]  # 549 of 550; one 'Relocating: Fall 2013'
pp1 = gpd.read_file(GIS / "PPR_Program_Sites").to_crs(CRS)
pp2 = gpd.read_file(GIS / "PPR_Playgrounds").to_crs(CRS)
gen = pd.concat([
    sch[["geometry"]].assign(kind="school"),
    pp1[["geometry"]].assign(kind="park"),
    pp2[["geometry"]].assign(kind="park")], ignore_index=True)
gen["geometry"] = gen.geometry.representative_point()
buf200 = uni[["node_id", "geometry"]].copy()
buf200["geometry"] = buf200.geometry.buffer(200 * M2FT)
gh = gpd.sjoin(buf200, gpd.GeoDataFrame(gen, crs=CRS), how="left", predicate="intersects")
gcnt = gh.groupby(["node_id", "kind"]).size().unstack(fill_value=0)
uni = uni.merge(gcnt, on="node_id", how="left")
for c in ["school", "park"]:
    if c not in uni.columns: uni[c] = 0
    uni[c] = uni[c].fillna(0).astype(int)
uni = uni.rename(columns={"school": "schools_200m", "park": "parks_200m"})
L(f"Schools layer: {len(sch)}; park sites: {len(pp1)+len(pp2)}")
L(f"Nodes with >=1 school in 200 m: {(uni.schools_200m>0).sum()}; >=1 park: {(uni.parks_200m>0).sum()}")

# ---------- High Injury Network flag (within 15 m of HIN line) ----------
hin = gpd.read_file(GIS / "high_injury_network_2020").to_crs(CRS)
hin_union = hin.union_all()
uni["hin_dist_m"] = uni.geometry.distance(hin_union) / M2FT
uni["on_hin"] = (uni.hin_dist_m <= 15).astype(int)
L(f"Nodes on HIN (<=15 m): {uni.on_hin.sum()} ({uni.on_hin.mean():.1%})")
L(f"Ped KSI at HIN nodes: {uni.loc[uni.on_hin==1,'ped_ksi'].sum()} of {uni.ped_ksi.sum()} "
  f"({uni.loc[uni.on_hin==1,'ped_ksi'].sum()/uni.ped_ksi.sum():.1%})")

# ---------- Coordinates ----------
uni["x_2272"] = uni.geometry.x
uni["y_2272"] = uni.geometry.y
w = uni.to_crs(4326)
uni["lat"] = w.geometry.y
uni["lon"] = w.geometry.x

uni.drop(columns="geometry").to_csv(OUT / "intersections_analysis.csv", index=False)
uni.to_file(OUT / "intersections_analysis_pts.geojson", driver="GeoJSON")
(QC_LOGS / "qc_covariates.txt").write_text("\n".join(log))
L("Saved intersections_analysis.csv / .geojson")
