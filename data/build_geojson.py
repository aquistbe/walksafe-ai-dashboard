#!/usr/bin/env python3
"""
Build WalkSafe-AI dashboard GeoJSON and summary JSON from intersection ranking data.

Inputs:
  - all_intersections_ranked.csv   (16,984 intersections)
  - top50_trends_cameras.csv       (top-50 trend/camera detail)
  - narrowed_shortlist_full.csv    (15 pilot candidates)

Outputs:
  - intersections.geojson          (FeatureCollection for MapLibre)
  - summary.json                   (aggregate statistics)
"""

import json
import math
import pandas as pd
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE = Path("/sessions/youthful-serene-babbage/mnt/Pedestrian Safety")
SRC  = BASE / "WALKSAFE_site_selection" / "outputs"
OUT  = BASE / "walksafe-ai-dashboard" / "data"

ALL_CSV       = SRC / "all_intersections_ranked.csv"
TOP50_CSV     = SRC / "top50_trends_cameras.csv"
SHORTLIST_CSV = SRC / "narrowed_shortlist_full.csv"

# ---------------------------------------------------------------------------
# 1. Load data
# ---------------------------------------------------------------------------
print("Loading CSVs...")
df_all       = pd.read_csv(ALL_CSV)
df_top50     = pd.read_csv(TOP50_CSV)
df_shortlist = pd.read_csv(SHORTLIST_CSV)

print(f"  all_intersections: {len(df_all):,} rows")
print(f"  top50_trends:      {len(df_top50):,} rows")
print(f"  narrowed_shortlist:{len(df_shortlist):,} rows")

# ---------------------------------------------------------------------------
# 2. Risk-tier classification based on EB KSI
# ---------------------------------------------------------------------------
# Thresholds informed by the distribution:
#   Critical : top ~1%   (eb_ksi >= 0.50)    — roughly 99th percentile
#   High     : top ~5%   (eb_ksi >= 0.25)    — roughly 95th percentile
#   Moderate : top ~25%  (eb_ksi >= 0.05)    — roughly 75th percentile
#   Low      : remainder (eb_ksi < 0.05)

def classify_risk(eb_ksi):
    if eb_ksi >= 0.50:
        return "Critical"
    elif eb_ksi >= 0.25:
        return "High"
    elif eb_ksi >= 0.05:
        return "Moderate"
    else:
        return "Low"

df_all["risk_tier"] = df_all["eb_ksi"].apply(classify_risk)
tier_counts = df_all["risk_tier"].value_counts().to_dict()
print(f"\nRisk tier distribution:")
for t in ["Critical", "High", "Moderate", "Low"]:
    print(f"  {t}: {tier_counts.get(t, 0):,}")

# ---------------------------------------------------------------------------
# 3. Build lookup dicts for top-50 and shortlist enrichment
# ---------------------------------------------------------------------------
top50_node_ids = set(df_top50["node_id"].tolist())
shortlist_node_ids = set(df_shortlist["node_id"].tolist())

# Top-50 extra fields to merge
top50_extra_cols = [
    "ksi_1519", "ksi_2024", "trend_ksi",
    "pedany_1519", "pedany_2024", "trend_pedany",
    "any_camera", "camera_note",
    "oneway_any", "min_class", "nacto_recs"
]
top50_lookup = {}
for _, row in df_top50.iterrows():
    extras = {}
    for col in top50_extra_cols:
        val = row.get(col)
        if pd.notna(val):
            extras[col] = val
    top50_lookup[row["node_id"]] = extras

# Shortlist extra fields
shortlist_extra_cols = [
    "nacto_score", "bike_ksi", "bike_any",
    "bike_ksi_1519", "bike_ksi_2024",
    "vru_any", "eb_bike", "rank_eb_bike", "rank_vru_any", "vru_any_pctile",
    "pop_adj", "pct_u18_adj", "pct_65p_adj",
    "pct_hisp_adj", "pct_nhw_adj", "pct_nhb_adj", "pct_minority_adj",
    "pop_400m", "pct_minority_400m"
]
shortlist_lookup = {}
for _, row in df_shortlist.iterrows():
    extras = {}
    for col in shortlist_extra_cols:
        val = row.get(col)
        if pd.notna(val):
            extras[col] = val
    shortlist_lookup[row["node_id"]] = extras

