#!/usr/bin/env python3
"""
Build data/bogota_zats.geojson — Bogota ZAT (transport analysis zone) polygons
joined to the WalkSafe-AI Bogota analysis tables.

Inputs (all in data/source/, see its README for provenance and checksums):
  Zonas_ZAT.geojson                   2,356 MultiPolygons, two vintages.
                                      Filtered to anio_zat == 2019 -> 1,141.
  zat_pr312k_all.csv                  840 rows. clus + 27 CANVAS-derived
                                      built-environment features from the
                                      DINO/STRIDE extraction (~312k GSV points).
  profile312k_all_covar_unscaled.csv  783 rows. ses_cat, crash counts
                                      2015-2019, pop density, road composition.
  zat_pop60plus_2018.csv              851 rows. 60+ population, 2018 census.
  zat_profile_models_with_age60.csv   Fitted cluster RRs. Reference = cluster 4.

Output:
  data/bogota_zats.geojson            One feature per 2019 ZAT.

Design notes
------------
* Join key is id_zat (geometry) -> ZAT (analysis tables).
* The analysis tables cover fewer zones than the geometry. Unmatched zones are
  CARRIED THROUGH with null values and has_data = false, so the choropleth can
  render them as "no data" rather than as low risk.
* Geometry is reduced by coordinate quantisation, not Douglas-Peucker.
  Quantising every vertex to a common grid is topology-safe: shared boundaries
  between adjacent zones stay identical, so no slivers open up between zones.
  Per-polygon simplification would break that. A simplify pass exists as a
  fallback but only engages if quantisation alone misses the size target.
* ZAT analyses are ECOLOGICAL. Area-level associations, not individual risk.
  That caveat travels with the data in metadata.caveat.
"""

import json
import math
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd
from shapely.geometry import shape, mapping
from shapely.ops import transform as shapely_transform

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rates import per_10k  # noqa: E402

# ---------------------------------------------------------------------------
# Paths — everything stays inside the repository
# ---------------------------------------------------------------------------
REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "data" / "source"
OUT = REPO / "data" / "bogota_zats.geojson"

GEOM_JSON = SRC / "Zonas_ZAT.geojson"
FEATURES_CSV = SRC / "zat_pr312k_all.csv"
COVAR_CSV = SRC / "profile312k_all_covar_unscaled.csv"
POP60_CSV = SRC / "zat_pop60plus_2018.csv"
MODELS_CSV = SRC / "zat_profile_models_with_age60.csv"

# ---------------------------------------------------------------------------
# Build parameters
# ---------------------------------------------------------------------------
VINTAGE = 2019          # matches the 2015-2019 crash window
COORD_DECIMALS = 5      # ~1.1 m at Bogota's latitude
SIZE_TARGET_MB = 5.0

# Two model specifications exist and BOTH are carried, per zone:
#   "replication"  n = 770, all ages, no age adjustment  — the primary result
#   "plus_pct60"   n = 768, adjusted for the 60+ population share
# Bogota was fitted across all age groups. plus_pct60 is the secondary analysis
# that makes the comparison to Philadelphia's older-adult focus possible.
# The two are NOT interchangeable — never mix estimates across them.
PRIMARY_MODEL = "replication"
SECONDARY_MODEL = "plus_pct60"
REFERENCE_CLUSTER = 4   # dense arterial / mass-transit corridor profile

# Crash outcomes carried. Damage-only crashes are EXCLUDED: nearly every
# pedestrian struck by a motor vehicle is injured or killed, and the source
# damage column bears that out — 764 of 783 zones are zero and the remaining 19
# carry one each. The source `total` column is injury + death + damage, so it is
# not carried either; `casualties` (injury + death) is computed instead.
CRASH_OUTCOMES = ["injury", "death"]

# The 27 built-environment features, in source order. These descend from the
# CANVAS pedestrian safety audit instrument, which also seeded the Gemini
# taxonomy in scoring/prompts.py — the two are NOT independent instruments.
CANVAS_FEATURES = [
    "sign_traffic", "traffic_light", "sign_crossing", "pedestrian_light",
    "sign_stop", "sign_yield", "sign_school_zone", "sidewalk", "crosswalk",
    "lane_marking", "lane_bike", "lane_bus", "roundabout", "curb", "bollards",
    "median", "median_barrier", "speed_bump", "trees", "bus_stop",
    "street_lights", "kiosks", "parked_vehicles", "sidewalk_obstruction",
    "lane_parking", "brt_station", "potholes",
]

