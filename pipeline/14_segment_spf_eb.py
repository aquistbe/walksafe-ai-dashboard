"""
14_segment_spf_eb.py
WALKSAFE-AI street-segment extension - Step 14 (Part A2, model)

Segment safety performance function and empirical Bayes.

This is NOT the intersection SPF applied to a different unit. Three
specification differences, each forced by the change of unit:

1. LENGTH IS AN OFFSET. Exposure scales with how much roadway is at risk, so
   log(exposure) enters with its coefficient fixed at 1. The intersection SPF
   has no offset at all, which is defensible for a point and is not for lines
   of wildly unequal length. Exposure is length OUTSIDE the intersection
   influence zone (step 12), so the two products do not both claim the same
   roadway.

2. AADT IS NOT A POOLED TERM. PennDOT assigns a nominal 300 veh/day to local
   roads; only 33.5% of segments carry a genuine count, and on minor local
   streets it is 8.6%. A single log-linear elasticity fitted across that would
   be carried by the placeholder. Instead the volume slope is estimated ONLY
   from segments with a real count, via an interaction, and road class carries
   the hierarchy elsewhere. The intersection model hid this problem because
   aadt_max took the maximum over nearby segments, so any node near an arterial
   inherited a real value.

3. THE HIGH INJURY NETWORK IS EXCLUDED FROM THE PRIMARY MODEL. The 2020 HIN was
   itself derived from crash data over a period overlapping this outcome
   window, so conditioning on it is close to conditioning on the outcome. It
   carries the largest coefficient in the intersection SPF (1.089). Reported
   here as a secondary fit, and as a map property, but not in the primary.

Fitted at two units. The segment is the rendered unit; the corridor is where
observed data carries enough weight for empirical Bayes to mean anything. Both
weight distributions are reported so the choice is visible rather than asserted.

The output is eb_ksi_seg, NEVER eb_ksi: different denominator, different and
disjoint crash set, different covariates. It is not comparable to the
intersection measure and must never be ranked against it or summed with it.

Outputs
  work/segment_ranked.csv
  work/corridor_ranked.csv
  outputs/qc_logs/qc_segment_spf.txt
"""
import numpy as np
import pandas as pd
import statsmodels.api as sm
from config import WORK, QCLog

L = QCLog("segment_spf")

MIN_EXPOSURE_MI = 0.005          # ~8 m floor; log(0) would poison the fit
ALPHA_GRID = np.geomspace(0.05, 50, 80)

df = pd.read_csv(WORK / "segment_analysis.csv")
L(f"Modelled segments: {len(df):,}")
L(f"Mid-block ped KSI: {int(df.ped_ksi_seg.sum()):,}")


# ---------------------------------------------------------------------------
def fit_nb(y, X, offset, label):
    """NB2 with a fixed offset, dispersion profiled over a grid."""
    best = None
    for i, a in enumerate(ALPHA_GRID):
        m = sm.GLM(y, X, family=sm.families.NegativeBinomial(alpha=a),
                   offset=offset).fit()
        if best is None or m.llf > best[0]:
            best = (m.llf, a, m, i)
    llf, alpha, model, idx = best

    # A boundary optimum is a grid artifact, not an estimate.
    if idx in (0, len(ALPHA_GRID) - 1):
        L(f"  WARNING [{label}]: alpha hit the grid boundary at {alpha:.3f} — "
          "widen ALPHA_GRID; the dispersion estimate is not identified.")

    null = sm.GLM(y, np.ones((len(y), 1)),
                  family=sm.families.NegativeBinomial(alpha=alpha),
                  offset=offset).fit()          # same offset, or pseudo-R2 lies
    k = 1.0 / alpha

    # predict() without offset= silently predicts at offset 0, i.e. per unit
    # mile. At a median exposure well under a mile the values come out several
    # times too large and look entirely plausible.
    mu = model.predict(X, offset=offset)
    assert np.allclose(mu, model.fittedvalues), "offset dropped from predict()"

    L(f"\n[{label}] NB2, offset = log(exposure_mi)")
    L(f"  n = {len(y):,}   observed KSI = {int(y.sum()):,}")
    L(f"  alpha = {alpha:.4f}  (k = {k:.4f})   llf = {llf:.1f}")
    L(f"  McFadden pseudo-R2 vs offset-only intercept = {1 - llf / null.llf:.4f}")
    L(model.summary2().tables[1].round(4).to_string())
    return model, alpha, k, mu


def eb(mu, observed, k):
    w = k / (k + mu)
    return w * mu + (1 - w) * observed, w


