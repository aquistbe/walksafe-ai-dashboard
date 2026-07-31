"""
13_segment_covariates.py
WALKSAFE-AI street-segment extension - Step 13 (Part A2, covariates)

Builds the segment analysis table: the walkable network (CLASS 2-5) with
mid-block crash counts from step 12, plus exposure and context covariates.

Mirrors 03_exposure_covariates.py, with three deliberate differences forced by
the change of unit:

  AADT is joined SEGMENT-TO-SEGMENT. PaTraffic2024_03 is natively a segment
  layer; the intersection pipeline degrades it to a point maximum within 30 m.
  Joining like to like is the single biggest specification improvement
  available here — and it exposes a problem the point maximum was hiding, see
  the nominal-AADT note below.

  Context measures are taken at the segment MIDPOINT, not summed along the
  segment. A count summed along a line grows with its length, which would
  double-count the exposure the offset already carries.

  The High Injury Network enters as the FRACTION of the segment's length that
  is on it. HIN is natively a linear layer, so a fraction is its natural form
  at segment level; a distance-to-nearest was only ever a point-unit compromise.

Outputs
  work/segment_analysis.csv
  outputs/qc_logs/qc_segment_covariates.txt
"""
import geopandas as gpd
import pandas as pd
import numpy as np
from config import (GIS, PLACES, WORK, CRS, M2FT, LOCAL_AADT, NOMINAL_AADT,
                    WALKABLE_CLASSES, CLASS_LABELS, QCLog)

L = QCLog("segment_covariates")

# ---------------------------------------------------------------------------
# 1. Universe: the modelled walkable network, with counts from step 12
# ---------------------------------------------------------------------------
counts = pd.read_csv(WORK / "segment_counts.csv")
cl = gpd.read_file(GIS / "Street_Centerline").to_crs(CRS)
cl["SEG_ID"] = pd.to_numeric(cl.SEG_ID, errors="coerce")

seg = cl[["SEG_ID", "geometry"]].merge(counts, on="SEG_ID", how="inner")
seg = gpd.GeoDataFrame(seg, geometry="geometry", crs=CRS)
seg = seg[seg.modelled].copy()
L(f"Modelled walkable segments: {len(seg):,}")
L(f"Mid-block ped KSI on them: {int(seg.ped_ksi_seg.sum()):,}")
L(f"Segments with >=1 KSI: {int((seg.ped_ksi_seg > 0).sum()):,} "
  f"({(seg.ped_ksi_seg > 0).mean():.2%})")

mid = seg.copy()
mid["geometry"] = seg.geometry.interpolate(0.5, normalized=True)

# ---------------------------------------------------------------------------
# 2. AADT, joined segment to segment
# ---------------------------------------------------------------------------
tr = gpd.read_file(GIS / "PaTraffic2024_03")
tr = tr[tr.CTY_CODE == "67"].to_crs(CRS)
tr["CUR_AADT"] = pd.to_numeric(tr.CUR_AADT, errors="coerce")
tr = tr[tr.CUR_AADT.notna() & (tr.CUR_AADT > 0)]
L(f"\nTraffic segments (Phila, AADT>0): {len(tr):,}")

# Match by greatest overlap with a 15 m corridor around the centerline, not by
# nearest midpoint: on a divided arterial or a street with a parallel alley,
# nearest-midpoint picks the wrong carriageway roughly at random.
BUF = 15 * M2FT
corr = seg[["SEG_ID", "geometry"]].copy()
corr["geometry"] = corr.geometry.buffer(BUF)

cand = gpd.sjoin(corr, tr[["CUR_AADT", "geometry"]], how="inner",
                 predicate="intersects")
cand = cand.reset_index(drop=True)
tr_geom = tr.geometry.reset_index(drop=True)
tr_lookup = tr.reset_index(drop=True)

# overlap length of each candidate traffic line inside the segment's corridor
seg_buf = corr.set_index("SEG_ID").geometry
ov = []
for sid, tidx in zip(cand.SEG_ID, cand.index_right):
    try:
        ov.append(seg_buf.loc[sid].intersection(tr.geometry.loc[tidx]).length)
    except Exception:
        ov.append(0.0)
cand["overlap_ft"] = ov

best = (cand.sort_values(["SEG_ID", "overlap_ft"], ascending=[True, False])
             .drop_duplicates("SEG_ID")[["SEG_ID", "CUR_AADT", "overlap_ft"]]
             .rename(columns={"CUR_AADT": "aadt_joined"}))
seg = seg.merge(best, on="SEG_ID", how="left")

seg["aadt_measured"] = seg.aadt_joined.notna().astype(int)
seg["aadt"] = seg.aadt_joined.fillna(LOCAL_AADT)

# PennDOT assigns a nominal 300 veh/day to local roads. It is a placeholder,
# not a count. At intersections this was invisible because aadt_max took the
# maximum over nearby segments, so any node near an arterial inherited a real
# value. Joining like to like exposes it.
seg["aadt_is_nominal"] = (seg.aadt_joined == NOMINAL_AADT).fillna(False)
seg["aadt_real"] = seg.aadt_measured.astype(bool) & ~seg.aadt_is_nominal

L(f"Segments with a joined AADT: {int(seg.aadt_measured.sum()):,} "
  f"({seg.aadt_measured.mean():.1%})")
L(f"  of which the nominal placeholder {NOMINAL_AADT}: "
  f"{int(seg.aadt_is_nominal.sum()):,} ({seg.aadt_is_nominal.mean():.1%} of all segments)")
