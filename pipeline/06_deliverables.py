"""
06_deliverables.py
WALKSAFE-AI intersection ranking - Step 6 (deliverables)
- Top-50 table (CSV) with all three ranks and covariates
- Pilot shortlist (~12): greedy selection down the EB ranking with >=1.2 km
  spacing and max 3 sites per primary corridor, for geographic spread
- Interactive leaflet map (HTML)
- GIS files: ESRI shapefiles in EPSG:2272 and EPSG:4326 (sandbox GDAL cannot
  write GeoPackage), plus GeoJSON
"""
import pandas as pd
import numpy as np
import geopandas as gpd
import folium
from pathlib import Path
from config import WORK, OUTPUTS, GIS  # repo-relative paths; see pipeline/README.md

OUT = WORK
DELIV = OUTPUTS
M2FT = 3.280839895

df = pd.read_csv(OUT / "intersections_ranked.csv")

# The dashboard consumes this filename. It was previously produced by hand-
# copying 04's output and renaming it, so a clean pipeline run left the
# dashboard build with no input. Write it here instead.
df.to_csv(DELIV / "all_intersections_ranked.csv", index=False)

cols = ["node_id", "int_name", "lat", "lon", "x_2272", "y_2272",
        "ped_ksi", "ped_deaths", "ped_susp_serious", "ped_ksi_persons", "ped_any",
        "ped_crashes", "aadt", "aadt_measured", "mev", "ksi_per_mev",
        "mu_spf", "eb_ksi", "stoptype", "on_hin", "schools_200m", "parks_200m",
        "pop_800m", "rank_raw", "rank_rate", "rank_eb"]
top50 = df.nsmallest(50, "rank_eb")[cols].reset_index(drop=True)
top50["rank_agreement"] = np.where(top50.rank_raw <= 50, "raw+EB", "EB only")
top50.round(3).to_csv(DELIV / "top50_intersections.csv", index=False)

# ---------- shortlist: greedy spacing + corridor cap ----------
def primary_street(name):
    return str(name).split("&")[0].strip()

sel = []
MIN_SPACING_FT = 1200 * M2FT  # 1.2 km
for _, r in top50.iterrows():
    if len(sel) >= 12:
        break
    ok = all(np.hypot(r.x_2272 - s.x_2272, r.y_2272 - s.y_2272) > MIN_SPACING_FT for s in sel)
    corridor = primary_street(r.int_name)
    ok &= sum(primary_street(s.int_name) == corridor for s in sel) < 3
    if ok:
        sel.append(r)
short = pd.DataFrame(sel).reset_index(drop=True)
short["pilot_note"] = [
    f"{'HIN; ' if s.on_hin else ''}{s.stoptype}; "
    f"{int(s.schools_200m)} school(s), {int(s.parks_200m)} park(s) within 200 m; "
    f"AADT {int(s.aadt):,}" for s in short.itertuples()]
short.round(3).to_csv(DELIV / "pilot_shortlist.csv", index=False)
print("Shortlist:")
print(short[["rank_eb", "int_name", "ped_ksi", "ped_deaths", "eb_ksi", "stoptype"]].to_string(index=False))

# top unsignalized sites for contrast (not in top 50 - all top 50 signalized)
uns = df[df.stoptype != "Signalized"].nsmallest(5, "rank_eb")
print("\nTop 5 unsignalized (EB):")
print(uns[["rank_eb", "int_name", "stoptype", "ped_ksi", "eb_ksi"]].to_string(index=False))
uns.round(3).to_csv(DELIV / "top_unsignalized_reference.csv", index=False)

# ---------- GIS files ----------
g50 = gpd.GeoDataFrame(top50.copy(),
                       geometry=gpd.points_from_xy(top50.x_2272, top50.y_2272), crs=2272)
g50["shortlist"] = g50.node_id.isin(short.node_id).astype(int)
sh = g50.rename(columns=lambda c: c[:10])  # shapefile 10-char limit
(DELIV / "gis").mkdir(exist_ok=True)
sh.to_file(DELIV / "gis" / "top50_intersections_2272.shp")
sh.to_crs(4326).to_file(DELIV / "gis" / "top50_intersections_wgs84.shp")
g50.to_crs(4326).to_file(DELIV / "gis" / "top50_intersections.geojson", driver="GeoJSON")
gall = gpd.GeoDataFrame(df.copy(), geometry=gpd.points_from_xy(df.x_2272, df.y_2272), crs=2272)
gall.to_crs(4326).to_file(DELIV / "gis" / "all_intersections_ranked.geojson", driver="GeoJSON")

# ---------- Leaflet map ----------
hin = gpd.read_file(GIS / "high_injury_network_2020").to_crs(4326)
m = folium.Map(location=[39.99, -75.13], zoom_start=12, tiles="cartodbpositron")
folium.GeoJson(hin, name="High Injury Network 2020",
               style_function=lambda f: {"color": "#f4a582", "weight": 2, "opacity": 0.7}).add_to(m)
w = g50.to_crs(4326)
for _, r in w.iterrows():
    is_short = r.shortlist == 1
    folium.CircleMarker(
        location=[r.geometry.y, r.geometry.x],
        radius=9 if is_short else 5,
        color="#b2182b" if is_short else "#2166ac",
        fill=True, fill_opacity=0.9 if is_short else 0.6,
        popup=folium.Popup(
            f"<b>{r.int_name}</b><br>EB rank {int(r.rank_eb)} | raw rank {int(r.rank_raw)}<br>"
            f"ped KSI 2015-2024: {int(r.ped_ksi)} (deaths {int(r.ped_deaths)})<br>"
            f"EB expected KSI: {r.eb_ksi:.2f} | AADT {int(r.aadt):,}<br>"
            f"{r.stoptype}; {'on' if r.on_hin else 'off'} HIN"
            + ("<br><b>PILOT SHORTLIST</b>" if is_short else ""), max_width=280)).add_to(m)
folium.LayerControl().add_to(m)
legend = ('<div style="position:fixed;bottom:20px;left:20px;z-index:1000;background:white;'
          'padding:10px;border:1px solid #999;font-size:13px">'
          '<b>WALKSAFE-AI candidate sites</b><br>'
          '<span style="color:#b2182b">&#9679;</span> Pilot shortlist (n=%d)<br>'
          '<span style="color:#2166ac">&#9679;</span> Top-50 by EB expected ped KSI<br>'
          '<span style="color:#f4a582">&#9473;</span> High Injury Network 2020</div>' % len(short))
m.get_root().html.add_child(folium.Element(legend))
m.save(str(DELIV / "candidate_sites_map.html"))
print(f"\nSaved deliverables to {DELIV}")
