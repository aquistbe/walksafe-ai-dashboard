"""
04_risk_measures_eb.py
WALKSAFE-AI intersection ranking - Step 4
Three risk measures over the 16,984-intersection universe:
  (a) raw ped KSI count 2015-2024
  (b) ped KSI per million entering vehicles (MEV), AADT-based; approximate -
      no pedestrian volume denominator exists
  (c) Empirical Bayes expected ped KSI from a negative binomial SPF
      (log link, offset-free; covariates log AADT, control type, log pop
      within 800 m, HIN flag, schools/parks within 200 m)

EB: w = k/(k + mu_i) where the NB variance is mu + mu^2/k (statsmodels alpha =
1/k). EB_i = w*mu_i + (1-w)*observed_i.
"""
import pandas as pd
import numpy as np
import statsmodels.api as sm
from pathlib import Path
from config import WORK, QC_LOGS  # repo-relative paths; see pipeline/README.md

OUT = WORK
YEARS = 10

log = []
def L(m):
    print(m); log.append(str(m))

df = pd.read_csv(OUT / "intersections_analysis.csv")
L(f"Universe: {len(df)} intersections; total ped KSI {df.ped_ksi.sum()}")

# ---------- (a) raw ----------
df["rank_raw"] = df.ped_ksi.rank(method="min", ascending=False).astype(int)

# ---------- (b) rate per million entering vehicles ----------
# Entering volume approximation: AADT of the busiest approach route x 365 x 10.
# This understates true entering volume at multi-route intersections and has no
# pedestrian denominator; treat as approximate.
df["mev"] = df.aadt * 365 * YEARS / 1e6
df["ksi_per_mev"] = df.ped_ksi / df.mev
df["rate_reliable"] = (df.aadt_measured == 1).astype(int)
df["rank_rate"] = df.ksi_per_mev.rank(method="min", ascending=False).astype(int)
L(f"Rate computed for all; flagged reliable (measured AADT): {df.rate_reliable.sum()}")

# ---------- (c) EB via negative binomial SPF ----------
df["log_aadt"] = np.log(df.aadt)
df["log_pop"] = np.log(df.pop_800m.clip(lower=100))
X = pd.get_dummies(df.stoptype, prefix="ctl", drop_first=True)  # base: All Way
X = pd.concat([df[["log_aadt", "log_pop", "on_hin", "schools_200m", "parks_200m"]], X], axis=1).astype(float)
X = sm.add_constant(X)
y = df.ped_ksi.astype(float)

# Estimate NB dispersion alpha by profiling the NB2 log-likelihood
best = None
for alpha in np.geomspace(0.05, 10, 60):
    m = sm.GLM(y, X, family=sm.families.NegativeBinomial(alpha=alpha)).fit()
    ll = m.llf
    if best is None or ll > best[0]:
        best = (ll, alpha, m)
ll, alpha, model = best
k = 1 / alpha
L(f"\nNB SPF: alpha (overdispersion) = {alpha:.3f}  (k = 1/alpha = {k:.3f}), llf = {ll:.1f}")
L(f"McFadden pseudo-R2 vs intercept-only: "
  f"{1 - ll / sm.GLM(y, np.ones((len(y),1)), family=sm.families.NegativeBinomial(alpha=alpha)).fit().llf:.3f}")
L("Coefficients (log scale):\n" + model.summary2().tables[1].round(3).to_string())

df["mu_spf"] = model.predict(X)
w = k / (k + df.mu_spf)
df["eb_ksi"] = w * df.mu_spf + (1 - w) * df.ped_ksi
df["eb_weight_spf"] = w
df["rank_eb"] = df.eb_ksi.rank(method="min", ascending=False).astype(int)
L(f"\nEB weights on SPF: median {w.median():.2f}, IQR {w.quantile(.25):.2f}-{w.quantile(.75):.2f}")

# ---------- combined ----------
df["rank_mean"] = df[["rank_raw", "rank_eb"]].mean(axis=1)  # rate too unstable to average in
df = df.sort_values(["rank_eb", "rank_raw"]).reset_index(drop=True)

top50 = df.nsmallest(50, "rank_eb", keep="all").copy()
L(f"\nTop 50 by EB: KSI range {top50.ped_ksi.min()}-{top50.ped_ksi.max()}, "
  f"on HIN {top50.on_hin.sum()}/50, signalized {(top50.stoptype=='Signalized').sum()}/50")
agree = len(set(df.nsmallest(50, 'rank_raw').node_id) & set(top50.node_id))
L(f"Overlap raw-top50 vs EB-top50: {agree}")
L("\nTop 20 (EB):\n" + top50.head(20)[
    ["node_id","int_name","ped_ksi","ped_deaths","ped_any","aadt","stoptype",
     "on_hin","eb_ksi","rank_raw","rank_rate","rank_eb"]].round(2).to_string(index=False))

df.to_csv(OUT / "intersections_ranked.csv", index=False)
(QC_LOGS / "qc_risk_measures.txt").write_text("\n".join(log))
