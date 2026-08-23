"""
16_tract_spf_equity.py
WALKSAFE-AI Philadelphia census-tract extension - Step 16

The third Philadelphia analysis unit, and the only one that carries the WHOLE
crash set.

Why this unit is different
--------------------------
The intersection layer (step 02) and the segment layer (step 12) PARTITION the
geocoded pedestrian KSI: INTERSECT_TYPE decides, so a crash lands in exactly
one of them and the two must never be summed. Neither renders all of it —
crashes that fail to snap to a node, or fall on an expressway, ramp or private
road, appear on neither map.

A tract contains a crash if the crash happened inside it. That is a partition
of SPACE, not of the crash set: every geocoded pedestrian KSI 2015-2024 lands
in exactly one tract, intersection-snapped and mid-block alike. This is the
only view of the complete count. It is still NOT summable with the other two
layers — it re-counts the same crashes under a different unit, so adding them
would triple-count.

Two modes, two questions, two denominators
------------------------------------------
1. RISK — where is it worst. Negative binomial + empirical Bayes, the same
   specification family as the segment SPF in step 14: log(exposure) as a fixed
   offset, road class carrying the hierarchy, the AADT slope identified only
   where the count is genuine.

   The offset is WALKABLE ROAD MILES, not residents. Crashes per resident ranks
   Center City catastrophically high — few residents, enormous pedestrian
   volume — which is the exposure confounding documented throughout this repo,
   not a finding. A residential rate IS computed, because it is what an equity
   reader reaches for, but it is labelled as confounded and is not the primary
   measure. Population enters as a COVARIATE, exactly as in step 14.

2. EQUITY — where to act first. Observed burden against ACS characteristics.
   Ecological and descriptive only: no model, no adjustment, no causal claim.
   It shares no denominator with the risk model, and the ACS variables are
   deliberately kept OUT of the SPF — conditioning risk on poverty would
   adjust away the very contrast the equity mode exists to show.

The empirical Bayes weight is the finding
-----------------------------------------
At the segment, 1.5% of units carry a KSI and the EB estimate is essentially
the model everywhere (median w 0.99, crash-weighted 0.835). Nearly every tract
carries at least one. The weight distribution is printed against both other
units, because the contrast is the argument for the unit.

The boundary problem
--------------------
Step 11 documents that Philadelphia arterials are often block-group borders.
Tracts are built from block groups, so the same is true here: a dangerous
arterial's crashes split between the two tracts it divides, halving the
apparent burden on both. The share of KSI falling within 50 m of a tract
boundary is measured, not assumed, and reported at 25/50/100 m.

Inputs
  work/ped_crashes.parquet          step 01 - all ped crashes with coords
  work/segment_analysis.csv         step 13 - road network with midpoints
  work/intersections_analysis.csv   step 03 - nodes with coords
  work/tiger/tl_2020_42_tract.zip   TIGER/Line 2020 tracts (auto-fetched)
  api.census.gov ACS 5-year profile (auto-fetched, cached; needs a key)

Outputs
  work/tract_ranked.csv
  work/acs_tracts_<year>.json       cached raw ACS pull
  outputs/qc_logs/qc_tract_spf.txt
"""
import json
import os
import urllib.request
import urllib.error
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import statsmodels.api as sm
from shapely.geometry import Point

from config import CRS, GIS, M2FT, WORK, QCLog, REPO, require

L = QCLog("tract_spf")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: TIGER/Line vintage. 2020 tract boundaries — the geography ACS has published
#: against since the 2021 5-year release.
TIGER_YEAR = 2020
TIGER_URL = (f"https://www2.census.gov/geo/tiger/TIGER{TIGER_YEAR}/TRACT/"
             f"tl_{TIGER_YEAR}_42_tract.zip")
TIGER_ZIP = WORK / "tiger" / f"tl_{TIGER_YEAR}_42_tract.zip"

#: ACS 5-year vintage. 2024 = the 2020-2024 sample, the most recent release and
#: the one whose end year matches the crash window's. It does NOT match the
#: window's midpoint — the crashes run 2015-2024 — and that mismatch is carried
#: into the layer caveat rather than smoothed over.
ACS_YEAR = 2024
STATE_FIPS, COUNTY_FIPS = "42", "101"

#: Distances at which the boundary-splitting problem is measured.
BOUNDARY_BUFFERS_M = (25, 50, 100)

#: Dispersion grid, as in step 14. A boundary optimum is a grid artifact.
ALPHA_GRID = np.geomspace(0.01, 20, 80)

#: Tracts below this are not analysed. Philadelphia has tracts that are almost
#: entirely park, river or airport, with no walkable network and no residents;
#: log(0) would poison the fit and a "risk" colour there would be meaningless.
MIN_ROAD_MI = 0.10

