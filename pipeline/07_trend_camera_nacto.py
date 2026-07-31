"""
07_trend_camera_nacto.py
WALKSAFE-AI intersection ranking - Step 7 (addendum)
1. Flag top-50 candidate sites on PPA automated speed enforcement corridors
   (philapark.org/speed-cameras/, accessed 2026-07-06):
     - Route 1 / Roosevelt Blvd: 10 camera locations, warning June 2020,
       ticketing Aug 2020 -> ACTIVE DURING 2020-2024 window
     - Route 611 / Broad St + Old York Rd: 15 locations, warning 2025-09-15,
       ticketing 2025-11-14 -> post-window
     - Route 13 / Frankford Ave (6400-9900) + Levick + Robbins: 2026 -> post-window
     - School zones (5 segments, April 2026): E Allegheny (A-B Sts),
       N 16th (Cumberland-Huntingdon), W Olney (Broad-16th),
       W Girard (39th-40th), Walnut (58th-59th) -> post-window
2. Half-decade trend per site: ped KSI and ped-any, 2015-2019 vs 2020-2024.
3. Narrow: sites with NO camera (current or during window) AND ped KSI
   trending higher in 2020-2024 than 2015-2019.
4. NACTO amenability: attach one-way flag and street class from
   Street_Centerline; apply countermeasure rubric.
"""
import geopandas as gpd
import pandas as pd
import numpy as np
from pathlib import Path
from config import GIS, WORK, OUTPUTS, QC_LOGS  # repo-relative paths; see pipeline/README.md

OUT = WORK
DELIV = OUTPUTS
M2FT = 3.280839895

log = []
def L(m):
    print(m); log.append(str(m))

top50 = pd.read_csv(DELIV / "top50_intersections.csv")
snapped = pd.read_parquet(OUT / "ped_crashes_snapped.parquet")
assigned = snapped[(snapped.dist_m <= 25) & snapped.node_id.isin(top50.node_id)]

# ---------- 1. Trends ----------
assigned = assigned.assign(period=np.where(assigned.CRASH_YEAR <= 2019, "y1519", "y2024"))
tr = assigned.groupby(["node_id", "period"]).agg(
    ksi=("ped_ksi_final", "sum"), any_=("ped_any", "sum")).unstack(fill_value=0)
tr.columns = [f"{a}_{b}" for a, b in tr.columns]
top50 = top50.merge(tr, on="node_id", how="left").fillna(
    {c: 0 for c in ["ksi_y1519", "ksi_y2024", "any__y1519", "any__y2024"]})
top50 = top50.rename(columns={"any__y1519": "pedany_1519", "any__y2024": "pedany_2024",
                              "ksi_y1519": "ksi_1519", "ksi_y2024": "ksi_2024"})
for c in ["ksi_1519", "ksi_2024", "pedany_1519", "pedany_2024"]:
    top50[c] = top50[c].astype(int)

city_r = snapped.loc[snapped.dist_m <= 25].groupby(
    np.where(snapped.loc[snapped.dist_m <= 25, "CRASH_YEAR"] <= 2019, "a", "b")).ped_ksi_final.sum()
L(f"Citywide assigned ped KSI: 2015-19 = {city_r['a']}, 2020-24 = {city_r['b']} "
  f"(ratio {city_r['b']/city_r['a']:.2f}) - KSI counts drifted up citywide; site trends read against this")

top50["ksi_delta"] = top50.ksi_2024 - top50.ksi_1519
top50["trend_ksi"] = np.select(
    [top50.ksi_delta > 0, top50.ksi_delta < 0], ["higher", "lower"], default="flat")
top50["trend_pedany"] = np.select(
    [top50.pedany_2024 > top50.pedany_1519, top50.pedany_2024 < top50.pedany_1519],
    ["higher", "lower"], default="flat")

# ---------- 2. Camera corridor flags ----------
nm = top50.int_name.str.upper()
top50["cam_roosevelt"] = nm.str.contains("ROOSEVELT").astype(int)          # active Aug 2020
top50["cam_broad611"] = (nm.str.contains("BROAD ST") | nm.str.contains("OLD YORK")).astype(int)  # active Nov 2025
# Route 13: Frankford Ave cameras 6400-9900 blocks + Levick + Robbins (all lat > 40.02)
top50["cam_rt13"] = ((nm.str.contains("FRANKFORD AVE") & (top50.lat > 40.02)) |
                     nm.str.contains("LEVICK") | nm.str.contains("ROBBINS")).astype(int)

# School zones: segment between two named nodes, candidate within 100 m
sn = gpd.read_file(GIS / "Street_Nodes").to_crs(2272).drop_duplicates("NODE_ID")
sn["nm"] = sn.INTERSECTI.fillna("").str.upper()
def find_node(*patterns):
    # patterns are regexes; anchor short street names (e.g. "^A ST &") so they
    # don't match substrings like "INDIANA ST"
    m = sn[np.logical_and.reduce([sn.nm.str.contains(p, regex=True) for p in patterns])]
    if len(m) == 0:
        return None
    if len(m) > 1:
        L(f"  find_node{patterns}: {len(m)} matches, using first: {m.nm.iloc[0]}")
    return m.geometry.iloc[0]