# Carried from profile312k_all_covar_unscaled.csv — the widest table by column
# count, and the source of record for anything it contains. `ses_cat_r` is
# byte-identical to `ses_cat`, so only one is carried. `damage` and `total` are
# deliberately absent (see CRASH_OUTCOMES).
COVAR_FIELDS = [
    "ses_cat", "injury", "death",
    "walk_pubt", "pop_density", "pcta_Collector", "pcta_Local", "pcta_other",
    "MEANIPM",
]


def nz(val, digits=6):
    """JSON-safe scalar: NaN/Inf -> None, numpy types -> python, floats rounded."""
    if val is None:
        return None
    if isinstance(val, float):
        if math.isnan(val) or math.isinf(val):
            return None
        return round(val, digits)
    if hasattr(val, "item"):          # numpy scalar
        val = val.item()
        return nz(val, digits) if isinstance(val, float) else val
    return val


# ---------------------------------------------------------------------------
# 1. Geometry
# ---------------------------------------------------------------------------
print("Loading geometry ...")
if not GEOM_JSON.exists():
    sys.exit(f"Missing {GEOM_JSON}\nSee data/source/README.md — this file is "
             f"gitignored by design.")

with open(GEOM_JSON) as f:
    raw = json.load(f)

all_feats = raw["features"]
vintages = pd.Series([f["properties"].get("anio_zat") for f in all_feats])
print(f"  {len(all_feats):,} features, vintages: "
      f"{vintages.value_counts().sort_index().to_dict()}")

geom_feats = [f for f in all_feats if f["properties"].get("anio_zat") == VINTAGE]
print(f"  Filtered to anio_zat == {VINTAGE}: {len(geom_feats):,} zones")

geom_ids = [int(f["properties"]["id_zat"]) for f in geom_feats]
dupe_ids = pd.Series(geom_ids).duplicated().sum()
if dupe_ids:
    print(f"  WARNING: {dupe_ids} duplicate id_zat values within the {VINTAGE} vintage")

# ---------------------------------------------------------------------------
# 2. Analysis tables
# ---------------------------------------------------------------------------
print("\nLoading analysis tables ...")
df_feat = pd.read_csv(FEATURES_CSV, index_col=0)
df_covar = pd.read_csv(COVAR_CSV, na_values=["NA"])
df_pop60 = pd.read_csv(POP60_CSV, na_values=["NA"])
df_models = pd.read_csv(MODELS_CSV)

for name, df in [("zat_pr312k_all", df_feat),
                 ("profile312k_all_covar_unscaled", df_covar),
                 ("zat_pop60plus_2018", df_pop60),
                 ("zat_profile_models_with_age60", df_models)]:
    print(f"  {name:<34} {len(df):>6,} rows")

df_feat["ZAT"] = df_feat["ZAT"].astype(int)
df_covar["ZAT"] = df_covar["ZAT"].astype(int)
df_pop60["ZAT"] = df_pop60["ZAT"].astype(int)

# Cluster assignment appears in both tables. Check they agree before trusting
# either — a silent disagreement would mis-colour the choropleth.
clus_check = df_feat[["ZAT", "clus"]].merge(
    df_covar[["ZAT", "clus"]], on="ZAT", suffixes=("_feat", "_covar"))
clus_disagree = int((clus_check["clus_feat"] != clus_check["clus_covar"]).sum())
print(f"  cluster assignment: {len(clus_check):,} ZATs in both tables, "
      f"{clus_disagree} disagreements")

feat_by_zat = df_feat.set_index("ZAT").to_dict("index")
covar_by_zat = df_covar.set_index("ZAT").to_dict("index")
pop60_by_zat = df_pop60.set_index("ZAT").to_dict("index")

# ---------------------------------------------------------------------------
# 3. Cluster relative risks
# ---------------------------------------------------------------------------
# Reference cluster carries no estimate; it is RR 1.00 by construction.
rr_lookup = {}          # (model, outcome, cluster) -> dict
for _, row in df_models.iterrows():
    term = str(row["term"])
    if not term.startswith("clus"):
        continue
    cluster = int(term.replace("clus", ""))
    rr_lookup[(row["model"], row["outcome"], cluster)] = {
        "rr": nz(float(row["RR"]), 4),
        "lo": nz(float(row["lo"]), 4),
        "hi": nz(float(row["hi"]), 4),
        "p": nz(float(row["p"]), 8),
        "n": int(row["n"]),
    }