#: A crash this far outside the county's tract coverage is still a Philadelphia
#: crash whose coordinate landed across the line. Nine geocoded pedestrian KSI
#: sit 0-5.2 m outside — on City Avenue, the Cobbs Creek boundary and the
#: Delaware waterfront, all of which ARE the county line. Dropping them would
#: lose the layer's claim to the complete crash set over a rounding error, so
#: they are snapped to the nearest tract. The tolerance matches the repo's
#: existing SNAP_BUFFER_M convention. This is the boundary problem measured
#: below, one geography up.
COUNTY_EDGE_SNAP_M = 25

#: Census "jam values" — negative sentinels meaning not-applicable, not a
#: number. Any value at or below the least negative of them is missing.
JAM_THRESHOLD = -111111110

#: ACS fields. Estimate, margin of error, and the label the dashboard prints.
#: Variable NUMBERS shift between ACS vintages, so each was resolved against
#: the vintage's own variables.json by label before being written here, and
#: the county-level totals were checked against published Philadelphia figures
#: (pop 1,579,706; median HH income $61,953; 21.4% in poverty; 27.9% of
#: households with no vehicle; 14.7% aged 65+).
ACS_FIELDS = [
    ("pop",            "DP05_0001E",  "DP05_0001M",  "Total population"),
    ("pct_pov",        "DP03_0128PE", "DP03_0128PM", "Below the poverty level"),
    ("med_hh_income",  "DP03_0062E",  "DP03_0062M",  "Median household income"),
    ("pct_no_vehicle", "DP04_0058PE", "DP04_0058PM", "Households with no vehicle"),
    ("pct_65plus",     "DP05_0024PE", "DP05_0024PM", "Aged 65 and over"),
    ("pct_under18",    "DP05_0019PE", "DP05_0019PM", "Under 18"),
    ("pct_hispanic",   "DP05_0090PE", "DP05_0090PM", "Hispanic or Latino, any race"),
    ("pct_nh_white",   "DP05_0096PE", "DP05_0096PM", "Non-Hispanic White alone"),
    ("pct_nh_black",   "DP05_0097PE", "DP05_0097PM", "Non-Hispanic Black alone"),
]

#: The equity variables, in the order the dashboard shows them.
EQUITY_VARS = ["pct_pov", "med_hh_income", "pct_no_vehicle",
               "pct_65plus", "pct_under18", "pct_hispanic",
               "pct_nh_white", "pct_nh_black"]

#: ACS margins of error are published at 90% confidence.
MOE_Z = 1.645

#: Coefficient-of-variation thresholds, per Census guidance on reliability.
CV_CAUTION, CV_UNRELIABLE = 15.0, 30.0


# ---------------------------------------------------------------------------
# Census API
# ---------------------------------------------------------------------------

def census_key() -> str:
    """The API key, from the environment or the repo-root .env.

    api.census.gov has required a key since the sandbox note in step 11 was
    written; that step worked around the block by pulling from Esri Living
    Atlas in a browser session. The key route works here, so this step uses it
    directly. The key is NEVER written to any output — only the fact that one
    was used.
    """
    k = os.getenv("CENSUS_API_KEY")
    if k:
        return k.strip()
    env = REPO / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("CENSUS_API_KEY="):
                return line.split("=", 1)[1].strip()
    raise SystemExit(
        "\nNo CENSUS_API_KEY.\n\n"
        "api.census.gov now requires one. Request a free key at\n"
        "  https://api.census.gov/data/key_signup.html\n"
        "then put it in the repo-root .env (which is gitignored):\n"
        "  CENSUS_API_KEY=your-key-here\n"
    )


def fetch_acs() -> pd.DataFrame:
    """ACS 5-year profile estimates AND margins of error, by tract.

    Cached: the pull is deterministic for a fixed vintage, and re-running the
    model should not depend on the Census API being up.

    Percentages come from the PROFILE tables rather than being derived from
    counts here. The Census publishes the MOE of the proportion itself; deriving
    one by propagating count MOEs in quadrature assumes an independence that
    does not hold between a numerator and the denominator containing it.
    """
    cache = WORK / f"acs_tracts_{ACS_YEAR}.json"
    if cache.exists():
        L(f"ACS {ACS_YEAR} 5-year: cached ({cache.name})")
        return pd.DataFrame(json.loads(cache.read_text()))

    cols = [c for _, e, m, _ in ACS_FIELDS for c in (e, m)]
    url = (f"https://api.census.gov/data/{ACS_YEAR}/acs/acs5/profile"
           f"?get=NAME,{','.join(cols)}"
           f"&for=tract:*&in=state:{STATE_FIPS}+county:{COUNTY_FIPS}"
           f"&key={census_key()}")
    L(f"ACS {ACS_YEAR} 5-year: fetching {len(cols)} variables from api.census.gov")
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            raw = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise SystemExit(
            f"\nCensus API returned HTTP {e.code}.\n"
            "A 403 usually means the key is missing, malformed or not yet "
            "activated — check the activation email.\n"
        )

    head, rows = raw[0], raw[1:]
    df = pd.DataFrame(rows, columns=head)
    df["GEOID"] = df.state + df.county + df.tract
    keep = ["GEOID", "NAME"] + cols
    out = df[keep]
    cache.write_text(json.dumps(out.to_dict("records")))
    L(f"  {len(out)} tracts cached to {cache.name}")
    return out


