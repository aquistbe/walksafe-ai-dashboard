"""
05_verification.py
WALKSAFE-AI intersection ranking - Step 5 (verification)
1. FARS cross-check: Philadelphia County pedestrian fatalities (PER_TYP=5,
   INJ_SEV=4, STATE=42, COUNTY=101) vs PennDOT PED_DEATH_COUNT, 2018-2023.
2. Buffer sensitivity: top-20 stability (raw KSI, city nodes) across 15/25/30 m.
3. RMS vs city-node sensitivity: top-20 overlap.
4. HIN share of top 50.
"""
import pandas as pd
import numpy as np
from pathlib import Path
from config import FARS, WORK, QC_LOGS  # repo-relative paths; see pipeline/README.md

FD = FARS
OUT = WORK
log = []
def L(m):
    print(m); log.append(str(m))

# ---------- 1. FARS ----------
def fars_ped_fatals(year):
    if year <= 2021:
        d = FD / f"FARS{year}NationalCSV"
    elif year == 2022:
        d = FD / "2022" / "FARS2022NationalCSV"
    else:
        d = None
    if d is not None:
        f = next(p for p in d.iterdir() if p.name.lower() == "person.csv")
        p = pd.read_csv(f, encoding="latin-1", low_memory=False,
                        usecols=lambda c: c.upper() in {"STATE", "COUNTY", "PER_TYP", "INJ_SEV"})
        p.columns = [c.upper() for c in p.columns]
        return ((p.STATE == 42) & (p.COUNTY == 101) & (p.PER_TYP == 5) & (p.INJ_SEV == 4)).sum()
    # 2023 NTAD PerAux (no COUNTY -> join Accidents on ST_CASE)
    p = pd.read_csv(next((FD / "2023").glob("*PerAux*.csv")), low_memory=False)
    a = pd.read_csv(next((FD / "2023").glob("*Accidents*.csv")), low_memory=False,
                    usecols=["ST_CASE", "STATE", "COUNTY"])
    p = p.merge(a, on="ST_CASE", how="left", suffixes=("", "_acc"))
    # A_PTYPE: 3 = pedestrian; A_PERINJ: 1 = fatal (FARS auxiliary coding)
    return ((p.STATE == 42) & (p.COUNTY == 101) &
            (p.A_PTYPE == 3) & (p.A_PERINJ == 1)).sum()

crash = pd.read_parquet(OUT / "crashes_all.parquet")
pd_by_year = crash.groupby("CRASH_YEAR").PED_DEATH_COUNT.sum()
L("Year | FARS ped fatalities (Phila Cnty) | PennDOT PED_DEATH_COUNT")
for y in range(2018, 2024):
    try:
        f = fars_ped_fatals(y)
    except Exception as e:
        f = f"ERR {e}"
    L(f"{y}   | {f} | {pd_by_year.get(y, np.nan)}")

# ---------- 2. Buffer sensitivity (raw KSI top 20, city nodes) ----------
tops = {}
for buf in (15, 25, 30):
    c = pd.read_csv(OUT / f"int_counts_city_buf{buf}.csv")
    tops[buf] = c.sort_values(["ped_ksi", "ped_deaths", "ped_any"],
                              ascending=False).head(20)
L("\nBuffer sensitivity, top-20 by raw ped KSI (city nodes):")
L(f"  15 vs 25 m overlap: {len(set(tops[15].node_id) & set(tops[25].node_id))}/20")
L(f"  25 vs 30 m overlap: {len(set(tops[25].node_id) & set(tops[30].node_id))}/20")
L(f"  15 vs 30 m overlap: {len(set(tops[15].node_id) & set(tops[30].node_id))}/20")

# ---------- 3. RMS sensitivity ----------
r = pd.read_csv(OUT / "int_counts_rms_buf25.csv").sort_values("ped_ksi", ascending=False).head(20)
city = pd.read_csv(OUT / "intersections_ranked.csv")
import geopandas as gpd
rnodes = gpd.read_file(OUT / "nodes_rms.geojson")
rnodes["node_id"] = rnodes["node_id"].astype(str)
r["node_id"] = r["node_id"].astype(str)
rn = rnodes.merge(r, on="node_id")
cg = gpd.GeoDataFrame(city, geometry=gpd.points_from_xy(city.x_2272, city.y_2272), crs=2272)
top20c = cg.nsmallest(20, "rank_eb")
near = gpd.sjoin_nearest(rn.set_geometry("geometry"), top20c[["node_id", "geometry"]].rename(columns={"node_id": "cnode"}), distance_col="d")
match = (near.d <= 25 * 3.28084).sum()
L(f"\nRMS top-20 (raw KSI) within 25 m of a city EB top-20 site: {match}/20")

# ---------- 4. HIN share and measure agreement ----------
top50 = city.nsmallest(50, "rank_eb")
L(f"\nTop-50 EB sites on High Injury Network: {top50.on_hin.sum()}/50")
L(f"Top-50 EB sites signalized: {(top50.stoptype == 'Signalized').sum()}/50")
raw_sorted = city.sort_values(['ped_ksi', 'ped_deaths', 'ped_any'], ascending=False)
L(f"EB top-50 with raw ped KSI >= 3: {(top50.ped_ksi >= 3).sum()}/50; == 2: {(top50.ped_ksi == 2).sum()}/50")
L(f"Deterministic raw top-50 overlap with EB top-50: "
  f"{len(set(raw_sorted.head(50).node_id) & set(top50.node_id))}/50")
rate50 = set(city[city.rate_reliable == 1].nlargest(50, 'ksi_per_mev').node_id)
L(f"Rate top-50 overlap with EB top-50: {len(rate50 & set(top50.node_id))}/50")

(QC_LOGS / "qc_verification.txt").write_text("\n".join(log))
