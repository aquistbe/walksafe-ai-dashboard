"""
15_bogota_segment_spf.py
WalkSafe-AI Bogota street segments - safety performance function

Mirrors the Philadelphia specification in 14_segment_spf_eb.py: negative
binomial with log(length) as an offset, then empirical Bayes. What differs is
forced by the data, and every difference is a reason the two cities' segment
estimates are NOT comparable:

  OUTCOME      si_act_pea — pedestrian-INVOLVED crashes, not KSI. Philadelphia's
               segment outcome is killed-or-seriously-injured. 20,608 here
               against 657 mid-block KSI there; these are different events.

  EXPOSURE     Length is DERIVED. Calles_datos is a polygon layer of street
               footprints, so there is no length attribute: length = carriageway
               area / mean carriageway width. Philadelphia had true centerline
               length minus the intersection influence zone; there is no
               equivalent subtraction here, so Bogota segment exposure INCLUDES
               its junctions.

  NO ROAD CLASS. CodigoCL is uniformly "CL" (a sequential id, not a street
               type) and no other field carries a hierarchy. Width, lanes and
               speed carry it directly instead, which is arguably better than a
               categorical proxy but is not the same specification.

  NO CORRIDOR UNIT. Philadelphia grouped segments by ST_CODE to get a unit
               where empirical Bayes carries real weight. Calles_datos has no
               street-name or corridor key, so only the segment fit exists.

  CRASH WINDOW believed 2015-2019, matching the ZAT models. The shapefile
               carries no explicit window field; the sibling source
               bogota_atropellos_2015_2019_mallavial.json names that range, and
               the totals are consistent with the ZAT layer (20,608
               pedestrian-involved here against 16,650 injury+death there).
               Stated as an assumption, not a verified fact.

`sent_vial` is 100% null across all 100,819 rows and is not used.

Outputs
  work/bogota_segment_ranked.csv
  outputs/qc_logs/qc_bogota_segment_spf.txt
"""
import numpy as np
import pandas as pd
import geopandas as gpd
import statsmodels.api as sm
from config import WORK, QCLog

SRC = __import__("pathlib").Path(__file__).resolve().parent.parent / "data" / "source"
SHP = SRC / "Calles_datos.shp"
SES = SRC / "wt_mean_ses_calle_100m.csv"

MIN_LENGTH_KM = 0.005          # 5 m floor; log(0) would poison the fit
ALPHA_GRID = np.geomspace(0.05, 50, 80)
METRIC_CRS = 3116              # MAGNA-SIRGAS / Colombia Bogota zone

L = QCLog("bogota_segment_spf")

if not SHP.exists():
    raise SystemExit(f"Missing {SHP}\nSee data/source/README.md — the shapefile "
                     "is gitignored by design.")

# ---------------------------------------------------------------------------
# 1. Load and derive exposure
# ---------------------------------------------------------------------------
g = gpd.read_file(SHP)
L(f"Calles_datos: {len(g):,} features, {g.geom_type.value_counts().to_dict()}")
L(f"source CRS: {str(g.crs)[:70]}")

num = ["si_act_pea", "sini_total", "P_Ancho_Cl", "av_carrile", "sum_carril",
       "velcidad", "semaforo", "A_Calzada", "A_andenes", "arboles"]
for c in num:
    g[c] = pd.to_numeric(g[c], errors="coerce")

m = g.to_crs(METRIC_CRS)
g["poly_area_m2"] = m.geometry.area
g["poly_perim_m"] = m.geometry.length

# Length from carriageway area / carriageway width — internally consistent,
# both terms describing the same surface. area/width over the whole footprint
# would inflate length wherever sidewalks and medians are wide.
g["length_m"] = np.where(g.P_Ancho_Cl > 0, g.A_Calzada / g.P_Ancho_Cl, np.nan)
# Fallback for segments with no carriageway area recorded.
alt = np.where(g.P_Ancho_Cl > 0, g.poly_area_m2 / g.P_Ancho_Cl, np.nan)
g["length_m"] = np.where(g.length_m > 0, g.length_m, alt)
g["length_km"] = g.length_m / 1000