def clean_acs(raw: pd.DataFrame) -> pd.DataFrame:
    """Jam values to NaN, then a coefficient of variation for every estimate.

    A tract-level ACS estimate can have a margin of error as wide as the
    estimate itself. Census Tract 2 reports a median household income of
    $102,670 with an MOE of $50,798 — a 90% interval from $52k to $153k, which
    spans most of the city's distribution. Shipping that as a point estimate
    would be a straightforward misrepresentation, so the CV travels with every
    value and the dashboard renders the interval.
    """
    out = pd.DataFrame({"GEOID": raw.GEOID})
    for name, ecol, mcol, _label in ACS_FIELDS:
        est = pd.to_numeric(raw[ecol], errors="coerce")
        moe = pd.to_numeric(raw[mcol], errors="coerce")
        est = est.where(est > JAM_THRESHOLD)
        moe = moe.where(moe > JAM_THRESHOLD)
        # A published MOE of 0 is real for a controlled total, but it makes the
        # CV zero and reads as infinite precision. Kept as-is; the CV is only
        # meaningful where the estimate is non-zero anyway.
        with np.errstate(divide="ignore", invalid="ignore"):
            cv = np.where((est.notna()) & (est != 0) & (moe.notna()),
                          (moe / MOE_Z) / est.abs() * 100, np.nan)
        out[name] = est
        out[f"{name}_moe"] = moe
        out[f"{name}_cv"] = np.round(cv, 1)
    return out


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------

def load_tracts() -> gpd.GeoDataFrame:
    if not TIGER_ZIP.exists():
        TIGER_ZIP.parent.mkdir(parents=True, exist_ok=True)
        L(f"Fetching TIGER {TIGER_YEAR} tracts ...")
        urllib.request.urlretrieve(TIGER_URL, TIGER_ZIP)
    g = gpd.read_file(TIGER_ZIP)
    g = g[g.COUNTYFP == COUNTY_FIPS].copy()
    g = g.to_crs(CRS)
    g["tract_id"] = g.GEOID.astype("int64")
    # ALAND/AWATER are in square metres regardless of the working CRS.
    g["land_km2"] = g.ALAND / 1e6
    g["water_km2"] = g.AWATER / 1e6
    g["tract_name"] = g.NAMELSAD.str.replace("Census Tract ", "Tract ", regex=False)
    return g[["tract_id", "GEOID", "tract_name", "land_km2", "water_km2",
              "geometry"]].reset_index(drop=True)


L("=" * 78)
L("CENSUS TRACT LAYER — the only Philadelphia view carrying the whole crash set")
L("=" * 78)

tracts = load_tracts()
L(f"\nTIGER {TIGER_YEAR} tracts, Philadelphia County: {len(tracts)}")
L(f"  land {tracts.land_km2.sum():.1f} km2, water {tracts.water_km2.sum():.1f} km2")


# ---------------------------------------------------------------------------
# Crashes — every geocoded pedestrian KSI, by containment
# ---------------------------------------------------------------------------
ped = pd.read_parquet(WORK / "ped_crashes.parquet")
ksi = ped[ped.ped_ksi_final].copy()
geo = ksi[ksi.coord_ok].copy()

L(f"\nPedestrian KSI 2015-2024: {len(ksi):,}")
L(f"  geocoded (usable coordinates): {len(geo):,}")
L(f"  no usable coordinate, on NO layer: {len(ksi) - len(geo):,}")

pts = gpd.GeoDataFrame(
    geo, geometry=[Point(xy) for xy in zip(geo.lon, geo.lat)], crs=4326
).to_crs(CRS)

pts = gpd.sjoin(pts, tracts[["tract_id", "geometry"]],
                how="left", predicate="within").drop(columns="index_right")

contained = int(pts.tract_id.notna().sum())
L(f"  inside a tract polygon: {contained:,}")

# Snap the county-edge strays. See COUNTY_EDGE_SNAP_M.
stray = pts.tract_id.isna()
if stray.any():
    # sjoin_nearest emits one row per tie, so a point equidistant from two
    # tracts comes back twice. Deduplicate on the ORIGINAL index before
    # assigning, or the lengths do not line up.
    near = gpd.sjoin_nearest(
        pts[stray].drop(columns="tract_id"),
        tracts[["tract_id", "geometry"]],
        how="left", max_distance=COUNTY_EDGE_SNAP_M * M2FT,
        distance_col="edge_ft",
    ).drop(columns="index_right")
    near = near[~near.index.duplicated(keep="first")]
    pts.loc[near.index, "tract_id"] = near.tract_id
    snapped = int(near.tract_id.notna().sum())
    L(f"  outside every tract, within {COUNTY_EDGE_SNAP_M} m of one: {snapped} "
      f"(max {near.edge_ft.max() / M2FT:.1f} m) — snapped to the nearest")
    L("    These sit ON the county line: City Avenue, the Cobbs Creek "
      "boundary, the Delaware waterfront.")