# ---------------------------------------------------------------------------
# 4. Helper: sanitise values for JSON (handle NaN/Inf)
# ---------------------------------------------------------------------------
def sanitise(val):
    if isinstance(val, float):
        if math.isnan(val) or math.isinf(val):
            return None
        # Round floats to reduce file size
        if abs(val) > 1000:
            return round(val, 1)
        return round(val, 6)
    if isinstance(val, (int,)):
        return int(val)
    return val

# ---------------------------------------------------------------------------
# 5. Build GeoJSON features
# ---------------------------------------------------------------------------
print("\nBuilding GeoJSON features...")
features = []
skipped = 0

for _, row in df_all.iterrows():
    lat = row["lat"]
    lon = row["lon"]

    # Skip rows with missing / clearly invalid coordinates
    if pd.isna(lat) or pd.isna(lon):
        skipped += 1
        continue
    if not (39.8 < lat < 40.2 and -75.3 < lon < -74.9):
        skipped += 1
        continue

    node_id = int(row["node_id"])
    is_top50 = node_id in top50_node_ids
    is_pilot = node_id in shortlist_node_ids

    # Core properties
    props = {
        "node_id":           node_id,
        "int_name":          str(row["int_name"]),
        "stoptype":          str(row["stoptype"]),
        "ped_ksi":           int(row["ped_ksi"]),
        "ped_any":           int(row["ped_any"]),
        "ped_deaths":        int(row["ped_deaths"]),
        "ped_susp_serious":  int(row["ped_susp_serious"]),
        "ped_ksi_persons":   int(row["ped_ksi_persons"]),
        "ped_crashes":       int(row["ped_crashes"]),
        "aadt":              sanitise(row["aadt"]),
        "aadt_measured":     sanitise(row["aadt_measured"]),
        "pop_800m":          sanitise(row["pop_800m"]),
        "parks_200m":        int(row["parks_200m"]),
        "schools_200m":      int(row["schools_200m"]),
        "on_hin":            bool(row["on_hin"]),
        "hin_dist_m":        sanitise(row["hin_dist_m"]),
        "mev":               sanitise(row["mev"]),
        "ksi_per_mev":       sanitise(row["ksi_per_mev"]),
        "rate_reliable":     bool(row.get("rate_reliable", 0)),
        "mu_spf":            sanitise(row["mu_spf"]),
        "eb_ksi":            sanitise(row["eb_ksi"]),
        "rank_raw":          int(row["rank_raw"]),
        "rank_rate":         int(row["rank_rate"]),
        "rank_eb":           int(row["rank_eb"]),
        "rank_mean":         sanitise(row["rank_mean"]),
        "risk_tier":         row["risk_tier"],
        "top50":             is_top50,
        "pilot_candidate":   is_pilot,
    }

    # Merge top-50 trend/camera data
    if is_top50 and node_id in top50_lookup:
        for k, v in top50_lookup[node_id].items():
            props[k] = sanitise(v) if isinstance(v, float) else v

    # Merge shortlist extras (demographics, bike/VRU, NACTO score)
    if is_pilot and node_id in shortlist_lookup:
        for k, v in shortlist_lookup[node_id].items():
            props[k] = sanitise(v) if isinstance(v, float) else v

    feature = {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [round(lon, 6), round(lat, 6)]
        },
        "properties": props
    }
    features.append(feature)

print(f"  Features built: {len(features):,}")
print(f"  Skipped (bad coords): {skipped}")

# ---------------------------------------------------------------------------
# 6. Write GeoJSON
# ---------------------------------------------------------------------------
geojson = {
    "type": "FeatureCollection",
    "metadata": {
        "name": "WalkSafe-AI Philadelphia Intersection Rankings",
        "description": "Pedestrian KSI (killed/suspected-serious-injury) intersection analysis, PennDOT crash data 2015-2024",
        "source": "PennDOT PCDS + DVRPC AADT + City of Philadelphia GIS",
        "date_range": "2015-2024",
        "coordinate_system": "EPSG:4326 (WGS84)",
        "generated": datetime.now().isoformat(),
        "risk_tier_thresholds": {
            "Critical": "eb_ksi >= 0.50 (approx top 1%)",
            "High":     "eb_ksi >= 0.25 (approx top 5%)",
            "Moderate": "eb_ksi >= 0.05 (approx top 25%)",
            "Low":      "eb_ksi < 0.05"
        }
    },
    "features": features
}

