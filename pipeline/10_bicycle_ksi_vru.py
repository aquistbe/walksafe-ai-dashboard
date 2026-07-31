"""
10_bicycle_ksi_vru.py
WALKSAFE-AI intersection ranking - Step 10 (addendum 3)
Bicyclist KSI analysis mirroring the pedestrian pipeline, plus an all-severity
vulnerable-road-user (VRU = pedestrian- or bicyclist-involved) crash measure.

Bike KSI = crash with BICYCLE_DEATH_COUNT + BICYCLE_SUSP_SERIOUS_INJ_COUNT > 0
(crash-level counters, same construction as the ped measure; PERSON has no
bicyclist person-type code - cyclists are unit drivers - so the crash-level
counters are the single source here, noted as a limitation).

Outputs: per-intersection bike_ksi / bike_any / vru_any counts, bike EB
ranking (same NB SPF covariates), overlap with the 15 narrowed ped sites and
ped top-50, and VRU-any percentile for the narrowed sites.
"""
import geopandas as gpd
import pandas as pd
import numpy as np
import statsmodels.api as sm
from pathlib import Path
from config import PENNDOT, WORK, OUTPUTS, QC_LOGS  # repo-relative paths; see pipeline/README.md

DATA = PENNDOT
OUT = WORK
DELIV = OUTPUTS
M2FT = 3.280839895
YEARS = range(2015, 2025)

log = []
def L(m):
    print(m); log.append(str(m))

# ---------- assemble bike flags ----------
cols = ["CRN", "CRASH_YEAR", "DEC_LATITUDE", "DEC_LONGITUDE", "INTERSECT_TYPE",
        "BICYCLE_COUNT", "BICYCLE_DEATH_COUNT", "BICYCLE_SUSP_SERIOUS_INJ_COUNT", "PED_COUNT"]
frames = []
for y in YEARS:
    df = pd.read_csv(DATA / f"Philadelphia_{y}" / f"CRASH_PHILADELPHIA_{y}.csv",
                     dtype={"CRN": str}, usecols=cols, low_memory=False)
    frames.append(df)
cr = pd.concat(frames, ignore_index=True).drop_duplicates("CRN")
for c in ["BICYCLE_COUNT", "BICYCLE_DEATH_COUNT", "BICYCLE_SUSP_SERIOUS_INJ_COUNT", "PED_COUNT"]:
    cr[c] = pd.to_numeric(cr[c], errors="coerce").fillna(0).astype(int)
cr["bike_ksi"] = (cr.BICYCLE_DEATH_COUNT + cr.BICYCLE_SUSP_SERIOUS_INJ_COUNT) > 0
cr["bike_any"] = cr.BICYCLE_COUNT > 0
cr["vru_any"] = cr.bike_any | (cr.PED_COUNT > 0)
L(f"Crashes {len(cr)}; bike-any {cr.bike_any.sum()}, bike KSI {cr.bike_ksi.sum()} "
  f"(deaths {cr.BICYCLE_DEATH_COUNT.sum()}, susp serious {cr.BICYCLE_SUSP_SERIOUS_INJ_COUNT.sum()}); "
  f"VRU-any {cr.vru_any.sum()}")
L("Bike KSI by year:\n" + cr.loc[cr.bike_ksi].groupby("CRASH_YEAR").size().to_string())

# ---------- snap VRU crashes to city nodes ----------
cr["lat"] = pd.to_numeric(cr.DEC_LATITUDE, errors="coerce")
cr["lon"] = pd.to_numeric(cr.DEC_LONGITUDE, errors="coerce")
ok = cr.lat.between(39.85, 40.15) & cr.lon.between(-75.30, -74.94)
L(f"VRU crashes with usable coords: {(ok & cr.vru_any).sum()} of {cr.vru_any.sum()}; "
  f"bike KSI usable {(ok & cr.bike_ksi).sum()} of {cr.bike_ksi.sum()}")
v = cr[ok & cr.vru_any].copy()
nodes = gpd.read_file(OUT / "nodes_city.geojson").to_crs(2272)
pts = gpd.GeoDataFrame(v, geometry=gpd.points_from_xy(v.lon, v.lat), crs=4326).to_crs(2272)
j = gpd.sjoin_nearest(pts, nodes[["node_id", "geometry"]], how="left", distance_col="dist_ft")
j = j[~j.index.duplicated()]
j["dist_m"] = j.dist_ft / M2FT
a = j[j.dist_m <= 25]
L(f"Assigned at 25 m: VRU {len(a)} ({len(a)/len(j):.1%}); bike KSI {a.bike_ksi.sum()} "
  f"of {j.bike_ksi.sum()} ({a.bike_ksi.sum()/j.bike_ksi.sum():.1%})")