lost = int(pts.tract_id.isna().sum())
L(f"  on NO tract: {lost}")
L(f"  assigned: {int(pts.tract_id.notna().sum()):,}")

# All pedestrian crashes, for context alongside KSI.
anyped = ped[ped.ped_any & ped.coord_ok].copy()
apts = gpd.GeoDataFrame(
    anyped, geometry=[Point(xy) for xy in zip(anyped.lon, anyped.lat)], crs=4326
).to_crs(CRS)
apts = gpd.sjoin(apts, tracts[["tract_id", "geometry"]],
                 how="left", predicate="within").drop(columns="index_right")

counts = pts.groupby("tract_id").agg(
    ped_ksi_tract=("CRN", "size"),
    ped_deaths_tract=("PED_DEATH_COUNT", "sum"),
).reset_index()
counts_any = apts.groupby("tract_id").size().rename("ped_any_tract").reset_index()

# The intersection/mid-block split WITHIN the tract. Not a partition of the
# tract layer — both are counted here — but it is what makes the relationship
# to the other two layers legible in the panel.
pts["is_midblock"] = pd.to_numeric(pts.INTERSECT_TYPE, errors="coerce").fillna(0) == 0
split = pts.groupby("tract_id").is_midblock.agg(
    ksi_midblock="sum", n="size").reset_index()
split["ksi_intersection"] = split.n - split.ksi_midblock
split = split[["tract_id", "ksi_midblock", "ksi_intersection"]]


# ---------------------------------------------------------------------------
# The boundary problem, measured
# ---------------------------------------------------------------------------
L("\n" + "-" * 78)
L("BOUNDARY SPLITTING")
L("-" * 78)
L("Tracts are built from block groups, and step 11 documents that Philadelphia")
L("arterials are often block-group borders. Where an arterial IS the boundary,")
L("its crashes divide between the two tracts it separates and the burden on")
L("each reads as roughly half the corridor's.")

placed = pts[pts.tract_id.notna()].copy()
tract_bounds = tracts.set_index("tract_id").geometry.boundary
placed["dist_bound_ft"] = [
    tract_bounds[t].distance(g) for t, g in zip(placed.tract_id, placed.geometry)
]
placed["dist_bound_m"] = placed.dist_bound_ft / M2FT

L("")
for b in BOUNDARY_BUFFERS_M:
    n = int((placed.dist_bound_m <= b).sum())
    L(f"  KSI within {b:>3} m of a tract boundary: {n:>4} of {len(placed):,} "
      f"({n / len(placed) * 100:.1f}%)")
share50 = float((placed.dist_bound_m <= 50).mean())
L(f"\n  Median distance to the nearest tract boundary: "
  f"{placed.dist_bound_m.median():.0f} m")
L(f"  MATERIAL: {share50 * 100:.0f}% of pedestrian KSI fall within 50 m of a "
  "boundary." if share50 >= 0.20 else
  f"  Modest: {share50 * 100:.0f}% of pedestrian KSI fall within 50 m.")
L("  This is a property of the zoning scheme, not of the crashes. It biases")
L("  boundary corridors DOWNWARD on both sides and is the concrete form the")
L("  modifiable areal unit problem takes on this layer.")


# ---------------------------------------------------------------------------
# Network exposure and covariates, aggregated from the segment table
# ---------------------------------------------------------------------------
L("\n" + "-" * 78)
L("EXPOSURE AND COVARIATES")
L("-" * 78)

seg = pd.read_csv(WORK / "segment_analysis.csv")
sg = gpd.GeoDataFrame(
    seg, geometry=[Point(xy) for xy in zip(seg.mid_lon, seg.mid_lat)], crs=4326
).to_crs(CRS)
sg = gpd.sjoin(sg, tracts[["tract_id", "geometry"]],
               how="left", predicate="within").drop(columns="index_right")
L(f"Walkable segments assigned to a tract by midpoint: "
  f"{int(sg.tract_id.notna().sum()):,} of {len(sg):,}")
L("  A segment straddling a boundary is credited to the tract holding its")
L("  midpoint. The same approximation as the crash assignment, one unit up.")

sg["arterial_mi"] = np.where(sg.CLASS.isin([2, 3]), sg.length_mi, 0.0)
sg["aadt_real_mi"] = np.where(sg.aadt_real.astype(bool), sg.length_mi, 0.0)
sg["aadt_x_mi"] = np.where(sg.aadt_real.astype(bool),
                           sg.aadt * sg.length_mi, 0.0)

cov = sg.groupby("tract_id").agg(
    road_mi=("length_mi", "sum"),
    arterial_mi=("arterial_mi", "sum"),
    aadt_real_mi=("aadt_real_mi", "sum"),
    aadt_x_mi=("aadt_x_mi", "sum"),
    n_segments=("SEG_ID", "size"),
    hin_frac=("hin_frac", "mean"),
).reset_index()

# Length-weighted mean AADT over the segments where the count is genuine.
cov["aadt_mean_real"] = np.where(cov.aadt_real_mi > 0,
                                 cov.aadt_x_mi / cov.aadt_real_mi, np.nan)
