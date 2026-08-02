# The within-stratum imagery result is a selection artifact

**2026-08-02. Reproduce with `uv run --with pandas --with numpy --with statsmodels
--with matplotlib python scoring/selection_artifact.py`. Key numbers in
`selection_artifact_results.json`; figure in `selection_artifact.png`.**

## What this changes

Two numbers carry the Philadelphia analysis in AJPH draft 3: a citywide rate
ratio of 1.35 and a within-highest-risk-stratum rate ratio of 0.92, presented as
the same model reversing sign on the choice of denominator. Neither survives.

The 1.35 is confounding by intersection control type. The 0.92 is selection on an
outcome-derived stratifier. The denominator is `log(pop_800m)` in both, so the
contrast between them was never a denominator effect at all.

Adjust for control type and the reversal disappears. Every specification that
compares like with like lands between 0.82 and 0.89 with an interval excluding 1.

## The diagnostic

Tier is cut on `eb_ksi`, which is `w * mu_spf + (1 - w) * ped_ksi` — a function
of the observed crash count (median `eb_weight_spf` 0.797 across the 900).
Selecting on it forces risk factors into negative association inside the selected
set. AADT shows this plainly. Poisson, observed `ped_ksi`, `log(pop_800m)`
offset, no tier terms:

| frame | n | ped KSI | RR per log-unit AADT | 95% CI |
|---|---|---|---|---|
| all 900 scored sites | 900 | 421 | **1.60** | 1.47, 1.76 |
| Low + Moderate | 500 | 19 | 1.22 | 0.88, 1.68 |
| Critical only | 150 | 259 | 0.98 | 0.72, 1.34 |
| High only | 250 | 143 | **0.46** | 0.36, 0.60 |
| Critical + High (analysis frame) | 400 | 402 | **0.70** | 0.59, 0.82 |

More traffic, fewer pedestrian casualties. That does not happen. The correlation
between AADT and the imagery score reverses with it, +0.131 across the 900 to
−0.289 inside the frame, and the score plays no part in defining tier — the
reversal is produced by the selection alone.

## The simulation

Generate `ped_ksi` from a Poisson with the observed population and AADT, a true
AADT effect of 1.60, and an imagery effect of **exactly zero**. Fit an SPF,
shrink to an EB estimate, rank on it, keep the top 400, refit. 1000 replications.

| quantity | median | 2.5% | 97.5% |
|---|---|---|---|
| imagery RR, all 900 (truth 1.000) | 1.018 | 0.931 | 1.115 |
| AADT RR, all 900 (truth 1.602) | 1.598 | 1.465 | 1.759 |
| **imagery RR, selected top 400** | **0.929** | **0.844** | **1.021** |
| r(log AADT, score), all 900 → selected | +0.131 → −0.307 | | |

The imagery RR falls below 1.00 in **94% of replications** under a true effect of
zero. The observed 0.910 sits inside that null distribution, and the simulated
correlation reversal (−0.307) matches the observed one (−0.289). The
within-stratum association is what selection produces when there is nothing
there.

Selecting on observed `ped_ksi` instead of `eb_ksi` reproduces it (RR 0.891 at
the top 400, 0.826 at 300, 0.855 at 200), and the flip is not a denominator
artifact — it holds with no offset (1.58 → 0.63) as well as with the population
offset.

One limit, stated because it matters. A single-cause simulation reproduces the
imagery artifact but not the full AADT flip. Adding a latent cause the selection
SPF cannot see moves the in-frame AADT RR from 1.59 to 0.96 as its sd goes 0 to
2, approaching but not reaching the observed 0.70. Selection explains the
direction of the AADT flip; it does not account for all of its magnitude. The
imagery result needs no such caveat — the score RR sits at 0.87–0.93 under a true
null regardless of the latent cause.

## What actually drives the citywide 1.35

Not the denominator. Intersection control type:

| control type | n | mean score | ped KSI per site | median IPW |
|---|---|---|---|---|
| Conventional | 188 | 42.7 | 0.02 | 54.75 |
| All Way | 77 | 48.8 | 0.09 | 54.75 |
| Signalized | 635 | 52.6 | 0.65 | 1.38 |

Unsignalized intersections score low, carry almost no pedestrian KSI, and are
weighted roughly forty times the signalized ones. Contrasting them against
signalized intersections is what produces "places the model rates as safer carry
more pedestrian KSI per resident." Dropping the Low stratum moves the weighted
citywide estimate from 1.346 to 0.854; that stratum holds 80.6% of the analysis
weight and 3 observed KSI. Unweighted, the same model gives 1.009.