agg = a.groupby("node_id").agg(
    bike_ksi=("bike_ksi", "sum"), bike_any=("bike_any", "sum"),
    bike_deaths=("BICYCLE_DEATH_COUNT", "sum"), vru_any=("vru_any", "sum"),
    bike_ksi_1519=("bike_ksi", lambda s: s[a.loc[s.index, "CRASH_YEAR"] <= 2019].sum()),
    bike_ksi_2024=("bike_ksi", lambda s: s[a.loc[s.index, "CRASH_YEAR"] >= 2020].sum()))

# ---------- merge onto universe, EB for bike ----------
uni = pd.read_csv(OUT / "intersections_ranked.csv")
uni = uni.merge(agg, on="node_id", how="left")
for c in ["bike_ksi", "bike_any", "bike_deaths", "vru_any", "bike_ksi_1519", "bike_ksi_2024"]:
    uni[c] = uni[c].fillna(0).astype(int)
L(f"\nUniverse bike KSI total {uni.bike_ksi.sum()} at {(uni.bike_ksi>0).sum()} intersections; "
  f"VRU-any total {uni.vru_any.sum()}")

X = pd.get_dummies(uni.stoptype, prefix="ctl", drop_first=True)
X = pd.concat([uni[["log_aadt", "log_pop", "on_hin", "schools_200m", "parks_200m"]], X], axis=1).astype(float)
X = sm.add_constant(X)
y = uni.bike_ksi.astype(float)
best = None
for alpha in np.geomspace(0.05, 10, 60):
    m = sm.GLM(y, X, family=sm.families.NegativeBinomial(alpha=alpha)).fit()
    if best is None or m.llf > best[0]:
        best = (m.llf, alpha, m)
ll, alpha, model = best
k = 1 / alpha
L(f"Bike NB SPF: alpha {alpha:.2f}, llf {ll:.1f}")
uni["mu_bike"] = model.predict(X)
w = k / (k + uni.mu_bike)
uni["eb_bike"] = w * uni.mu_bike + (1 - w) * uni.bike_ksi
uni["rank_eb_bike"] = uni.eb_bike.rank(method="min", ascending=False).astype(int)
uni["rank_vru_any"] = uni.vru_any.rank(method="min", ascending=False).astype(int)

keep = ["node_id", "int_name", "lat", "lon", "bike_ksi", "bike_deaths", "bike_any",
        "bike_ksi_1519", "bike_ksi_2024", "vru_any", "ped_ksi", "eb_bike",
        "rank_eb_bike", "rank_vru_any", "rank_eb", "stoptype", "on_hin", "aadt"]
top_bike = uni.nsmallest(50, "rank_eb_bike")[keep]
top_bike.round(3).to_csv(DELIV / "top50_bicycle_intersections.csv", index=False)
L("\nTop 15 bike EB:\n" + top_bike.head(15)[
    ["rank_eb_bike", "int_name", "bike_ksi", "bike_deaths", "bike_any", "vru_any",
     "rank_eb"]].to_string(index=False))

# ---------- overlap with narrowed ped sites ----------
nar = pd.read_csv(DELIV / "narrowed_shortlist_nocamera_trending_up.csv")
nar = nar.merge(uni[["node_id", "bike_ksi", "bike_any", "bike_ksi_1519", "bike_ksi_2024",
                     "vru_any", "eb_bike", "rank_eb_bike", "rank_vru_any"]], on="node_id", how="left")
npct = 100 * (1 - (nar.rank_vru_any - 1) / len(uni))
nar["vru_any_pctile"] = npct.round(1)
nar["bike_top50"] = nar.rank_eb_bike <= 50
nar = nar.sort_values("rank_eb")
nar.to_csv(DELIV / "narrowed_shortlist_with_bike_vru.csv", index=False)
L("\nNarrowed ped sites - bike & VRU view:\n" + nar[
    ["rank_eb", "int_name", "ped_ksi", "bike_ksi", "bike_any", "vru_any",
     "rank_eb_bike", "rank_vru_any", "bike_top50"]].to_string(index=False))
L(f"\nNarrowed sites also in bike EB top-50: {nar.bike_top50.sum()} of {len(nar)}")
L(f"Ped top-50 ∩ bike top-50 (same node): "
  f"{len(set(uni.nsmallest(50,'rank_eb').node_id) & set(top_bike.node_id))}")
(QC_LOGS / "qc_bike_vru.txt").write_text("\n".join(log))