cov["pct_arterial"] = np.where(cov.road_mi > 0,
                               cov.arterial_mi / cov.road_mi * 100, np.nan)

def count_in_tracts(path: Path, label: str) -> pd.Series:
    """Facilities whose location falls inside each tract.

    The segment model's `schools_200m` is a count near THAT segment, which is a
    genuinely local measure. Aggregating it to a tract by max or sum measures
    nothing: it would be the busiest segment's neighbourhood, or every school
    counted once per nearby block. At this unit the analogue is the count
    inside the tract, so the facility layers are read directly.
    """
    g = gpd.read_file(require(path, f"{label} layer")).to_crs(CRS)
    # Point layers stay as they are; polygon layers reduce to a representative
    # interior point so a facility spanning a boundary is counted once.
    g["geometry"] = np.where(g.geom_type == "Point", g.geometry,
                             g.representative_point())
    j = gpd.sjoin(gpd.GeoDataFrame(geometry=g.geometry, crs=CRS),
                  tracts[["tract_id", "geometry"]],
                  how="inner", predicate="within")
    s = j.groupby("tract_id").size()
    L(f"  {label}: {len(g):,} features, {int(s.sum()):,} inside a tract, "
      f"across {len(s)} tracts")
    return s


L("")
schools = count_in_tracts(GIS / "PhiladelphiaSchool_Facilities2016", "schools")
parks = count_in_tracts(GIS / "PPR_Playgrounds", "playgrounds")

nodes = pd.read_csv(WORK / "intersections_analysis.csv")
ng = gpd.GeoDataFrame(
    nodes, geometry=gpd.points_from_xy(nodes.x_2272, nodes.y_2272), crs=CRS
)
ng = gpd.sjoin(ng, tracts[["tract_id", "geometry"]],
               how="left", predicate="within").drop(columns="index_right")
nodecount = ng.groupby("tract_id").size().rename("n_nodes").reset_index()


# ---------------------------------------------------------------------------
# Assemble
# ---------------------------------------------------------------------------
acs = clean_acs(fetch_acs())
acs["tract_id"] = acs.GEOID.astype("int64")

df = (tracts.drop(columns="geometry")
      .merge(counts, on="tract_id", how="left")
      .merge(counts_any, on="tract_id", how="left")
      .merge(split, on="tract_id", how="left")
      .merge(cov, on="tract_id", how="left")
      .merge(nodecount, on="tract_id", how="left")
      .merge(schools.rename("schools").reset_index(), on="tract_id", how="left")
      .merge(parks.rename("parks").reset_index(), on="tract_id", how="left")
      .merge(acs.drop(columns="GEOID"), on="tract_id", how="left"))

for c in ["ped_ksi_tract", "ped_deaths_tract", "ped_any_tract",
          "ksi_midblock", "ksi_intersection", "road_mi", "arterial_mi",
          "aadt_real_mi", "n_segments", "n_nodes", "schools", "parks"]:
    df[c] = df[c].fillna(0)
df["hin_frac"] = df.hin_frac.fillna(0)

L(f"\nAssembled {len(df)} tracts")
L(f"  KSI on the layer: {int(df.ped_ksi_tract.sum()):,}")
L(f"  tracts with >=1 KSI: {int((df.ped_ksi_tract > 0).sum()):,} "
  f"({(df.ped_ksi_tract > 0).mean() * 100:.1f}%)")
L(f"  tracts with no ACS population: {int(df['pop'].isna().sum())}")
L(f"  walkable network: {df.road_mi.sum():,.0f} mi across "
  f"{int(df.n_segments.sum()):,} segments")


# ---------------------------------------------------------------------------
# ACS reliability
# ---------------------------------------------------------------------------
L("\n" + "-" * 78)
L("ACS MARGINS OF ERROR")
L("-" * 78)
L(f"ACS {ACS_YEAR} 5-year ({ACS_YEAR - 4}-{ACS_YEAR}), tract level, 90% MOE.")
L("A tract is a small sample. The CV below is (MOE/1.645)/estimate; Census")
L("guidance treats CV > 30% as unreliable and 15-30% as use-with-caution.")
L("")
L(f"{'variable':<18}{'median est':>12}{'median MOE':>12}{'median CV%':>11}"
  f"{'CV>30%':>9}{'missing':>9}")
for v in EQUITY_VARS:
    est, moe, cv = df[v], df[f"{v}_moe"], df[f"{v}_cv"]
    bad = int((cv > CV_UNRELIABLE).sum())
    L(f"{v:<18}{est.median():>12,.1f}{moe.median():>12,.1f}"
      f"{np.nanmedian(cv):>11.1f}{bad:>9}{int(est.isna().sum()):>9}")
L("")
L("The dashboard renders the 90% interval beside every one of these, and marks")
L("the unreliable ones. A tract median household income of $102,670 with an")
L("MOE of $50,798 is not a number to rank tracts on, and the layer says so.")


# ---------------------------------------------------------------------------
# Risk model — NB2 with a network-exposure offset, then empirical Bayes
# ---------------------------------------------------------------------------
L("\n" + "=" * 78)
L("RISK MODEL")
L("=" * 78)