model_n = {m: int(df_models[df_models["model"] == m]["n"].max())
           for m in df_models["model"].unique()}
model_clusters = sorted({k[2] for k in rr_lookup})

print(f"\nCluster RR models: {model_n}, reference = cluster {REFERENCE_CLUSTER}")
for model in [PRIMARY_MODEL, SECONDARY_MODEL]:
    role = "primary, all ages" if model == PRIMARY_MODEL else "secondary, + 60+ share"
    print(f"  {model}  (n = {model_n[model]}, {role})")
    for outcome in CRASH_OUTCOMES:
        parts = []
        for c in model_clusters:
            e = rr_lookup[(model, outcome, c)]
            parts.append(f"clus{c} {e['rr']:.2f} ({e['lo']:.2f}-{e['hi']:.2f})")
        print(f"    {outcome:<7} " + "  ".join(parts))


def rr_block(cluster):
    """Both model specifications for one cluster, or the reference marker.

    The reference cluster has no estimate — it is RR 1.00 by construction, and
    is emitted with null bounds so the UI cannot render a spurious interval.
    """
    if cluster is None:
        return None
    out = {"reference_cluster": REFERENCE_CLUSTER,
           "is_reference": cluster == REFERENCE_CLUSTER,
           "primary_model": PRIMARY_MODEL,
           "secondary_model": SECONDARY_MODEL}
    for model in [PRIMARY_MODEL, SECONDARY_MODEL]:
        block = {"n": model_n.get(model)}
        for outcome in CRASH_OUTCOMES:
            if cluster == REFERENCE_CLUSTER:
                block[outcome] = {"rr": 1.0, "lo": None, "hi": None, "p": None,
                                  "n": model_n.get(model)}
            else:
                block[outcome] = rr_lookup.get((model, outcome, cluster))
        out[model] = block
    return out


# ---------------------------------------------------------------------------
# 4. Geometry reduction — quantise, then simplify only if still too large
# ---------------------------------------------------------------------------
# Bogota sits at ~4.6 N. Degrees -> km for the area calculation.
LAT_KM = 110.57
LON_KM = 111.32 * math.cos(math.radians(4.65))


def quantise_ring(ring, decimals):
    """Round to a common grid, drop the Z ordinate, drop repeated vertices."""
    out = []
    for pt in ring:
        p = (round(pt[0], decimals), round(pt[1], decimals))
        if not out or p != out[-1]:
            out.append(p)
    if len(out) >= 3 and out[0] != out[-1]:
        out.append(out[0])
    return out if len(out) >= 4 else None


def quantise_geometry(geom, decimals):
    """Apply quantise_ring across a (Multi)Polygon, dropping collapsed rings."""
    gtype = geom["type"]
    if gtype == "Polygon":
        polys = [geom["coordinates"]]
    elif gtype == "MultiPolygon":
        polys = geom["coordinates"]
    else:
        return None

    kept = []
    for poly in polys:
        rings = [r for r in (quantise_ring(ring, decimals) for ring in poly) if r]
        if rings:                      # exterior survived
            kept.append(rings)
    if not kept:
        return None
    if len(kept) == 1:
        return {"type": "Polygon", "coordinates": kept[0]}
    return {"type": "MultiPolygon", "coordinates": kept}


def area_km2(geom):
    g = shape(geom)
    return g.area * LAT_KM * LON_KM      # planar approximation, adequate here


print(f"\nReducing geometry (quantise to {COORD_DECIMALS} decimals, "
      f"~{110_000 / 10 ** COORD_DECIMALS:.1f} m grid) ...")

geometries = {}
areas = {}
dropped_geom = 0
for f in geom_feats:
    zid = int(f["properties"]["id_zat"])
    q = quantise_geometry(f["geometry"], COORD_DECIMALS)
    if q is None:
        dropped_geom += 1
        continue
    geometries[zid] = q
    areas[zid] = area_km2(q)

if dropped_geom:
    print(f"  {dropped_geom} zones collapsed to nothing and were dropped")
print(f"  {len(geometries):,} zones retained")

# ---------------------------------------------------------------------------
# 5. Join and build features
# ---------------------------------------------------------------------------
print("\nJoining ...")

matched_feat = matched_covar = matched_pop = 0
matched_any = 0
features = []