geojson_path = OUT / "intersections.geojson"
print(f"\nWriting {geojson_path} ...")
with open(geojson_path, "w") as f:
    json.dump(geojson, f, separators=(",", ":"))

geojson_size = geojson_path.stat().st_size
print(f"  Size: {geojson_size / 1_048_576:.2f} MB")

# ---------------------------------------------------------------------------
# 7. Build summary JSON
# ---------------------------------------------------------------------------
print("\nBuilding summary.json ...")

# KSI statistics
total_ksi   = int(df_all["ped_ksi"].sum())
total_deaths = int(df_all["ped_deaths"].sum())
total_any   = int(df_all["ped_any"].sum())

# Intersections with at least 1 KSI
has_ksi = int((df_all["ped_ksi"] > 0).sum())

# EB KSI stats
eb_stats = df_all["eb_ksi"].describe().to_dict()
eb_percentiles = {}
for p in [50, 75, 90, 95, 99]:
    eb_percentiles[f"p{p}"] = round(float(df_all["eb_ksi"].quantile(p / 100)), 6)

# Stoptype breakdown
stoptype_counts = df_all["stoptype"].value_counts().to_dict()

# HIN breakdown
hin_counts = {
    "on_hin": int(df_all["on_hin"].sum()),
    "off_hin": int((~df_all["on_hin"].astype(bool)).sum())
}

# Top-50 trend summary
trend_higher = int((df_top50["trend_ksi"] == "higher").sum())
trend_lower  = int((df_top50["trend_ksi"] == "lower").sum())
trend_same   = int((df_top50["trend_ksi"] == "same").sum())
camera_count = int(df_top50["any_camera"].sum())

# Shortlist summary
shortlist_names = df_shortlist["int_name"].tolist()

summary = {
    "generated": datetime.now().isoformat(),
    "data_source": "PennDOT PCDS crash data + DVRPC AADT",
    "date_range": {"start": 2015, "end": 2024, "years": 10},
    "total_intersections": len(features),
    "intersections_with_ksi": has_ksi,
    "total_ped_ksi_crashes": total_ksi,
    "total_ped_deaths": total_deaths,
    "total_ped_crashes": total_any,
    "risk_tiers": {
        "Critical": tier_counts.get("Critical", 0),
        "High": tier_counts.get("High", 0),
        "Moderate": tier_counts.get("Moderate", 0),
        "Low": tier_counts.get("Low", 0),
    },
    "risk_tier_thresholds": {
        "Critical": "eb_ksi >= 0.50",
        "High":     "0.25 <= eb_ksi < 0.50",
        "Moderate": "0.05 <= eb_ksi < 0.25",
        "Low":      "eb_ksi < 0.05"
    },
    "eb_ksi_stats": {
        "mean": round(eb_stats["mean"], 6),
        "std": round(eb_stats["std"], 6),
        "min": round(eb_stats["min"], 6),
        "max": round(eb_stats["max"], 6),
        "percentiles": eb_percentiles
    },
    "stoptype_breakdown": stoptype_counts,
    "hin_breakdown": hin_counts,
    "top50_summary": {
        "count": len(df_top50),
        "trend_ksi_higher": trend_higher,
        "trend_ksi_lower": trend_lower,
        "trend_ksi_same": trend_same,
        "with_speed_camera": camera_count,
    },
    "pilot_candidates": {
        "count": len(df_shortlist),
        "sites": shortlist_names
    },
    "geojson_file": "intersections.geojson",
    "geojson_size_mb": round(geojson_size / 1_048_576, 2),
}

summary_path = OUT / "summary.json"
with open(summary_path, "w") as f:
    json.dump(summary, f, indent=2)

print(f"  Written: {summary_path}")
print(f"  Size: {summary_path.stat().st_size / 1024:.1f} KB")

print("\nDone.")