def fit_nb(y, X, offset, label):
    """NB2 with a fixed offset, dispersion profiled over a grid. As step 14."""
    best = None
    for i, a in enumerate(ALPHA_GRID):
        m = sm.GLM(y, X, family=sm.families.NegativeBinomial(alpha=a),
                   offset=offset).fit()
        if best is None or m.llf > best[0]:
            best = (m.llf, a, m, i)
    llf, alpha, model, idx = best
    if idx in (0, len(ALPHA_GRID) - 1):
        L(f"  WARNING [{label}]: alpha hit the grid boundary at {alpha:.3f} — "
          "widen ALPHA_GRID; the dispersion estimate is not identified.")
    null = sm.GLM(y, np.ones((len(y), 1)),
                  family=sm.families.NegativeBinomial(alpha=alpha),
                  offset=offset).fit()
    mu = model.predict(X, offset=offset)
    assert np.allclose(mu, model.fittedvalues), "offset dropped from predict()"
    L(f"\n[{label}] NB2, offset = log(road_mi)")
    L(f"  n = {len(y):,}   observed KSI = {int(y.sum()):,}")
    L(f"  alpha = {alpha:.4f}  (k = {1 / alpha:.4f})   llf = {llf:.1f}")
    L(f"  McFadden pseudo-R2 vs offset-only intercept = {1 - llf / null.llf:.4f}")
    L(model.summary2().tables[1].round(4).to_string())
    return model, alpha, 1.0 / alpha, mu


# Zero-population tracts STAY IN.
#
# Philadelphia has 17 of them — Fairmount Park, the Navy Yard, the airport,
# the river tracts — and between them they carry 69 pedestrian KSI over 121
# road miles. Excluding them would drop 4.6% of the crash set from the model
# on the grounds that nobody sleeps there, which is the per-capita fallacy
# this step exists to avoid. Population is a covariate with a floor
# (log(pop) clipped at 50, as step 14 clips pop_800m at 100), so a resident
# count of zero costs nothing.
#
# What IS excluded is a unit the model cannot speak about at all: no walkable
# network, or no genuine AADT count anywhere inside it. Exactly one tract
# meets that — 9809.02, 0.13 mi of a single street stub with no residents and
# no crashes. It was also the tract that made the AADT indicator perfectly
# identify one zero-crash unit and sent the fit into separation.
fit_mask = (df.road_mi >= MIN_ROAD_MI) & df.aadt_mean_real.notna()
L(f"\nTracts excluded from the fit: {int((~fit_mask).sum())}")
L(f"  Zero-population tracts KEPT in the fit: "
  f"{int((fit_mask & (df['pop'] == 0)).sum())}, carrying "
  f"{int(df.loc[fit_mask & (df['pop'] == 0), 'ped_ksi_tract'].sum())} KSI "
  "(parks, the Navy Yard, the airport, the river tracts)")
if (~fit_mask).any():
    for _, r in df[~fit_mask].iterrows():
        L(f"    {r.tract_name:<14} road {r.road_mi:5.2f} mi  "
          f"pop {'n/a' if pd.isna(r['pop']) else int(r['pop']):>6}  "
          f"KSI {int(r.ped_ksi_tract)}")
    L(f"  KSI on excluded tracts: "
      f"{int(df.loc[~fit_mask, 'ped_ksi_tract'].sum())} "
      "(retained in the counts; only the model skips these units)")

d = df[fit_mask].copy()
off = np.log(d.road_mi.clip(lower=MIN_ROAD_MI).to_numpy(float))
y = d.ped_ksi_tract.astype(float)


def design(t):
    """Design matrix, mirroring step 14's segment specification.

    Population is a COVARIATE, never the offset — see the module docstring.
    The AADT slope is identified only from the road miles where the count is
    genuine, because PennDOT's nominal 300 veh/day would otherwise carry it.
    No ACS equity variable appears here: adjusting risk for poverty would
    remove the contrast the equity mode exists to describe.
    """
    X = pd.DataFrame(index=t.index)
    X["log_pop"] = np.log(t["pop"].clip(lower=50))
    X["pct_arterial"] = t.pct_arterial.fillna(0) / 100
    X["node_density"] = t.n_nodes / t.road_mi.clip(lower=MIN_ROAD_MI)
    X["schools"] = t.schools
    X["parks"] = t.parks

    # AADT, as in step 14: an indicator for having a genuine count plus a
    # centred slope that is zero where there is none, so the elasticity is
    # identified only where the number means something.
    #
    # At the segment that indicator varies — two thirds of segments carry
    # PennDOT's nominal 300. At the TRACT it does not: a tract contains dozens
    # of segments and essentially every one of them has at least one with a
    # real count, so the indicator is 1 everywhere. Left in, it is collinear
    # with the constant and the fit separates — the first run returned
    # const -17.93 and aadt_real +16.65, both with a standard error of 16,328.
    # It is dropped when it does not vary, which is the honest form of the
    # same specification at this unit.
    real = t.aadt_mean_real.notna()
    if 0 < int(real.sum()) < len(t):
        X["aadt_real"] = real.astype(float)
    lg = np.log(t.aadt_mean_real.where(real).clip(lower=1))
    X["log_aadt_real"] = np.where(real, lg - lg[real].mean(), 0.0)
    return sm.add_constant(X.astype(float))


