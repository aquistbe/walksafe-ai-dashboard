"""
11_demographics_equity.py
WALKSAFE-AI intersection ranking - Step 11 (addendum 3)
Block-group demographics around the 15 narrowed sites: % under 18, % 65+,
% Hispanic, % non-Hispanic white, % non-Hispanic Black, % minority
(1 - NH white share), compared with citywide Philadelphia values.

Source: 2020 Decennial Census DHC block groups (100% counts - no ACS sampling
error at BG scale), retrieved 2026-07-06 from the Esri Living Atlas services
USA_Census_2020_DHC_Total_Population (P12 age bins) and
USA_Census_2020_DHC_Race_and_Ethnicity (P9), block-group layer, via spatial
point-distance queries in a browser session (the analysis sandbox could not
reach api.census.gov, which now also requires an API key). Raw pull:
demographics_dhc2020.json (includes BG GEOID lists per site).

Catchments (per user direction):
  d100 = "adjacent block groups": all BGs within 100 m of the intersection
         point, capturing every BG meeting at the corner (arterials are often
         BG borders); counts summed = population-weighted average.
  d400 = 400 m (~1/4-mile) walkshed, sensitivity.
Note: site 31 (Chestnut & Cobbs Creek Pkwy) borders Delaware County; its
catchment legitimately includes Delaware County BGs across Cobbs Creek.
"""
import json
import pandas as pd
from pathlib import Path
from config import WORK, OUTPUTS, INPUTS  # repo-relative paths; see pipeline/README.md

OUT = WORK
DELIV = OUTPUTS
# Committed under pipeline/data/, not regenerated: this was pulled from the
# Esri Living Atlas 2020 DHC block-group services on 2026-07-06 because the
# Census API was unreachable and now requires a key. It previously read from
# the scratch dir, where no copy survived.
d = json.loads((INPUTS / "demographics_dhc2020.json").read_text())
city = d["city"]

def pcts(rec):
    p = rec["pop"] or 1
    return dict(pop=rec["pop"], n_bg=rec["n_bg"],
                pct_u18=100 * rec["u18"] / p, pct_65p=100 * rec["o65"] / p,
                pct_hisp=100 * rec["hisp"] / p, pct_nhw=100 * rec["nhw"] / p,
                pct_nhb=100 * rec["nhb"] / p, pct_minority=100 * (1 - rec["nhw"] / p))

rows = []
for rank, rec in d["sites"].items():
    r = {"rank_eb": int(rank)}
    for k, v in pcts(rec["d100"]).items():
        r[k + "_adj"] = v
    for k, v in pcts(rec["d400"]).items():
        r[k + "_400m"] = v
    rows.append(r)
df = pd.DataFrame(rows)

cw = pcts({**city, "n_bg": None})
print("Citywide 2020: u18 {pct_u18:.1f}%, 65+ {pct_65p:.1f}%, Hisp {pct_hisp:.1f}%, "
      "NHW {pct_nhw:.1f}%, NHB {pct_nhb:.1f}%, minority {pct_minority:.1f}%".format(**cw))
for k in ["pct_u18", "pct_65p", "pct_hisp", "pct_nhw", "pct_nhb", "pct_minority"]:
    df[k + "_ratio_city"] = (df[k + "_adj"] / cw[k]).round(2)

nar = pd.read_csv(DELIV / "narrowed_shortlist_with_bike_vru.csv")
nar = nar.merge(df, on="rank_eb")
nar.round(1).to_csv(DELIV / "narrowed_shortlist_full.csv", index=False)

show = nar[["rank_eb", "int_name", "pop_adj", "pct_u18_adj", "pct_65p_adj",
            "pct_hisp_adj", "pct_nhb_adj", "pct_nhw_adj", "pct_minority_adj",
            "pct_u18_400m", "pct_minority_400m"]].sort_values("rank_eb")
print(show.round(1).to_string(index=False))
print("\nAdjacent-BG vs 400m correlation (minority %):",
      nar.pct_minority_adj.corr(nar.pct_minority_400m).round(3))