ok = g.length_m.replace([np.inf, -np.inf], np.nan)
L(f"\nDerived length (m): "
  f"{ {q: round(float(ok.quantile(q)), 1) for q in (.1,.25,.5,.75,.9)} }")
L(f"  usable (>0, finite): {int(ok.gt(0).sum()):,} of {len(g):,}")
L(f"  total network: {ok.sum()/1000:,.0f} km")

# ---------------------------------------------------------------------------
# 2. Covariates
# ---------------------------------------------------------------------------
ses = pd.read_csv(SES, usecols=["CodigoCL", "wt_mean", "ses_cat"])
g = g.merge(ses, on="CodigoCL", how="left")
L(f"\nSES join on CodigoCL: {int(g.wt_mean.notna().sum()):,} of {len(g):,} "
  f"({g.wt_mean.notna().mean():.1%})")
L(f"  ses_cat: {g.ses_cat.value_counts().sort_index().to_dict()}")

g["has_signal"] = (g.semaforo.fillna(0) > 0).astype(int)
g["lanes"] = g.av_carrile.fillna(0)
g["width_m"] = g.P_Ancho_Cl.fillna(0)
g["speed"] = g.velcidad.fillna(0)
g["si_act_pea"] = g.si_act_pea.fillna(0)

L(f"\nOutcome si_act_pea (pedestrian-involved crashes):")
L(f"  total {int(g.si_act_pea.sum()):,}   segments with >=1: "
  f"{int((g.si_act_pea > 0).sum()):,} ({(g.si_act_pea > 0).mean():.2%})")
L(f"  Philadelphia comparison: 657 mid-block KSI on 599 of 39,761 segments "
  "(1.5%). Different outcome definition — do not compare the two.")
L(f"\ncovariate medians: width {g.width_m.median():.2f} m, "
  f"lanes {g.lanes.median():.1f}, speed {g.speed.median():.0f} km/h, "
  f"signal on {int(g.has_signal.sum()):,} segments")

# ---------------------------------------------------------------------------
# 3. Fit
# ---------------------------------------------------------------------------
fit_mask = (g.length_km > MIN_LENGTH_KM) & g.length_km.notna() & g.ses_cat.notna()
L(f"\nExcluded from the fit: {int((~fit_mask).sum()):,} "
  f"({(~fit_mask).mean():.1%}) — no usable length or no SES. Their crashes are "
  "retained in the counts; only the model skips the units.")
L(f"  crashes on excluded segments: {int(g.loc[~fit_mask, 'si_act_pea'].sum()):,}")

d = g[fit_mask].copy()
off = np.log(d.length_km.clip(lower=MIN_LENGTH_KM).to_numpy(float))
y = d.si_act_pea.astype(float)

X = pd.get_dummies(d.ses_cat.astype(int).astype(str), prefix="ses", drop_first=True)
X["width_m"] = d.width_m
X["lanes"] = d.lanes
X["speed"] = d.speed
X["has_signal"] = d.has_signal
X = sm.add_constant(X.astype(float))

best = None
for i, a in enumerate(ALPHA_GRID):
    mod = sm.GLM(y, X, family=sm.families.NegativeBinomial(alpha=a), offset=off).fit()
    if best is None or mod.llf > best[0]:
        best = (mod.llf, a, mod, i)
llf, alpha, model, idx = best
if idx in (0, len(ALPHA_GRID) - 1):
    L(f"  WARNING: alpha hit the grid boundary at {alpha:.3f} — not identified.")
k = 1.0 / alpha

null = sm.GLM(y, np.ones((len(y), 1)),
              family=sm.families.NegativeBinomial(alpha=alpha), offset=off).fit()