model, alpha, k, mu = fit_nb(y, design(d), off, "tract / primary")
d["mu_spf"] = mu
w = k / (k + mu)
d["eb_weight"] = w
d["eb_ksi_tract"] = w * mu + (1 - w) * y
d["excess_ksi"] = y - mu
d["ksi_per_road_mi"] = y / d.road_mi
d["mu_per_road_mi"] = mu / d.road_mi
d["eb_per_road_mi"] = d.eb_ksi_tract / d.road_mi

# The residential rate, computed and labelled. See the module docstring: this
# is what an equity reader reaches for, and it is confounded by exactly the
# mechanism this repo documents everywhere else.
d["ksi_per_10k_pop"] = np.where(d["pop"] > 0,
                                y / d["pop"] * 10_000, np.nan)


# ---------------------------------------------------------------------------
# The empirical Bayes weight — the argument for this unit
# ---------------------------------------------------------------------------
L("\n" + "=" * 78)
L("EMPIRICAL BAYES WEIGHT — how much of the estimate is observed data")
L("=" * 78)
hit = d[d.ped_ksi_tract > 0]
w_all = float(np.median(d.eb_weight))
w_hit = float(np.median(hit.eb_weight))
w_cw = float(np.average(d.eb_weight, weights=d.ped_ksi_tract))

L(f"{'unit':<26}{'n':>8}{'median w':>10}{'w | KSI>0':>11}{'crash-wtd w':>13}"
  f"{'obs. where':>12}")
L(f"{'':<26}{'':>8}{'(all)':>10}{'':>11}{'':>13}{'crashes are':>12}")
L(f"{'census tract':<26}{len(d):>8,}{w_all:>10.3f}{w_hit:>11.3f}{w_cw:>13.3f}"
  f"{(1 - w_cw) * 100:>11.1f}%")
L(f"{'street segment (step 14)':<26}{29418:>8,}{0.990:>10.3f}{0.916:>11.3f}"
  f"{0.835:>13.3f}{16.5:>11.1f}%")
L(f"{'intersection (step 04)':<26}{16984:>8,}{0.990:>10.3f}{'':>11}{'':>13}{'':>12}")
L("=" * 78)
L(f"{(d.ped_ksi_tract > 0).mean() * 100:.1f}% of tracts carry at least one "
  f"pedestrian KSI, against 1.5% of segments.")
L(f"So the tract EB estimate is {(1 - w_cw) * 100:.0f}% observed data where the")
L("crashes are, against 16.5% at the segment and essentially none at the")
L("intersection. At this unit empirical Bayes is doing something other than")
L("restating the covariates — which is the case for the unit, and the reason")
L("the EB estimate rather than the SPF expectation is what gets mapped.")


# ---------------------------------------------------------------------------
# Tiers and ranks
# ---------------------------------------------------------------------------
q = d.eb_per_road_mi.quantile([.75, .95, .99])
d["tract_risk_tier"] = np.select(
    [d.eb_per_road_mi >= q[.99], d.eb_per_road_mi >= q[.95],
     d.eb_per_road_mi >= q[.75]],
    ["Critical", "High", "Moderate"], default="Low")
d["rank_eb"] = d.eb_per_road_mi.rank(method="min", ascending=False).astype(int)
d["rank_raw"] = d.ped_ksi_tract.rank(method="min", ascending=False).astype(int)
d["rank_excess"] = d.excess_ksi.rank(method="min", ascending=False).astype(int)

L("\nRisk tiers (quantiles of the EB estimate per road mile — this layer's OWN")
L("cut-points, not the intersection or segment thresholds):")
L(f"  {d.tract_risk_tier.value_counts().reindex(['Critical','High','Moderate','Low']).to_dict()}")
L(f"  eb_per_road_mi cut-points: p75 {q[.75]:.3f}  p95 {q[.95]:.3f}  "
  f"p99 {q[.99]:.3f}")

L("\nTop 15 tracts by observed pedestrian KSI:")
for _, r in d.sort_values("ped_ksi_tract", ascending=False).head(15).iterrows():
    L(f"   {r.tract_name:<14} KSI {int(r.ped_ksi_tract):>3}  "
      f"({int(r.ksi_intersection)} int / {int(r.ksi_midblock)} mid)  "
      f"{r.road_mi:>5.1f} mi  exp {r.mu_spf:>5.1f}  "
      f"excess {r.excess_ksi:>+5.1f}  EB {r.eb_ksi_tract:>5.1f} "
      f"(w {r.eb_weight:.2f})")

