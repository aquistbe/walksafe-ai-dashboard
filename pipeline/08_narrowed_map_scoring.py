"""
08_narrowed_map_scoring.py
WALKSAFE-AI intersection ranking - Step 8 (addendum)
Score the narrowed (no-camera, trending-higher) sites for NACTO-style
countermeasure amenability using attributes available in the data, and build
an updated map distinguishing narrowed sites, camera-corridor sites, and the
rest of the top 50.

Amenability score (0-8, higher = more tractable with standard NACTO
Urban Street Design Guide tools; all 15 are signalized so signal-based
treatments apply everywhere):
  +2 AADT 10-25k          (multi-lane arterial: refuge islands, lane
                           repurposing / road-diet feasible without capacity crisis)
  +1 AADT < 10k           (curb extensions, raised crossings cheap and easy)
  +1 one-way approach     (progression speed control; simpler signal phasing)
  +1 school within 200 m  (school-zone treatments, Safe Routes funding)
  +1 park within 200 m    (park-edge crossings)
  +1 ped-any also rising  (persistent exposure conflict, not a KSI blip)
  +2 >=2 KSI increase     (largest absolute deterioration)
"""
import pandas as pd
import numpy as np
import geopandas as gpd
import folium
from pathlib import Path
from config import OUTPUTS, GIS  # repo-relative paths; see pipeline/README.md

DELIV = OUTPUTS
t = pd.read_csv(DELIV / "top50_trends_cameras.csv")

def score(r):
    s = 0
    if 10000 <= r.aadt <= 25000: s += 2
    elif r.aadt < 10000: s += 1
    if r.oneway_any == 1: s += 1
    if r.schools_200m > 0: s += 1
    if r.parks_200m > 0: s += 1
    if r.trend_pedany == "higher": s += 1
    if (r.ksi_2024 - r.ksi_1519) >= 2: s += 2
    return s

t["nacto_score"] = t.apply(score, axis=1)
nar = t[t.narrowed == 1].sort_values(["nacto_score", "rank_eb"], ascending=[False, True])
nar.to_csv(DELIV / "narrowed_shortlist_nocamera_trending_up.csv", index=False)
print(nar[["rank_eb", "int_name", "ksi_1519", "ksi_2024", "trend_pedany",
           "aadt", "oneway_any", "schools_200m", "parks_200m", "nacto_score"]].to_string(index=False))

# ---------- map ----------
hin = gpd.read_file(GIS / "high_injury_network_2020").to_crs(4326)
m = folium.Map(location=[39.99, -75.13], zoom_start=12, tiles="cartodbpositron")
folium.GeoJson(hin, name="High Injury Network 2020",
               style_function=lambda f: {"color": "#fddbc7", "weight": 2, "opacity": 0.8}).add_to(m)
for _, r in t.sort_values("rank_eb").iterrows():
    if r.narrowed == 1:
        color, radius, cls = "#b2182b", 9, "NARROWED: no camera, KSI trending up"
    elif r.any_camera == 1:
        color, radius, cls = "#878787", 5, "Speed-camera corridor"
    else:
        color, radius, cls = "#2166ac", 6, "Top-50, no camera, not trending up"
    folium.CircleMarker(
        location=[r.lat, r.lon], radius=radius, color=color, fill=True,
        fill_opacity=0.9 if r.narrowed else 0.55,
        popup=folium.Popup(
            f"<b>{r.int_name}</b><br>{cls}<br>"
            f"EB rank {int(r.rank_eb)} | ped KSI 2015-19: {int(r.ksi_1519)} -> 2020-24: {int(r.ksi_2024)}<br>"
            f"ped-any: {int(r.pedany_1519)} -> {int(r.pedany_2024)}<br>"
            f"AADT {int(r.aadt):,} | {r.stoptype}<br>"
            f"Camera: {r.camera_note}<br>"
            + (f"NACTO score {int(r.nacto_score)}: {r.nacto_recs}" if r.narrowed else ""),
            max_width=300)).add_to(m)
folium.LayerControl().add_to(m)
legend = ('<div style="position:fixed;bottom:20px;left:20px;z-index:1000;background:white;'
          'padding:10px;border:1px solid #999;font-size:13px">'
          '<b>WALKSAFE-AI narrowed candidates</b><br>'
          '<span style="color:#b2182b">&#9679;</span> No camera + KSI trending up (n=%d)<br>'
          '<span style="color:#878787">&#9679;</span> Speed-camera corridor (n=%d)<br>'
          '<span style="color:#2166ac">&#9679;</span> Other top-50<br>'
          '<span style="color:#fddbc7">&#9473;</span> High Injury Network</div>'
          % (int(t.narrowed.sum()), int(t.any_camera.sum())))
m.get_root().html.add_child(folium.Element(legend))
m.save(str(DELIV / "narrowed_sites_map.html"))
print(f"\nSaved narrowed_sites_map.html; narrowed n={t.narrowed.sum()}, camera n={t.any_camera.sum()}")