L(f"  genuinely counted (non-nominal) ..... {int(seg.aadt_real.sum()):,} "
  f"({seg.aadt_real.mean():.1%})")
L(f"  imputed at {LOCAL_AADT} (no join) ......... {int((~seg.aadt_measured.astype(bool)).sum()):,}")
L("\nAADT coverage by CLASS (share genuinely counted):")
for c, g in seg.groupby("CLASS"):
    L(f"   {int(c):>2} {CLASS_LABELS.get(int(c), '?'):<14} "
      f"joined {g.aadt_measured.mean():>6.1%}   real {g.aadt_real.mean():>6.1%}   n={len(g):,}")
L(f"\nAADT quantiles among genuinely counted: "
  f"{ {q: int(seg.loc[seg.aadt_real, 'aadt'].quantile(q)) for q in (.25,.5,.75,.9)} }")

# ---------------------------------------------------------------------------
# 3. High Injury Network — fraction of length on it
# ---------------------------------------------------------------------------
hin = gpd.read_file(GIS / "high_injury_network_2020").to_crs(CRS)
hin_buf = hin.union_all().buffer(15 * M2FT)
inside = seg.geometry.intersection(hin_buf).length
seg["hin_frac"] = (inside / seg.geometry.length).clip(0, 1).fillna(0)
seg["on_hin"] = (seg.hin_frac >= 0.5).astype(int)
L(f"\nHIN: segments >=50% on network: {int(seg.on_hin.sum()):,} ({seg.on_hin.mean():.1%})")
L(f"  mid-block ped KSI on those: {int(seg.loc[seg.on_hin == 1, 'ped_ksi_seg'].sum()):,} "
  f"of {int(seg.ped_ksi_seg.sum()):,} "
  f"({seg.loc[seg.on_hin == 1, 'ped_ksi_seg'].sum() / max(seg.ped_ksi_seg.sum(), 1):.1%})")

# ---------------------------------------------------------------------------
# 4. Context at the midpoint (length-invariant by construction)
# ---------------------------------------------------------------------------
_places = sorted(PLACES.glob("PLACES__Census_Tract_Data*.csv"))
pl = pd.read_csv(_places[-1], usecols=["CountyFIPS", "TractFIPS",
                                       "TotalPopulation", "Geolocation"])
pl = pl[pl.CountyFIPS == 42101].copy()
pl["geometry"] = gpd.GeoSeries.from_wkt(pl.Geolocation)
plg = gpd.GeoDataFrame(pl, geometry="geometry", crs=4326).to_crs(CRS)

b800 = mid[["SEG_ID", "geometry"]].copy()
b800["geometry"] = b800.geometry.buffer(800 * M2FT)
ph = gpd.sjoin(b800, plg[["TotalPopulation", "geometry"]], how="left",
               predicate="intersects")
seg = seg.merge(ph.groupby("SEG_ID")["TotalPopulation"].sum().rename("pop_800m"),
                on="SEG_ID", how="left")
seg["pop_800m"] = seg.pop_800m.fillna(0)

sch = gpd.read_file(GIS / "PhiladelphiaSchool_Facilities2016").to_crs(CRS)
sch = sch[sch.ACTIVE == "Open"]
pp = pd.concat([gpd.read_file(GIS / "PPR_Program_Sites").to_crs(CRS)[["geometry"]],
                gpd.read_file(GIS / "PPR_Playgrounds").to_crs(CRS)[["geometry"]]],
               ignore_index=True)
gen = pd.concat([sch[["geometry"]].assign(kind="school"),
                 pp.assign(kind="park")], ignore_index=True)
gen["geometry"] = gpd.GeoSeries(gen.geometry, crs=CRS).representative_point()

b200 = mid[["SEG_ID", "geometry"]].copy()
b200["geometry"] = b200.geometry.buffer(200 * M2FT)
gh = gpd.sjoin(b200, gpd.GeoDataFrame(gen, crs=CRS), how="left",
               predicate="intersects")
gc = gh.groupby(["SEG_ID", "kind"]).size().unstack(fill_value=0)
seg = seg.merge(gc, on="SEG_ID", how="left")
for c in ["school", "park"]:
    if c not in seg.columns:
        seg[c] = 0
    seg[c] = seg[c].fillna(0).astype(int)
seg = seg.rename(columns={"school": "schools_200m", "park": "parks_200m"})

L(f"\npop_800m quantiles: "
  f"{ {q: int(seg.pop_800m.quantile(q)) for q in (.25,.5,.75)} }")
L(f"Segments with >=1 school in 200 m: {int((seg.schools_200m > 0).sum()):,}; "
  f">=1 park: {int((seg.parks_200m > 0).sum()):,}")

# ---------------------------------------------------------------------------
# 5. Road form
# ---------------------------------------------------------------------------
seg["is_oneway"] = (~seg.ONEWAY.astype(str).str.upper().isin(["B", "NAN", "NONE"])).astype(int)
L(f"\nOne-way segments: {int(seg.is_oneway.sum()):,} ({seg.is_oneway.mean():.1%})")
L(f"Divided (MULTI_REP>0): {int(seg.is_divided.astype(bool).sum()):,}")

# ---------------------------------------------------------------------------
# 6. Coordinates for the map layer
# ---------------------------------------------------------------------------
w = mid.to_crs(4326)
seg["mid_lat"] = w.geometry.y.values
seg["mid_lon"] = w.geometry.x.values

seg.drop(columns="geometry").to_csv(WORK / "segment_analysis.csv", index=False)
L(f"\nSaved work/segment_analysis.csv ({len(seg):,} rows)")
L.close()