# The Center City artefact, demonstrated rather than asserted.
L("\nTop 10 tracts by KSI per 10,000 RESIDENTS — the confounded denominator:")
for _, r in d[d["pop"] > 100].sort_values(
        "ksi_per_10k_pop", ascending=False).head(10).iterrows():
    L(f"   {r.tract_name:<14} {r.ksi_per_10k_pop:>7.1f} per 10k  "
      f"KSI {int(r.ped_ksi_tract):>3}  pop {int(r['pop']):>6}  "
      f"rank by EB/mi #{int(r.rank_eb)}")
L("  These are the low-residential, high-footfall tracts. A per-capita rate")
L("  measures how few people SLEEP there, not how dangerous it is to walk")
L("  there. It ships as a property and is named in the legend; it is not the")
L("  primary measure and nothing is ranked on it.")


# ---------------------------------------------------------------------------
# Equity — descriptive, ecological, no model
# ---------------------------------------------------------------------------
L("\n" + "=" * 78)
L("EQUITY — observed burden against ACS characteristics")
L("=" * 78)
L("Descriptive only. These are AREA-LEVEL associations between a tract's")
L("composition and its crash burden. They are not individual risk, they are")
L("not adjusted for exposure, and nothing here supports a causal reading.")
L("Rates use ROAD MILES, the same denominator as the risk model, so the two")
L("modes remain readable side by side without sharing a model.")

for v in EQUITY_VARS:
    sub = d[d[v].notna()].copy()
    if len(sub) < 30:
        L(f"\n{v}: too few tracts with an estimate ({len(sub)}) — skipped")
        continue
    sub["tertile"] = pd.qcut(sub[v], 3, labels=["low", "mid", "high"],
                             duplicates="drop")
    g = sub.groupby("tertile", observed=True).agg(
        n=("tract_id", "size"),
        ksi=("ped_ksi_tract", "sum"),
        road_mi=("road_mi", "sum"),
        pop=("pop", "sum"),
    )
    g["ksi_per_mi"] = g.ksi / g.road_mi
    g["ksi_per_10k"] = g.ksi / g["pop"] * 10_000
    lo, hi = g.ksi_per_mi.iloc[0], g.ksi_per_mi.iloc[-1]
    L(f"\n{v} — tertiles of the tract value")
    L(f"  {'tertile':<8}{'n':>5}{'KSI':>7}{'road mi':>10}"
      f"{'KSI/mi':>9}{'KSI/10k pop':>13}")
    for t, r in g.iterrows():
        L(f"  {str(t):<8}{int(r.n):>5}{int(r.ksi):>7}{r.road_mi:>10.0f}"
          f"{r.ksi_per_mi:>9.3f}{r.ksi_per_10k:>13.1f}")
    if lo > 0:
        L(f"  high/low ratio on KSI per road mile: {hi / lo:.2f}")


# ---------------------------------------------------------------------------
out = df.merge(
    d[["tract_id", "mu_spf", "eb_ksi_tract", "eb_weight", "excess_ksi",
       "ksi_per_road_mi", "mu_per_road_mi", "eb_per_road_mi",
       "ksi_per_10k_pop", "tract_risk_tier", "rank_eb", "rank_raw",
       "rank_excess"]],
    on="tract_id", how="left")
out["in_model"] = out.tract_id.isin(d.tract_id)

# Boundary proximity, carried per tract at each reported distance: the share of
# each tract's OWN crashes that sit near its edge, so a tract whose burden is a
# boundary artefact can be identified in the panel rather than only in
# aggregate. All three buffers ship so the GeoJSON build can recompute the
# citywide shares from the data instead of restating numbers from this log.
for b in BOUNDARY_BUFFERS_M:
    col = "near_bound_ksi" if b == 50 else f"near_bound_ksi_{b}"
    s = (placed.assign(near=placed.dist_bound_m <= b)
         .groupby("tract_id").near.sum().rename(col).reset_index())
    out = out.merge(s, on="tract_id", how="left")
    out[col] = out[col].fillna(0).astype(int)

out.to_csv(WORK / "tract_ranked.csv", index=False)
L(f"\nSaved work/tract_ranked.csv ({len(out):,} tracts)")

L("\n" + "=" * 78)
L("CRASH ACCOUNTING ACROSS THE THREE PHILADELPHIA LAYERS")
L("=" * 78)
L(f"  pedestrian KSI 2015-2024, all             {len(ksi):>6,}")
L(f"  geocoded                                  {len(geo):>6,}")
L(f"  on the TRACT layer                        {int(df.ped_ksi_tract.sum()):>6,}")
L(f"  on the INTERSECTION layer (rendered)      {728:>6,}")
L(f"  on the SEGMENT layer (rendered)           {657:>6,}")
L(f"  intersection + segment                    {728 + 657:>6,}")
L("")
L("The tract layer is the only one carrying the complete geocoded set. The")
L("other two partition it BY RULE and then lose more in rendering: crashes")
L("that fail to snap to a node, and crashes on expressways, ramps and private")
L("roads that are outside the walkable network.")
L("")
L("These three numbers must NEVER be summed. The tract layer re-counts the")
L("same crashes under a different unit; adding it to the other two would")
L("count every crash twice.")

L.close()