for zid in sorted(geometries):
    frow = feat_by_zat.get(zid)
    crow = covar_by_zat.get(zid)
    prow = pop60_by_zat.get(zid)

    matched_feat += frow is not None
    matched_covar += crow is not None
    matched_pop += prow is not None

    # Cluster: take it from whichever table has it, preferring the features
    # table because it covers 840 zones against the covariate table's 783 and
    # the two agree on every shared zone. profile312k_all_covar_unscaled is the
    # source of record for everything else, but using it for `clus` as well
    # would discard 57 zones' cluster assignment for no gain.
    cluster = None
    if frow is not None and pd.notna(frow.get("clus")):
        cluster = int(frow["clus"])
    elif crow is not None and pd.notna(crow.get("clus")):
        cluster = int(crow["clus"])

    has_data = any(x is not None for x in (frow, crow, prow))
    matched_any += has_data

    # Zones with no analysis data at all lie outside Bogotá D.C. — they are
    # greater-metropolitan-area ZATs that the 2019 boundary file carries but no
    # analysis covers. Dropping them frames the map on the city rather than
    # ringing it with permanently grey polygons. The per-variable gates
    # (has_features / has_covariates / has_pop60) still apply WITHIN the city,
    # where missingness is real and must stay visible.
    if not has_data:
        continue

    props = {
        # --- generic analysis-unit identity (shared with the point schema) ---
        "unit_id": zid,
        "unit_name": f"ZAT {zid}",
        "has_data": has_data,
        "area_km2": nz(areas[zid], 4),
        # --- cluster profile ---
        "clus": cluster,
        "is_reference_cluster": (cluster == REFERENCE_CLUSTER) if cluster else None,
        # Per-table presence flags. These exist because MapLibre cannot test for
        # a null property: `["has", k]` compiles to `k in properties`, which is
        # true for a key whose value is null, and `["to-number", ["get", k], 0]`
        # short-circuits null to 0 before reaching its fallback. A choropleth
        # gated on either would paint no-data zones as a real value. An
        # always-present boolean is the only reliable gate, and each layer needs
        # the flag for ITS OWN table: 301 zones lack a cluster, 358 lack crash
        # data, 290 lack population. `has_data` (the union) fits none of them.
        "has_features": frow is not None,
        "has_covariates": crow is not None,
        "has_pop60": prow is not None,
    }

    # Crash counts, SES, road composition. profile312k_all_covar_unscaled is
    # the source of record for every field it carries.
    for col in COVAR_FIELDS:
        props[col] = nz(crow.get(col)) if crow is not None else None

    # Pedestrian casualties = injury + death. Damage-only crashes excluded.
    if props["injury"] is not None or props["death"] is not None:
        props["casualties"] = int((props["injury"] or 0) + (props["death"] or 0))
    else:
        props["casualties"] = None

    # 60+ population
    if prow is not None:
        props["pop_total_2018"] = nz(prow.get("pop_total_2018"), 0)
        props["pop60plus_2018"] = nz(prow.get("pop60plus_2018"), 0)
        props["pct60plus"] = nz(prow.get("pct60plus"), 2)
        props["n_manzanas"] = nz(prow.get("n_manzanas"), 0)
    else:
        props.update({"pop_total_2018": None, "pop60plus_2018": None,
                      "pct60plus": None, "n_manzanas": None})

    # 27 CANVAS-derived features
    if frow is not None:
        props["features"] = {k: nz(frow.get(k), 2) for k in CANVAS_FEATURES}
    else:
        props["features"] = None

    # Cluster RR (attached per zone for convenience; it varies only by cluster)
    props["rr"] = rr_block(cluster)

    # Crash density — a defensible choropleth metric that is not itself a rate
    # per person. Still ecological.
    if props["casualties"] is not None and areas[zid] > 0:
        props["casualties_per_km2"] = nz(props["casualties"] / areas[zid], 2)
        props["injury_per_km2"] = nz((props["injury"] or 0) / areas[zid], 2)
        props["death_per_km2"] = nz((props["death"] or 0) / areas[zid], 3)
    else:
        props["casualties_per_km2"] = None
        props["injury_per_km2"] = None
        props["death_per_km2"] = None

    # Exposure-adjusted rate: outcome per 10,000 walking + public-transport
    # trips (`walk_pubt`, 2019 mobility survey). This is the denominator the
    # ZAT analyses use (Zewdie et al. 2024 enter it as the offset), and it is
    # what the map colours since 24 Aug 2026; per-km2 stays as area density.
    # Shared helper so data/rederive_bogota_rates.py produces identical values.
    trips = props.get("walk_pubt")
    props["casualties_per_10k_trips"] = per_10k(props["casualties"], trips)
    props["injury_per_10k_trips"] = per_10k(props["injury"], trips)
    props["death_per_10k_trips"] = per_10k(props["death"], trips, 3)

    features.append({"type": "Feature", "geometry": geometries[zid],
                     "properties": props})