def design(d, with_hin):
    """Shared design matrix. Road class carries the hierarchy; the AADT slope is
    estimated only where the count is real."""
    X = pd.get_dummies(d.CLASS.astype(int).astype(str), prefix="cls",
                       drop_first=True)          # base = CLASS 2 (arterial)
    X["is_oneway"] = d.is_oneway
    X["log_pop"] = np.log(d.pop_800m.clip(lower=100))
    X["schools_200m"] = d.schools_200m
    X["parks_200m"] = d.parks_200m

    # AADT: an indicator for having a genuine count, plus a centred slope that
    # is zero wherever the count is nominal or imputed. The elasticity is then
    # identified only from segments where AADT means something.
    real = d.aadt_real.astype(bool)
    lg = np.log(d.aadt.clip(lower=1))
    X["aadt_real"] = real.astype(float)
    X["log_aadt_real"] = np.where(real, lg - lg[real].mean(), 0.0)

    if with_hin:
        X["hin_frac"] = d.hin_frac
    return sm.add_constant(X.astype(float))


# ---------------------------------------------------------------------------
# Segment-level fit
# ---------------------------------------------------------------------------
fit_mask = df.exposure_mi > MIN_EXPOSURE_MI
L(f"\nSegments excluded from the fit for ~zero exposure "
  f"(entirely inside an intersection influence zone): "
  f"{int((~fit_mask).sum()):,} ({(~fit_mask).mean():.1%})")
L(f"  KSI on excluded segments: {int(df.loc[~fit_mask, 'ped_ksi_seg'].sum()):,} "
  "(these crashes are retained in the counts, only the model skips the units)")

d = df[fit_mask].copy()
off = np.log(d.exposure_mi.clip(lower=MIN_EXPOSURE_MI).to_numpy(float))
y = d.ped_ksi_seg.astype(float)

model, alpha, k, mu = fit_nb(y, design(d, with_hin=False), off, "segment / primary")
d["mu_spf_seg"] = mu
d["eb_ksi_seg"], d["eb_weight_seg"] = eb(mu, y, k)

L(f"\n[segment] EB weight on the SPF: median {np.median(d.eb_weight_seg):.4f}  "
  f"IQR {d.eb_weight_seg.quantile(.25):.4f}-{d.eb_weight_seg.quantile(.75):.4f}")
L(f"  => observed crash data carries a median of "
  f"{(1 - np.median(d.eb_weight_seg)) * 100:.1f}% of the estimate.")

# Secondary fits, reported not published.
fit_nb(y, design(d, with_hin=True), off, "segment / + HIN (endogenous)")
real = d[d.aadt_real.astype(bool)]
if len(real) > 500:
    fit_nb(real.ped_ksi_seg.astype(float), design(real, with_hin=False),
           np.log(real.exposure_mi.clip(lower=MIN_EXPOSURE_MI).to_numpy(float)),
           "segment / real-AADT only")

# ---------------------------------------------------------------------------
# Corridor-level fit
# ---------------------------------------------------------------------------
agg = df.groupby("corridor_id").agg(
    ped_ksi_seg=("ped_ksi_seg", "sum"),
    ped_any_seg=("ped_any_seg", "sum"),
    exposure_mi=("exposure_mi", "sum"),
    length_mi=("length_mi", "sum"),
    n_seg=("SEG_ID", "size"),
    CLASS=("CLASS", "min"),                 # lower = higher functional class
    is_oneway=("is_oneway", "max"),
    aadt=("aadt", "max"),
    aadt_real=("aadt_real", "max"),
    hin_frac=("hin_frac", "mean"),
    pop_800m=("pop_800m", "mean"),
    schools_200m=("schools_200m", "mean"),
    parks_200m=("parks_200m", "mean"),
    STREETLABE=("STREETLABE", "first"),
).reset_index()

cm = agg.exposure_mi > MIN_EXPOSURE_MI
c = agg[cm].copy()
coff = np.log(c.exposure_mi.clip(lower=MIN_EXPOSURE_MI).to_numpy(float))
cy = c.ped_ksi_seg.astype(float)

cmodel, calpha, ck, cmu = fit_nb(cy, design(c, with_hin=False), coff,
                                 "corridor / primary")
c["mu_spf_corr"] = cmu
c["eb_ksi_corr"], c["eb_weight_corr"] = eb(cmu, cy, ck)

L(f"\n[corridor] EB weight on the SPF: median {np.median(c.eb_weight_corr):.4f}  "
  f"IQR {c.eb_weight_corr.quantile(.25):.4f}-{c.eb_weight_corr.quantile(.75):.4f}")
L(f"  => observed crash data carries a median of "
  f"{(1 - np.median(c.eb_weight_corr)) * 100:.1f}% of the estimate.")

# ---------------------------------------------------------------------------
# The comparison that decides which unit to publish
# ---------------------------------------------------------------------------
L("\n" + "=" * 78)
L("EMPIRICAL BAYES WEIGHT — how much of the estimate is observed data")
L("=" * 78)
L("The median over ALL units is dominated by the mass of zero-crash units,")
L("where there is no data to weight and w is near 1 by construction. The")
L("informative statistic is the weight where crashes actually are.")
L("")
L(f"{'unit':<24}{'n':>8}{'median w':>10}{'w | KSI>0':>11}{'crash-wtd w':>13}"
  f"{'obs. where':>12}")