The score is not merely detecting signals — control type explains 12% of its
variance (R² 0.121), so adjusting for it is confounder control, not adjusting
away the exposure.

## Every defensible frame

RR per +10 imagery score points, observed `ped_ksi`, `log(pop_800m)` offset,
stratified bootstrap, 1000 reps, seed 20260802. Higher score = safer, so RR < 1
is the informative direction.

| frame / specification | RR | 95% CI |
|---|---|---|
| all 900, no covariates, unweighted | 1.009 | 0.928, 1.106 |
| all 900, no covariates, IPW — *the essay's 1.35* | 1.346 | 1.125, 1.676 |
| all 900, + control type, unweighted | **0.868** | 0.798, 0.949 |
| all 900, + control type, IPW | **0.838** | 0.715, 0.974 |
| all 900, + control type + log(AADT), unweighted | **0.891** | 0.817, 0.979 |
| signalized only (n=635, 411 KSI), unweighted | **0.869** | 0.798, 0.952 |
| signalized only, IPW | **0.815** | 0.703, 0.951 |
| signalized only, + log(AADT), unweighted | **0.889** | 0.816, 0.975 |
| signalized only, offset log(mu_spf), unweighted | 1.039 | 0.949, 1.132 |
| Critical + High — *the essay's 0.92, selection-inflated* | 0.901 | 0.825, 0.980 |

Restricting to signalized intersections restricts on a design feature, not on the
crash count, so it carries none of the collider problem that Critical + High
does. It gives the same answer as covariate adjustment: 0.87 unweighted, 0.82
weighted.

The one specification that nulls the association offsets by `log(mu_spf)`
(1.039). That conditions on a value fitted to the same crash counts — the
objection `CLAUDE.md` already makes against `eb_ksi`, whose median EB weight is
0.99. It is not clean evidence of no association any more than 0.90 was clean
evidence of one.

## Two readings checked and discarded

**The non-monotone quintiles that motivated a spline are a frame mismatch.** The
cited 1.62, 3.51, 2.02, 3.00 reproduce exactly on all 900 rows, population
offset, IPW-weighted, no covariates — the same frame that yields the linear
1.346. Inside Critical + High the quintiles are 1.08, 0.96, 1.05, 0.66. There was
no non-monotonicity in the analysis frame, and the spline was cancelled.

**The offset disagreement is not a traffic gradient.** An earlier reading of this
work attributed the gap between the population-offset 0.901 and the SPF-offset
1.034 to traffic exposure. It does not survive. Raw AADT carries no circularity
objection, and adjusting for it moves the estimate to 0.820 (0.751, 0.889) —
away from the null, not toward it. Only the crash-fitted quantities null the
association. That reading is retracted.

## Two corrections to the record

**The 0.96 IPW estimate does not reproduce.** All four weight/SE combinations
give RR 0.904: `var_weights` model-based (0.836, 0.977), `freq_weights`
model-based (0.836, 0.977), `freq_weights` + HC1 (0.838, 0.974), `var_weights` +
HC1 (0.832, 0.981). `freq_weights` does inflate `df_resid` from 396 to 490, but
the point estimate is unchanged and the HC1 interval is slightly narrower than
the bootstrap, not half its width. Record 0.96 (0.87, 1.08) as unreproduced.

**Draft 3 line 73 cites the wrong frame.** "The 400 highest-risk intersections …
0.92 (0.84, 1.00)" is the n=368 tract-matched subset. The 400-row value is 0.901
(0.825, 0.980).

## Caveats

Critical + High is cut on `eb_ksi`, which is outcome-derived, so every estimate
from that frame is relative to expected rather than a superpopulation estimand.
That is the caveat that turned out to carry the whole result.

Two of the 400 sites have `pop_800m == 0` and carry 3 KSI; `log_pop` arrives
floored at log(100), which invents a denominator of 100 residents. Excluding them
gives 0.907 (0.833, 0.983) unweighted, against 0.901 floored. Nothing turns on it.

Control type in Critical + High is 399 Signalized and 1 All Way, so that
adjustment is very nearly vacuous inside the frame; it is kept only for
continuity with the published estimates.

These are ecological, area-level associations. Exposure confounding is unresolved
throughout — none of these specifications measures how many people walk through
these intersections, which is the quantity the essay is about.