n_geom = len(geometries)
print(f"  zones with 27 features (zat_pr312k_all):     "
      f"{matched_feat:>5,} / {n_geom:,}  ({matched_feat / n_geom:5.1%})")
print(f"  zones with covariates + crashes (profile):   "
      f"{matched_covar:>5,} / {n_geom:,}  ({matched_covar / n_geom:5.1%})")
print(f"  zones with 60+ population:                   "
      f"{matched_pop:>5,} / {n_geom:,}  ({matched_pop / n_geom:5.1%})")
print(f"  zones with ANY analysis data:                "
      f"{matched_any:>5,} / {n_geom:,}  ({matched_any / n_geom:5.1%})")
print(f"  zones with NO data (render as 'no data'):    "
      f"{n_geom - matched_any:>5,} / {n_geom:,}  "
      f"({(n_geom - matched_any) / n_geom:5.1%})")

# The reverse direction matters too: analysis rows with no 2019 geometry are
# rows that will never appear on the map.
geom_id_set = set(geometries)
for name, df in [("zat_pr312k_all", df_feat),
                 ("profile312k_all_covar_unscaled", df_covar),
                 ("zat_pop60plus_2018", df_pop60)]:
    orphans = sorted(set(df["ZAT"]) - geom_id_set)
    print(f"  {name:<34} {len(orphans):>4} rows with no {VINTAGE} geometry"
          + (f"  e.g. {orphans[:6]}" if orphans else ""))

# Cluster composition of what actually landed on the map
clus_counts = pd.Series([f["properties"]["clus"] for f in features]).value_counts(
    dropna=False).sort_index()
print("\nCluster composition of mapped zones:")
for c, n in clus_counts.items():
    label = "no data" if pd.isna(c) else (
        f"cluster {int(c)}" + ("  (model reference)" if int(c) == REFERENCE_CLUSTER else ""))
    print(f"  {label:<28} {n:>5,}")

# Crash totals actually represented on the map
mapped = pd.DataFrame([f["properties"] for f in features])
print("\nPedestrian crash counts on mapped zones (2015-2019, damage-only excluded):")
for col in ["injury", "death", "casualties"]:
    print(f"  {col:<11} {int(mapped[col].sum(skipna=True)):>8,}  "
          f"across {int(mapped[col].notna().sum()):,} zones")
excluded_damage = int(df_covar["damage"].sum())
print(f"  (excluded)  {excluded_damage:>8,}  damage-only crashes, "
      f"{int((df_covar['damage'] > 0).sum())} zones non-zero")