L(f"{'':<24}{'':>8}{'(all)':>10}{'':>11}{'':>13}{'crashes are':>12}")
for lab, dd, wcol, kcol in [
    ("segment", d, "eb_weight_seg", "ped_ksi_seg"),
    ("corridor (ST_CODE)", c, "eb_weight_corr", "ped_ksi_seg"),
]:
    w_all = np.median(dd[wcol])
    hit = dd[dd[kcol] > 0]
    w_hit = np.median(hit[wcol]) if len(hit) else float("nan")
    w_cw = np.average(dd[wcol], weights=dd[kcol]) if dd[kcol].sum() else float("nan")
    L(f"{lab:<24}{len(dd):>8,}{w_all:>10.3f}{w_hit:>11.3f}{w_cw:>13.3f}"
      f"{(1 - w_cw) * 100:>11.1f}%")
L(f"{'intersection (step 04)':<24}{16984:>8,}{0.990:>10.3f}{'':>11}{'':>13}{'':>12}")
L("=" * 78)
L("Read the crash-weighted column. At the segment the estimate is still")
L("essentially the model everywhere. At the corridor, the units that carry the")
L("crashes get real weight — N Broad St w = 0.12, Frankford Ave w = 0.08 —")
L("because a corridor accumulates enough events for the data to speak.")
L("")
L("So: MAP the SPF expectation per mile, which is honest at both units, and")
L("use the CORRIDOR empirical Bayes estimate for ranking, where it is doing")
L("something other than restating the covariates.")

# ---------------------------------------------------------------------------
# Rates and ranks
# ---------------------------------------------------------------------------
d["mu_per_mile"] = d.mu_spf_seg / d.exposure_mi
d["ksi_per_mile"] = d.ped_ksi_seg / d.exposure_mi
d["excess_seg"] = d.ped_ksi_seg - d.mu_spf_seg
d["rank_seg_spf"] = d.mu_per_mile.rank(method="min", ascending=False).astype(int)
d["rank_seg_raw"] = d.ped_ksi_seg.rank(method="min", ascending=False).astype(int)
d["rank_seg_excess"] = d.excess_seg.rank(method="min", ascending=False).astype(int)

q = d.mu_per_mile.quantile([.75, .95, .99])
d["seg_risk_tier"] = np.select(
    [d.mu_per_mile >= q[.99], d.mu_per_mile >= q[.95], d.mu_per_mile >= q[.75]],
    ["Critical", "High", "Moderate"], default="Low")
L("\nSegment risk tiers (quantiles of SPF expectation per mile — its OWN")
L("thresholds, not the intersection tier cut-points):")
L(f"  {d.seg_risk_tier.value_counts().reindex(['Critical','High','Moderate','Low']).to_dict()}")
L(f"  mu_per_mile cut-points: p75 {q[.75]:.3f}  p95 {q[.95]:.3f}  p99 {q[.99]:.3f}")

c["mu_per_mile"] = c.mu_spf_corr / c.exposure_mi
c["rank_corr_spf"] = c.mu_per_mile.rank(method="min", ascending=False).astype(int)

L("\nTop 15 corridors by observed mid-block ped KSI:")
top = c.sort_values("ped_ksi_seg", ascending=False).head(15)
for _, r in top.iterrows():
    L(f"   {str(r.STREETLABE):<26} KSI {int(r.ped_ksi_seg):>3}  "
      f"{r.exposure_mi:>5.2f} mi exposure  mu/mi {r.mu_per_mile:>6.2f}  "
      f"EB {r.eb_ksi_corr:>5.2f} (w {r.eb_weight_corr:.2f})")

# ---------------------------------------------------------------------------
out = df.merge(
    d[["SEG_ID", "mu_spf_seg", "eb_ksi_seg", "eb_weight_seg", "mu_per_mile",
       "ksi_per_mile", "excess_seg", "rank_seg_spf", "rank_seg_raw",
       "rank_seg_excess", "seg_risk_tier"]], on="SEG_ID", how="left")
out["in_model"] = out.SEG_ID.isin(d.SEG_ID)
out = out.merge(c[["corridor_id", "mu_spf_corr", "eb_ksi_corr",
                   "eb_weight_corr", "rank_corr_spf"]],
                on="corridor_id", how="left")

out.to_csv(WORK / "segment_ranked.csv", index=False)
c.to_csv(WORK / "corridor_ranked.csv", index=False)
L(f"\nSaved work/segment_ranked.csv ({len(out):,}) and "
  f"work/corridor_ranked.csv ({len(c):,})")
L.close()