from shapely.geometry import LineString
zones = [
    ("Stetson MS", (r"(?:^|& )A ST(?: &|$)", "ALLEGHENY"), (r"(?:^|& )B ST(?: &|$)", "ALLEGHENY")),
    ("KIPP NP", ("16TH", "CUMBERLAND"), ("16TH", "HUNTINGDON")),
    ("Widener", ("BROAD", "OLNEY"), ("16TH", "OLNEY")),
    ("HS of Future", ("39TH", "GIRARD"), ("40TH", "GIRARD")),
    ("Sayre HS", ("58TH", "WALNUT"), ("59TH", "WALNUT")),
]
seglines = []
for name, f1, f2 in zones:
    a, b = find_node(*f1), find_node(*f2)
    if a is not None and b is not None:
        seglines.append((name, LineString([a, b])))
    else:
        L(f"school zone {name}: endpoint not found ({f1 if a is None else f2})")
g50 = gpd.GeoDataFrame(top50, geometry=gpd.points_from_xy(top50.x_2272, top50.y_2272), crs=2272)
top50["cam_schoolzone"] = 0
top50["schoolzone_name"] = ""
for name, line in seglines:
    d = g50.geometry.distance(line) / M2FT
    hit = d <= 100
    top50.loc[hit.values, "cam_schoolzone"] = 1
    top50.loc[hit.values, "schoolzone_name"] = name
    if hit.any():
        L(f"school zone {name}: covers {top50.loc[hit.values, 'int_name'].tolist()}")

top50["any_camera"] = top50[["cam_roosevelt", "cam_broad611", "cam_rt13", "cam_schoolzone"]].max(axis=1)
top50["camera_note"] = np.select(
    [top50.cam_roosevelt == 1, top50.cam_broad611 == 1, top50.cam_rt13 == 1, top50.cam_schoolzone == 1],
    ["Roosevelt Blvd ASE (active Aug 2020 - within window)",
     "Broad St/Rt 611 ASE (ticketing Nov 2025 - post-window)",
     "Rt 13 Frankford ASE (2026 - post-window)",
     "School-zone ASE (Apr 2026 - post-window): " + top50.schoolzone_name],
    default="none")
L(f"\nTop-50 on camera corridors: Roosevelt {top50.cam_roosevelt.sum()}, "
  f"Broad/611 {top50.cam_broad611.sum()}, Rt13 {top50.cam_rt13.sum()}, "
  f"school zone {top50.cam_schoolzone.sum()}, any {top50.any_camera.sum()}")

# ---------- 3. Street class / one-way context for NACTO rubric ----------
cl = gpd.read_file(GIS / "Street_Centerline").to_crs(2272)
buf = g50[["node_id", "geometry"]].copy()
buf["geometry"] = buf.geometry.buffer(30 * M2FT)
touch = gpd.sjoin(buf, cl[["CLASS", "ONEWAY", "ST_NAME", "geometry"]], how="left", predicate="intersects")
ctx = touch.groupby("node_id").agg(
    min_class=("CLASS", "min"),                      # lower = higher functional class
    n_legs_apx=("ST_NAME", "size"),
    oneway_any=("ONEWAY", lambda s: int(s.astype(str).str.upper().isin(["TF", "FT", "Y", "1"]).any())))
top50 = top50.merge(ctx, on="node_id", how="left")

# ---------- 4. Narrowed list + NACTO rubric ----------
top50["narrowed"] = ((top50.any_camera == 0) & (top50.trend_ksi == "higher")).astype(int)

def nacto(r):
    recs = []
    if r.stoptype == "Signalized":
        recs += ["Leading pedestrian intervals", "No-turn-on-red", "signal retiming to 25 mph progression"]
    if r.aadt >= 15000:
        recs += ["pedestrian refuge islands / median hardening", "corridor speed management"]
    if 7000 <= r.aadt < 15000:
        recs += ["curb extensions", "daylighting (parking setbacks)"]
    if r.aadt < 7000:
        recs += ["raised crosswalks", "neighborhood traffic calming"]
    if r.oneway_any == 1:
        recs += ["one-way progression speed control"]
    if r.schools_200m > 0:
        recs += ["school-zone treatments (raised crossings, 20 mph zone)"]
    if r.parks_200m > 0:
        recs += ["park-edge crossing enhancements"]
    return "; ".join(recs[:6])

top50["nacto_recs"] = top50.apply(nacto, axis=1)

cols = ["rank_eb", "node_id", "int_name", "lat", "lon", "ped_ksi", "ped_deaths",
        "ksi_1519", "ksi_2024", "trend_ksi", "pedany_1519", "pedany_2024", "trend_pedany",
        "any_camera", "camera_note", "aadt", "stoptype", "oneway_any", "min_class",
        "schools_200m", "parks_200m", "on_hin", "narrowed", "nacto_recs"]
out = top50[cols].sort_values("rank_eb")
out.to_csv(DELIV / "top50_trends_cameras.csv", index=False)

nar = out[out.narrowed == 1]
L(f"\nNarrowed list (no camera + KSI higher 2020-24 vs 2015-19): {len(nar)} sites")
L(nar[["rank_eb", "int_name", "ped_ksi", "ksi_1519", "ksi_2024", "pedany_1519",
       "pedany_2024", "aadt", "oneway_any"]].to_string(index=False))
L("\nCamera-corridor sites and their trends (context):")
L(out[out.any_camera == 1][["rank_eb", "int_name", "ksi_1519", "ksi_2024",
                            "trend_ksi", "camera_note"]].to_string(index=False))
nar.to_csv(DELIV / "narrowed_shortlist_nocamera_trending_up.csv", index=False)
(QC_LOGS / "qc_trend_camera.txt").write_text("\n".join(log))