# ---------------------------------------------------------------------------
# 6. Write
# ---------------------------------------------------------------------------
geojson = {
    "type": "FeatureCollection",
    "metadata": {
        "name": "WalkSafe-AI Bogota ZAT profiles",
        "city": "bogota",
        "unit_type": "polygon",
        "unit_label": "ZAT (Zona de Analisis de Transporte)",
        "extent": (
            "Bogota D.C. Zones with no analysis data in any table lie outside "
            "the city, in the greater metropolitan area, and are not rendered."
        ),
        "description": (
            "Bogota D.C. transport analysis zones, 2019 vintage, joined to cluster "
            "profiles from a DINO/STRIDE extraction of 27 built-environment "
            "features over ~312,000 Google Street View prediction points, and "
            "to 2015-2019 crash counts."
        ),
        "caveat": (
            "ECOLOGICAL. These are area-level associations across Bogota D.C. "
            "ZAT zones, "
            "not individual risk. A zone's colour describes the zone, not the "
            "people in it."
        ),
        "taxonomy_note": (
            "The 27 features derive from the CANVAS pedestrian safety audit "
            "instrument, which also seeded the Gemini taxonomy in "
            "scoring/prompts.py. They are not independent instruments."
        ),
        "crash_window": "2015-2019",
        "exposure": {
            "field": "walk_pubt",
            "definition": "walking + public-transport trips per zone, 2019 Bogota mobility survey (Encuesta de Movilidad)",
            "rates": ["casualties_per_10k_trips", "injury_per_10k_trips", "death_per_10k_trips"],
            "note": "Outcome per 10,000 trips. This is the exposure offset used in "
                    "Zewdie et al. 2024 for the ZAT tree analysis; the per-km2 fields "
                    "remain as area densities and are not exposure-adjusted.",
        },
        "crash_outcomes": {
            "carried": ["injury", "death", "casualties"],
            "casualties_definition": "injury + death",
            "damage_excluded": True,
            "damage_note": (
                "Damage-only crashes are excluded. Nearly every pedestrian "
                f"struck by a motor vehicle is injured or killed, and the "
                f"source data agree: {excluded_damage} damage-only crashes "
                f"across all {len(df_covar)} zones with crash data. The source "
                "`total` column (injury + death + damage) is not carried; use "
                "`casualties`."
            ),
        },
        "geometry_vintage": VINTAGE,
        "coordinate_system": "EPSG:4326 (WGS84)",
        "coordinate_decimals": COORD_DECIMALS,
        "generated": datetime.now().isoformat(timespec="seconds"),
        "join": {
            "key": "id_zat -> ZAT",
            "zones_total": len(features),
            "zones_in_boundary_file": n_geom,
            "zones_outside_city_dropped": n_geom - len(features),
            "with_features": matched_feat,
            "with_covariates": matched_covar,
            "with_pop60": matched_pop,
            "with_any_data": matched_any,
            "with_no_data": n_geom - matched_any,   # all outside the city, dropped
        },
        "cluster_rr": {
            "primary_model": PRIMARY_MODEL,
            "secondary_model": SECONDARY_MODEL,
            "reference_cluster": REFERENCE_CLUSTER,
            "model_n": model_n,
            "model_labels": {
                PRIMARY_MODEL: "All ages (primary)",
                SECONDARY_MODEL: "Adjusted for 60+ population share",
            },
            "models": {
                m: {o: {c: rr_lookup[(m, o, c)] for c in model_clusters}
                    for o in CRASH_OUTCOMES}
                for m in [PRIMARY_MODEL, SECONDARY_MODEL]
            },
            "note": (
                "Reference is cluster 4: the dense arterial / mass-transit "
                "corridor profile, highest on every infrastructure count and "
                "highest crash burden. Clusters 1-3 are protective relative to "
                "it."
            ),
            "age_note": (
                "The Bogota models were fitted across all age groups. "
                f"'{PRIMARY_MODEL}' (n = {model_n[PRIMARY_MODEL]}) is that "
                f"primary result. '{SECONDARY_MODEL}' "
                f"(n = {model_n[SECONDARY_MODEL]}) additionally adjusts for the "
                "ZAT-level 60+ population share, and exists to support "
                "comparison with the Philadelphia older-adult focus. The 60+ "
                "share is a zone-level covariate, not an age-stratified "
                "outcome — these are not older-adult-specific risks. The two "
                "specifications are not interchangeable; do not mix estimates "
                "across them."
            ),
        },
        "canvas_features": CANVAS_FEATURES,
    },
    "features": features,
}

print(f"\nWriting {OUT.relative_to(REPO)} ...")
with open(OUT, "w") as f:
    json.dump(geojson, f, separators=(",", ":"))

size_mb = OUT.stat().st_size / 1_048_576
print(f"  Size: {size_mb:.2f} MB")

if size_mb > SIZE_TARGET_MB:
    # Fallback. Douglas-Peucker is applied per polygon, so shared boundaries
    # between adjacent zones can diverge and open slivers. Accepted only
    # because an oversized payload is the worse failure at this stage.
    tol = 0.00005
    while size_mb > SIZE_TARGET_MB and tol <= 0.0008:
        print(f"  Over {SIZE_TARGET_MB} MB — simplifying at tolerance {tol} "
              f"(~{tol * 111_000:.0f} m). Shared edges may diverge slightly.")
        for feat in features:
            g = shape(feat["geometry"]).buffer(0).simplify(tol, preserve_topology=True)
            if not g.is_empty:
                feat["geometry"] = quantise_geometry(mapping(g), COORD_DECIMALS) \
                    or feat["geometry"]
        with open(OUT, "w") as f:
            json.dump(geojson, f, separators=(",", ":"))
        size_mb = OUT.stat().st_size / 1_048_576
        print(f"  Size: {size_mb:.2f} MB")
        tol *= 2
    geojson["metadata"]["simplified_tolerance_deg"] = tol / 2
    with open(OUT, "w") as f:
        json.dump(geojson, f, separators=(",", ":"))
    size_mb = OUT.stat().st_size / 1_048_576

print(f"\nDone. {len(features):,} features, {size_mb:.2f} MB.")