# predict() without offset= silently predicts at offset 0, i.e. per unit length.
mu = model.predict(X, offset=off)
assert np.allclose(mu, model.fittedvalues), "offset dropped from predict()"

L(f"\nNB2, offset = log(length_km)")
L(f"  n = {len(y):,}   observed crashes = {int(y.sum()):,}")
L(f"  alpha = {alpha:.4f}  (k = {k:.4f})   llf = {llf:.1f}")
L(f"  McFadden pseudo-R2 vs offset-only intercept = {1 - llf / null.llf:.4f}")
L(model.summary2().tables[1].round(4).to_string())

w = k / (k + mu)
d["mu_spf_seg"] = mu
d["eb_ksi_seg"] = w * mu + (1 - w) * y
d["eb_weight_seg"] = w

hit = d[d.si_act_pea > 0]
cw = np.average(d.eb_weight_seg, weights=d.si_act_pea) if d.si_act_pea.sum() else np.nan
L("\n" + "=" * 74)
L("EMPIRICAL BAYES WEIGHT — how much of the estimate is observed data")
L("=" * 74)
L(f"  median across all units .............. {np.median(d.eb_weight_seg):.3f}")
L(f"  median where crashes > 0 ............. {np.median(hit.eb_weight_seg):.3f}")
L(f"  crash-weighted mean .................. {cw:.3f}")
L(f"  => where crashes are, observed data supplies {(1-cw)*100:.1f}% "
  "of the estimate.")
L("")
L("  Philadelphia segments, for contrast: median 0.980 across all units,")
L("  0.835 crash-weighted — 16.5% observed. Bogota does better because")
L(f"  {(g.si_act_pea>0).mean():.1%} of segments carry a crash against 1.5% there.")
L("=" * 74)

# ---------------------------------------------------------------------------
# 4. Rates, ranks, tiers
# ---------------------------------------------------------------------------
d["mu_per_km"] = d.mu_spf_seg / d.length_km
d["crashes_per_km"] = d.si_act_pea / d.length_km
d["rank_seg_spf"] = d.mu_per_km.rank(method="min", ascending=False).astype(int)
d["rank_seg_raw"] = d.si_act_pea.rank(method="min", ascending=False).astype(int)

q = d.mu_per_km.quantile([.75, .95, .99])
d["tier"] = np.select(
    [d.mu_per_km >= q[.99], d.mu_per_km >= q[.95], d.mu_per_km >= q[.75]],
    ["Critical", "High", "Moderate"], default="Low")
L("\nRisk tiers — quantiles of expected crashes per km, this model's own")
L("cut-points, NOT the Philadelphia or intersection thresholds:")
L(f"  {d.tier.value_counts().reindex(['Critical','High','Moderate','Low']).to_dict()}")
L(f"  mu_per_km cut-points: p75 {q[.75]:.2f}  p95 {q[.95]:.2f}  p99 {q[.99]:.2f}")

out = g.drop(columns="geometry").merge(
    d[["CodigoCL", "mu_spf_seg", "eb_ksi_seg", "eb_weight_seg", "mu_per_km",
       "crashes_per_km", "rank_seg_spf", "rank_seg_raw", "tier"]],
    on="CodigoCL", how="left")
out["in_model"] = out.CodigoCL.isin(d.CodigoCL)

L("\nTop 15 segments by observed pedestrian crashes:")
top = out.sort_values("si_act_pea", ascending=False).head(15)
for _, r in top.iterrows():
    L(f"   {r.CodigoCL:<10} crashes {int(r.si_act_pea):>3}  "
      f"{r.length_m:>7.0f} m  width {r.width_m:>5.1f} m  "
      f"mu/km {r.mu_per_km if pd.notna(r.mu_per_km) else float('nan'):>6.2f}")

out.to_csv(WORK / "bogota_segment_ranked.csv", index=False)
L(f"\nSaved work/bogota_segment_ranked.csv ({len(out):,} rows)")
L.close()
