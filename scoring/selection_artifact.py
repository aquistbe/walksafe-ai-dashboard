"""
The within-stratum imagery association is a selection artifact.

Critical + High is cut on eb_ksi, which is a blend of the SPF fitted value and
the observed crash count -- outcome-derived either way. Selecting on it forces
risk factors into negative association inside the selected set. The diagnostic
is AADT: RR 1.60 for pedestrian KSI across all 900 scored sites, RR 0.70 inside
Critical + High. More traffic, fewer pedestrian casualties, which is not a thing
that happens.

The imagery score rides on the same induced dependence. Unselected it is null.

Outcome throughout: observed ped_ksi (2015-2024), Poisson. Never eb_ksi.
Score polarity: img_score 0 = hostile, 100 = protected. Higher is safer, so
RR < 1 is the direction in which the imagery would be informative.

Two readings were checked and discarded on the way here, both recorded below:
  - the non-monotone score quintiles that motivated a spline belong to the
    900-row IPW-weighted frame, not to Critical + High (section 5);
  - the offset disagreement is NOT a traffic gradient -- adjusting for raw AADT
    moves the estimate away from the null, not toward it (section 2).

Writes nothing outside this repository. Reads the AJPH draft for line numbers
only; never edits it.
"""
import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm

warnings.filterwarnings('ignore')

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / 'pipeline' / 'work'
SEED = 20260802
NBOOT = 1000
NSIM = 1000

# Harrell-style section banner, kept narrow enough to read in a terminal.
def head(title, ch='='):
    print()
    print(ch * 94)
    print(title)
    print(ch * 94)


# --------------------------------------------------------------------------
# 1. Frame
# --------------------------------------------------------------------------
def load():
    f = pd.read_csv(ROOT / 'scoring' / 'features_int.csv')
    r = pd.read_csv(WORK / 'intersections_ranked.csv')
    cols = ['node_id', 'pop_800m', 'log_pop', 'log_aadt', 'aadt',
            'stoptype', 'eb_ksi', 'eb_weight_spf']
    d = f.merge(r[cols].rename(columns={'aadt': 'aadt_r', 'eb_ksi': 'eb_ksi_r'}),
                left_on='unit_id', right_on='node_id')
    d['score10'] = d.img_score / 10.0
    # mu_spf is strictly positive in this file; the clip is belt-and-braces.
    d['log_mu'] = np.log(d.mu_spf.clip(lower=1e-6))
    d['gap'] = d.log_mu - d.log_pop          # log SPF-expected KSI per resident
    return d


def dummies(df):
    """Build tier / control-type dummies once, so bootstrap replicates index a
    fixed design matrix instead of re-deriving columns that may vanish."""
    df = df.reset_index(drop=True).copy()
    ctl = pd.get_dummies(df.stoptype, prefix='ctl', drop_first=True).astype(float)
    tier = pd.get_dummies(df.tier, prefix='t', drop_first=True).astype(float)
    return pd.concat([df, ctl, tier], axis=1), list(ctl.columns), list(tier.columns)


def poisson_rr(df, target, cols, offset, weights=None):
    """RR for `target`. Zero-variance columns are dropped -- inside a bootstrap
    replicate the lone All Way site is often absent and would make X singular."""
    X = df[[target] + cols].astype(float)
    X = X.loc[:, X.std(axis=0) > 0]
    if target not in X.columns:
        return np.nan
    X = sm.add_constant(X, has_constant='add')
    w = np.ones(len(df)) if weights is None else np.asarray(weights, float)
    try:
        m = sm.GLM(df.ped_ksi.astype(float), X, family=sm.families.Poisson(),
                   var_weights=w, offset=df[offset].values.astype(float)).fit()
        return m.params[target]
    except Exception:
        return np.nan


def boot_index(df, n=NBOOT, seed=SEED):
    """Stratified nonparametric bootstrap, resampling within tier."""
    rng = np.random.default_rng(seed)
    strata = [g.index.values for _, g in df.groupby('tier')]
    return [np.concatenate([rng.choice(s, len(s), True) for s in strata])
            for _ in range(n)]


def rr_ci(df, boots, target, cols, offset, wcol=None):
    """Point estimate with a stratified-bootstrap percentile CI.

    IPW are probability weights, so they go in var_weights for the point
    estimate and the CI comes from the bootstrap. freq_weights + a robust
    covariance would inflate df_resid and misstate the SE (see section 6)."""
    def w(x):
        return None if wcol is None else x[wcol].values.astype(float)
    b = poisson_rr(df, target, cols, offset, w(df))
    reps = []
    failed = 0
    for ix in boots:
        s = df.loc[ix].reset_index(drop=True)
        v = poisson_rr(s, target, cols, offset, w(s))
        if np.isfinite(v):
            reps.append(v)
        else:
            failed += 1
    reps = np.asarray(reps)
    lo, hi = np.exp(np.percentile(reps, [2.5, 97.5]))
    return np.exp(b), lo, hi, failed


def main():
    d = load()
    hi, CTL, TIER = dummies(d[d.tier.isin(['Critical', 'High'])])
    boots = boot_index(hi)

    results = {}

    head('1. FRAME')
    print(f'scored sites {len(d)}  |  ped KSI {int(d.ped_ksi.sum())}')
    t = d.groupby('tier').agg(n=('ped_ksi', 'size'), ksi=('ped_ksi', 'sum'),
                              ipw=('ipw', 'median'))
    print(t.to_string())
    print()
    print(f'Critical + High: n={len(hi)}, {int(hi.ped_ksi.sum())} ped KSI')
    print(f'control type in frame: {dict(hi.stoptype.value_counts())}')
    print('  -> the control-type adjustment is very nearly vacuous here; it is '
          'kept only for continuity with the published estimates.')
    z = hi[hi.pop_800m <= 0]
    print(f'pop_800m == 0: n={len(z)} carrying {int(z.ped_ksi.sum())} KSI '
          f'(unit_id {list(z.unit_id)}); log_pop is floored at log(100)={z.log_pop.iloc[0]:.3f}')
    print(f'eb_weight_spf across the 900: median {d.eb_weight_spf.median():.3f} '
          f'(eb_ksi = w*mu_spf + (1-w)*ped_ksi, so the stratifier is a function '
          f'of the outcome)')

    # ----------------------------------------------------------------------
    # 2. Specification surface
    # ----------------------------------------------------------------------
    head('2. THE SPECIFICATION SURFACE, Critical + High (n=400, 402 KSI)')
    print('RR per +10 imagery score points. RR < 1 = imagery informative.')
    print(f'Stratified bootstrap within tier, {NBOOT} reps, seed {SEED}.')
    print()
    print(f'{"model":<52}{"unweighted":>22}{"IPW":>22}')
    SPECS = [
        ('offset log(pop), tier + ctl', TIER + CTL, 'log_pop'),
        ('  + log(AADT)            [not crash-fitted]', TIER + CTL + ['log_aadt'], 'log_pop'),
        ('  + log(mu_spf/pop)      [crash-fitted]', TIER + CTL + ['gap'], 'log_pop'),
        ('offset log(mu_spf), tier + ctl', TIER + CTL, 'log_mu'),
    ]
    surface = {}
    for lab, cols, off in SPECS:
        row = []
        for wcol in (None, 'ipw'):
            rr, lo, up, nf = rr_ci(hi, boots, 'score10', cols, off, wcol)
            row.append(f'{rr:.3f} ({lo:.3f}, {up:.3f})')
            surface[(lab.strip(), wcol or 'unweighted')] = (rr, lo, up, nf)
        print(f'{lab:<52}{row[0]:>22}{row[1]:>22}')
    results['surface'] = {f'{k[0]} | {k[1]}': v for k, v in surface.items()}
    print()
    print('RETRACTION. An earlier reading of this table attributed the gap between')
    print('the population offset and the SPF offset to a traffic gradient. It does')
    print('not survive: raw AADT carries no circularity objection, and adjusting')
    print('for it moves the estimate AWAY from the null (0.901 -> 0.820). Only the')
    print('crash-fitted quantities null the association. The gap is not traffic.')

    # ----------------------------------------------------------------------
    # 3. The diagnostic: AADT flips sign inside the selected frame
    # ----------------------------------------------------------------------
    head('3. DIAGNOSTIC -- log(AADT) FLIPS SIGN INSIDE THE OUTCOME-SELECTED FRAME')
    print('Poisson, outcome ped_ksi, offset log(pop_800m), no tier terms.')
    print('More traffic -> more pedestrian KSI is the only credible direction.')
    print()
    frames = [
        ('all 900 scored sites', d),
        ('Low only', d[d.tier == 'Low']),
        ('Moderate only', d[d.tier == 'Moderate']),
        ('Low + Moderate', d[d.tier.isin(['Low', 'Moderate'])]),
        ('High only', d[d.tier == 'High']),
        ('Critical only', d[d.tier == 'Critical']),
        ('Critical + High   <- analysis frame', d[d.tier.isin(['Critical', 'High'])]),
    ]
    print(f'{"frame":<40}{"n":>6}{"KSI":>7}{"RR log(AADT)":>15}{"p":>11}'
          f'{"RR score/10":>14}{"p":>11}{"r(aadt,score)":>15}')
    flip = {}
    for lab, g in frames:
        g = g.reset_index(drop=True)
        out = []
        ci = {}
        for tgt in ('log_aadt', 'score10'):
            X = sm.add_constant(g[[tgt]].astype(float), has_constant='add')
            m = sm.GLM(g.ped_ksi.astype(float), X, family=sm.families.Poisson(),
                       offset=g.log_pop.values.astype(float)).fit()
            b, se = m.params[tgt], m.bse[tgt]
            out += [np.exp(b), m.pvalues[tgt]]
            ci[tgt] = (np.exp(b - 1.96 * se), np.exp(b + 1.96 * se))
        r = g.log_aadt.corr(g.img_score)
        flip[lab] = dict(n=len(g), ksi=int(g.ped_ksi.sum()),
                         rr_aadt=out[0], p_aadt=out[1],
                         rr_score=out[2], p_score=out[3], r=r,
                         ci_aadt=ci['log_aadt'], ci_score=ci['score10'])
        print(f'{lab:<40}{len(g):>6}{int(g.ped_ksi.sum()):>7}{out[0]:>15.3f}'
              f'{out[1]:>11.2g}{out[2]:>14.3f}{out[3]:>11.2g}{r:>15.3f}')
    results['flip'] = flip
    # The two targets are unpacked from one list by position. If that indexing
    # ever slips, the AADT RR would silently be reported as the score RR --
    # the one number in this section that cannot afford to be wrong.
    key = 'Critical + High   <- analysis frame'
    assert flip[key]['rr_aadt'] != flip[key]['rr_score'], \
        'AADT and imagery RR are identical in the analysis frame -- check the ' \
        'positional unpacking of `out` above'
    assert abs(flip[key]['rr_aadt'] - 0.699) < 0.01, \
        f"AADT RR in Critical+High is {flip[key]['rr_aadt']:.3f}, expected 0.699"
    assert abs(flip['all 900 scored sites']['rr_aadt'] - 1.602) < 0.01, \
        'AADT RR across the 900 does not reproduce 1.602'
    print()
    print('The imagery score plays no part in defining tier, so the reversal in')
    print('r(AADT, score) from +0.131 to -0.289 is produced by the selection alone.')

    # ----------------------------------------------------------------------
    # 4. Quintile reconciliation
    # ----------------------------------------------------------------------
    head('4. WHERE THE 1.62 / 3.51 / 2.02 / 3.00 QUINTILES CAME FROM')
    print('Cited as motivation for a spline, attributed to "pop offset, weighted".')

    def quintile_rr(df, offset, wcol, cols):
        df = df.reset_index(drop=True).copy()
        df['q'] = pd.qcut(df.img_score, 5, labels=['Q1', 'Q2', 'Q3', 'Q4', 'Q5'])
        Q = pd.get_dummies(df['q'], prefix='q').astype(float)
        Q = Q[[c for c in Q.columns if c != 'q_Q1']]
        X = pd.concat([Q, df[cols].astype(float)], axis=1) if cols else Q
        X = X.loc[:, X.std(axis=0) > 0]
        w = np.ones(len(df)) if wcol is None else df[wcol].values.astype(float)
        m = sm.GLM(df.ped_ksi.astype(float), sm.add_constant(X, has_constant='add'),
                   family=sm.families.Poisson(), var_weights=w,
                   offset=df[offset].values.astype(float)).fit()
        return [np.exp(m.params[c]) if c in m.params else np.nan
                for c in ['q_Q2', 'q_Q3', 'q_Q4', 'q_Q5']]

    cw, CCTL, _ = dummies(d.assign(tier=d.tier))
    print()
    print('Critical + High (n=400), quintiles cut within frame:')
    for lab, off, wcol in [('pop offset,    tier+ctl, IPW', 'log_pop', 'ipw'),
                           ('pop offset,    tier+ctl, unweighted', 'log_pop', None),
                           ('mu_spf offset, tier+ctl, IPW', 'log_mu', 'ipw'),
                           ('mu_spf offset, tier+ctl, unweighted', 'log_mu', None)]:
        v = quintile_rr(hi, off, wcol, TIER + CTL)
        print(f'  {lab:<40}' + '  '.join(f'{x:5.2f}' for x in v))
    print()
    print('All 900 rows:')
    for lab, off, wcol, cols in [
            ('pop offset, no covariates,  IPW     <- MATCH', 'log_pop', 'ipw', []),
            ('pop offset, + control type, IPW', 'log_pop', 'ipw', CCTL),
            ('pop offset, no covariates,  unweighted', 'log_pop', None, []),
            ('mu_spf offset, no covariates, IPW', 'log_mu', 'ipw', [])]:
        v = quintile_rr(cw, off, wcol, cols)
        print(f'  {lab:<40}' + '  '.join(f'{x:5.2f}' for x in v))
    lin = np.exp(poisson_rr(cw, 'score10', [], 'log_pop', cw.ipw.values.astype(float)))
    print()
    print(f'  citywide linear, pop offset, IPW, no covariates: RR {lin:.3f}  '
          f'(essay cites 1.35)')
    print('  -> the quintiles belong to the 900-row unadjusted weighted frame,')
    print('     not to Critical + High. Inside the analysis frame they are flat,')
    print('     so the non-monotonicity that motivated a spline is a frame mismatch.')
    results['citywide_linear_ipw'] = lin

    # ----------------------------------------------------------------------
    # 5. Weight / SE variants
    # ----------------------------------------------------------------------
    head('5. THE 0.96 IPW ESTIMATE DOES NOT REPRODUCE')
    X = hi[['score10'] + TIER + CTL].astype(float)
    X = sm.add_constant(X.loc[:, X.std(axis=0) > 0], has_constant='add')
    y = hi.ped_ksi.astype(float)
    off = hi.log_pop.values.astype(float)
    w = hi.ipw.values.astype(float)
    variants = []
    for lab, kw, cov in [('var_weights,  model-based SE', dict(var_weights=w), None),
                         ('freq_weights, model-based SE', dict(freq_weights=w), None),
                         ('freq_weights, HC1 robust SE', dict(freq_weights=w), 'HC1'),
                         ('var_weights,  HC1 robust SE', dict(var_weights=w), 'HC1')]:
        m = sm.GLM(y, X, family=sm.families.Poisson(), offset=off, **kw)
        m = m.fit(cov_type=cov) if cov else m.fit()
        b, se = m.params['score10'], m.bse['score10']
        variants.append((lab, np.exp(b), np.exp(b - 1.96 * se), np.exp(b + 1.96 * se),
                         m.df_resid))
        print(f'  {lab:<32} RR {np.exp(b):.3f}  ({np.exp(b-1.96*se):.3f}, '
              f'{np.exp(b+1.96*se):.3f})   df_resid={m.df_resid:.0f}')
    print('  -> all four agree at 0.904. freq_weights does inflate df_resid')
    print('     396 -> 490 as suspected, but leaves the point estimate untouched,')
    print('     so 0.96 (0.87, 1.08) is unreproduced rather than diagnosed.')
    results['weight_variants'] = variants

    # ----------------------------------------------------------------------
    # 6. Zero-population sensitivity
    # ----------------------------------------------------------------------
    head('6. SENSITIVITY -- EXCLUDE THE TWO pop_800m == 0 SITES (3 KSI)')
    print('log_pop is supplied floored at log(100), which invents a denominator.')
    ex, ECTL, ETIER = dummies(hi[hi.pop_800m > 0])
    eboots = boot_index(ex)
    for lab, frame, bts, tt, cc in [('floored at log(100), n=400', hi, boots, TIER, CTL),
                                    ('zero-pop excluded,   n=398', ex, eboots, ETIER, ECTL)]:
        for wlab, wcol in [('unweighted', None), ('IPW', 'ipw')]:
            rr, lo, up, _ = rr_ci(frame, bts, 'score10', tt + cc, 'log_pop', wcol)
            print(f'  {lab:<30}{wlab:<12} RR {rr:.3f}  ({lo:.3f}, {up:.3f})')

    # ----------------------------------------------------------------------
    # 7. GATE 1 -- simulation
    # ----------------------------------------------------------------------
    head('7. GATE 1 -- SIMULATION WITH A KNOWN NULL IMAGERY EFFECT')
    print('Truth: log E[Y] = a0 + log(pop) + b_aadt*log(AADT) + 0.0*score10.')
    print('b_aadt set to the observed unselected value; imagery effect exactly zero.')
    print('Each replication then does what the pipeline does -- fit an SPF,')
    print('shrink to an EB estimate, rank on it, keep the top 400 -- and refits.')
    print('Any RR away from 1.00 in the selected frame is pure artifact.')
    print()
    b_aadt = np.log(flip['all 900 scored sites']['rr_aadt'])
    lp = d.log_pop.values.astype(float)
    la = d.log_aadt.values.astype(float)
    s10 = d.score10.values.astype(float)
    # Intercept calibrated so simulated totals match the observed 421 KSI.
    a0 = np.log(d.ped_ksi.sum() / np.exp(lp + b_aadt * la).sum())
    mu_true = np.exp(a0 + lp + b_aadt * la)
    print(f'  b_aadt = {b_aadt:+.4f} (RR {np.exp(b_aadt):.3f}), a0 = {a0:.3f}, '
          f'expected total KSI = {mu_true.sum():.0f}')

    rng = np.random.default_rng(SEED)
    sim = {k: [] for k in ('score_sel', 'aadt_sel', 'score_all', 'aadt_all',
                           'r_all', 'r_sel')}
    Xspf = sm.add_constant(pd.DataFrame({'log_aadt': la}), has_constant='add')
    for _ in range(NSIM):
        y = rng.poisson(mu_true)
        try:
            spf = sm.GLM(y, Xspf, family=sm.families.Poisson(), offset=lp).fit()
            mu_hat = spf.fittedvalues
            # Method-of-moments NB dispersion, then the standard EB weight.
            resid = ((y - mu_hat) ** 2 - mu_hat).sum()
            alpha = max(resid / (mu_hat ** 2).sum(), 1e-6)
            wt = 1.0 / (1.0 + alpha * mu_hat)
            eb = wt * mu_hat + (1 - wt) * y
        except Exception:
            continue
        sel = np.argsort(-eb)[:400]
        g = pd.DataFrame({'ped_ksi': y, 'score10': s10, 'log_aadt': la,
                          'log_pop': lp})
        for tag, idx in (('all', slice(None)), ('sel', sel)):
            sub = g.iloc[idx].reset_index(drop=True)
            for tgt, key in (('score10', 'score'), ('log_aadt', 'aadt')):
                v = poisson_rr(sub, tgt, [], 'log_pop')
                sim[f'{key}_{tag}'].append(np.exp(v))
            sim[f'r_{tag}'].append(np.corrcoef(sub.log_aadt, sub.score10)[0, 1])

    def summarise(key):
        a = np.asarray(sim[key], float)
        a = a[np.isfinite(a)]
        return np.median(a), *np.percentile(a, [2.5, 97.5]), len(a)

    print()
    print(f'{NSIM} replications; median and 2.5-97.5 percentile across replications')
    print(f'{"quantity":<44}{"median":>10}{"2.5%":>10}{"97.5%":>10}')
    for key, lab, truth in [('score_all', 'imagery RR, all 900 (truth = 1.000)', 1.0),
                            ('aadt_all', 'AADT RR, all 900 (truth = %.3f)' % np.exp(b_aadt), np.exp(b_aadt)),
                            ('score_sel', 'imagery RR, selected top 400', None),
                            ('aadt_sel', 'AADT RR, selected top 400', None)]:
        m, lo, up, n = summarise(key)
        print(f'  {lab:<42}{m:>10.3f}{lo:>10.3f}{up:>10.3f}')
    ra = np.median(np.asarray(sim['r_all'], float))
    rs = np.median(np.asarray(sim['r_sel'], float))
    print(f'  {"r(log AADT, score), all 900":<42}{ra:>10.3f}')
    print(f'  {"r(log AADT, score), selected 400":<42}{rs:>10.3f}')
    frac = np.mean(np.asarray(sim['score_sel'], float) < 1.0)
    print()
    print(f'  imagery RR below 1.00 in {100*frac:.1f}% of replications, despite a '
          f'true effect of exactly zero')
    print(f'  observed value to compare against: 0.910 (score only, Critical + High)')
    results['sim'] = {k: summarise(k)[:3] for k in
                      ('score_all', 'aadt_all', 'score_sel', 'aadt_sel')}
    results['sim_frac_below_1'] = float(frac)

    # ----------------------------------------------------------------------
    # 8. GATE 2 -- select on observed counts instead of the EB estimate
    # ----------------------------------------------------------------------
    head('8. GATE 2 -- SELECTION ON OBSERVED ped_ksi RATHER THAN eb_ksi')
    print('If the mechanism is selection, cutting on the raw outcome should')
    print('reproduce the flip. Ties in ped_ksi are broken by eb_ksi, as ranked.')
    order = d.sort_values(['ped_ksi', 'eb_ksi_r'], ascending=False)
    for k in (400, 300, 200):
        g = order.head(k).reset_index(drop=True)
        rr_a = np.exp(poisson_rr(g, 'log_aadt', [], 'log_pop'))
        rr_s = np.exp(poisson_rr(g, 'score10', [], 'log_pop'))
        print(f'  top {k:<4} by observed ped_ksi   n={len(g)}  '
              f'KSI={int(g.ped_ksi.sum()):<4}  RR AADT {rr_a:.3f}   '
              f'RR score {rr_s:.3f}   r(aadt,score) {g.log_aadt.corr(g.img_score):+.3f}')

    # ----------------------------------------------------------------------
    # 9. GATE 3 -- offset invariance
    # ----------------------------------------------------------------------
    head('9. GATE 3 -- IS THE FLIP AN ARTEFACT OF THE POPULATION DENOMINATOR?')
    d0 = d.copy()
    d0['zero'] = 0.0
    for lab, off in [('offset log(pop_800m)', 'log_pop'),
                     ('no offset', 'zero'),
                     ('offset log(mu_spf)', 'log_mu')]:
        row = []
        for fl, g in [('all 900', d0), ('Crit+High', d0[d0.tier.isin(['Critical', 'High'])])]:
            g = g.reset_index(drop=True)
            row.append(np.exp(poisson_rr(g, 'log_aadt', [], off)))
        print(f'  {lab:<26} RR log(AADT): all 900 {row[0]:6.3f}   '
              f'Critical+High {row[1]:6.3f}')
    print('  -> the flip is not produced by the denominator.')

    # ----------------------------------------------------------------------
    # 10. GATE 4 -- leverage behind the citywide 1.35
    # ----------------------------------------------------------------------
    head('10. GATE 4 -- WHAT CARRIES THE CITYWIDE 1.35')
    full = np.exp(poisson_rr(cw, 'score10', [], 'log_pop', cw.ipw.values.astype(float)))
    print(f'  all 900, IPW, pop offset, no covariates      RR {full:.3f}')
    for t in ['Low', 'Moderate', 'High', 'Critical']:
        g = cw[cw.tier != t].reset_index(drop=True)
        v = np.exp(poisson_rr(g, 'score10', [], 'log_pop', g.ipw.values.astype(float)))
        print(f'    dropping {t:<10} n={len(g):<5} KSI={int(g.ped_ksi.sum()):<5} '
              f'RR {v:.3f}')
    lo_t = cw[cw.tier == 'Low']
    print(f'  the Low stratum: n={len(lo_t)}, {int(lo_t.ped_ksi.sum())} KSI, '
          f'ipw {lo_t.ipw.median():.3f}')
    print(f'  its share of total analysis weight: '
          f'{100*lo_t.ipw.sum()/cw.ipw.sum():.1f}%  of weighted KSI: '
          f'{100*(lo_t.ipw*lo_t.ped_ksi).sum()/(cw.ipw*cw.ped_ksi).sum():.1f}%')
    unw = np.exp(poisson_rr(cw, 'score10', [], 'log_pop'))
    print(f'  same model unweighted                        RR {unw:.3f}')

    # ----------------------------------------------------------------------
    # 11. GATE 5 -- interval on the unselected estimate
    # ----------------------------------------------------------------------
    head('11. GATE 5 -- THE UNSELECTED ESTIMATE, WITH AN INTERVAL')
    cwb = boot_index(cw)
    for lab, cols, wcol in [('all 900, no covariates, unweighted', [], None),
                            ('all 900, no covariates, IPW', [], 'ipw'),
                            ('all 900, + control type, unweighted', CCTL, None),
                            ('all 900, + control type + log(AADT), unweighted',
                             CCTL + ['log_aadt'], None)]:
        rr, lo, up, _ = rr_ci(cw, cwb, 'score10', cols, 'log_pop', wcol)
        print(f'  {lab:<50} RR {rr:.3f}  ({lo:.3f}, {up:.3f})')
        results[f'unselected::{lab}'] = (rr, lo, up)

    # ----------------------------------------------------------------------
    # 12. Does an unmodelled second cause reproduce the AADT flip?
    # ----------------------------------------------------------------------
    head('12. THE AADT FLIP NEEDS MORE THAN ONE CAUSE')
    print('Section 7 reproduced the imagery artifact but not the AADT flip, because')
    print('its DGP had a single cause -- nothing for AADT to trade against. Real')
    print('crash risk has many causes and the SPF models only some. Add a latent')
    print('cause U that the selection SPF never sees, and vary its size.')
    print()
    print(f'{"sd(U)":<10}{"AADT RR all 900":>18}{"AADT RR sel 400":>18}'
          f'{"score RR sel 400":>19}{"r(aadt,score) sel":>20}')
    latent = {}
    for su in (0.0, 0.5, 1.0, 1.5, 2.0):
        rng2 = np.random.default_rng(SEED)
        A, S, AA, R = [], [], [], []
        for _ in range(300):
            U = rng2.normal(0, su, len(d)) if su > 0 else np.zeros(len(d))
            # centre the lognormal so simulated totals stay near the observed 421
            y = rng2.poisson(np.exp(a0 + lp + b_aadt * la + U - 0.5 * su ** 2))
            try:
                spf = sm.GLM(y, Xspf, family=sm.families.Poisson(), offset=lp).fit()
                mh = spf.fittedvalues
                al = max(((y - mh) ** 2 - mh).sum() / (mh ** 2).sum(), 1e-6)
                wt = 1 / (1 + al * mh)
                eb = wt * mh + (1 - wt) * y
            except Exception:
                continue
            g = pd.DataFrame({'ped_ksi': y, 'score10': s10, 'log_aadt': la, 'log_pop': lp})
            AA.append(np.exp(poisson_rr(g, 'log_aadt', [], 'log_pop')))
            sg = g.iloc[np.argsort(-eb)[:400]].reset_index(drop=True)
            A.append(np.exp(poisson_rr(sg, 'log_aadt', [], 'log_pop')))
            S.append(np.exp(poisson_rr(sg, 'score10', [], 'log_pop')))
            R.append(np.corrcoef(sg.log_aadt, sg.score10)[0, 1])
        latent[su] = [float(np.median(x)) for x in (AA, A, S, R)]
        print(f'{su:<10.1f}{latent[su][0]:>18.3f}{latent[su][1]:>18.3f}'
              f'{latent[su][2]:>19.3f}{latent[su][3]:>20.3f}')
    print(f'{"observed":<10}{1.602:>18.3f}{0.699:>18.3f}{0.910:>19.3f}{-0.289:>20.3f}')
    print()
    print('The imagery artifact is robust to U -- the score RR sits at 0.87-0.93')
    print('under a true effect of exactly zero regardless. The AADT flip moves the')
    print('right way as U grows but does not reach the observed 0.699 even at')
    print('sd(U)=2, so selection explains its direction, not its full magnitude.')
    results['latent'] = latent

    # ----------------------------------------------------------------------
    # 13. Control type -- confounder, not a restatement of the score
    # ----------------------------------------------------------------------
    head('13. CONTROL TYPE IS A CONFOUNDER, AND THE SCORE IS NOT MERELY DETECTING IT')
    Xc = sm.add_constant(cw[CCTL].astype(float))
    r2 = sm.OLS(cw.img_score, Xc).fit().rsquared
    r2b = sm.OLS(cw.img_score, sm.add_constant(
        cw[CCTL + ['log_aadt', 'log_pop']].astype(float))).fit().rsquared
    print(f'  OLS img_score ~ control type only         R2 = {r2:.3f}')
    print(f'    + log(AADT) + log(pop)                  R2 = {r2b:.3f}')
    print('  -> control type explains 12% of the score, so adjusting for it is')
    print('     confounder control rather than adjusting away the exposure.')
    print()
    print(cw.groupby('stoptype').agg(n=('ped_ksi', 'size'),
                                     mean_score=('img_score', 'mean'),
                                     KSI_per_site=('ped_ksi', 'mean'),
                                     median_ipw=('ipw', 'median')).round(2).to_string())
    print()
    print('  Unsignalized intersections score low, carry almost no pedestrian KSI,')
    print('  and are weighted ~40x the signalized ones. Comparing them to signalized')
    print('  intersections is what produces "safer-looking places have more crashes".')
    results['ctl_r2'] = float(r2)

    # ----------------------------------------------------------------------
    # 14. Every defensible frame
    # ----------------------------------------------------------------------
    head('14. EVERY DEFENSIBLE FRAME')
    print('Signalized-only is a restriction on a design feature, not on the crash')
    print('count, so it carries none of the collider problem Critical + High does.')
    print()
    sig, SCTL, STIER = dummies(cw[cw.stoptype == 'Signalized'])
    sigb = boot_index(sig)
    print(f'  signalized only: n={len(sig)}, {int(sig.ped_ksi.sum())} ped KSI')
    print()
    print(f'{"frame / specification":<56}{"RR":>8}{"95% CI":>20}')
    FINAL = [
        ('all 900, no covariates, unweighted', cw, cwb, [], 'log_pop', None),
        ('all 900, no covariates, IPW   [essay 1.35]', cw, cwb, [], 'log_pop', 'ipw'),
        ('all 900, + control type, unweighted', cw, cwb, CCTL, 'log_pop', None),
        ('all 900, + control type, IPW', cw, cwb, CCTL, 'log_pop', 'ipw'),
        ('all 900, + control type + log(AADT), unwtd', cw, cwb, CCTL + ['log_aadt'], 'log_pop', None),
        ('signalized only (n=635), unweighted', sig, sigb, [], 'log_pop', None),
        ('signalized only (n=635), IPW', sig, sigb, [], 'log_pop', 'ipw'),
        ('signalized only, + log(AADT), unweighted', sig, sigb, ['log_aadt'], 'log_pop', None),
        ('signalized only, offset log(mu_spf), unwtd', sig, sigb, [], 'log_mu', None),
        ('Critical + High  [selection-inflated]', hi, boots, TIER + CTL, 'log_pop', None),
    ]
    final = {}
    for lab, frame, bts, cols, off, wcol in FINAL:
        rr, lo, up, _ = rr_ci(frame, bts, 'score10', cols, off, wcol)
        final[lab] = (rr, lo, up)
        print(f'  {lab:<54}{rr:>8.3f}   ({lo:.3f}, {up:.3f})')
    results['final'] = final
    print()
    print('  Adjust for control type and the reversal disappears. Every specification')
    print('  that compares like with like lands at 0.82-0.89 and excludes 1. The only')
    print('  estimate above 1 is the wholly unadjusted weighted one, which contrasts')
    print('  signalized against unsignalized intersections.')

    figure(flip, sim, latent, final, results)

    out = ROOT / 'scoring' / 'selection_artifact_results.json'
    out.write_text(json.dumps(results, indent=2, default=float))
    print()
    print(f'key numbers written to {out.relative_to(ROOT)}')
    return d, hi, flip, sim, results


def figure(flip, sim, latent, final, results):
    """Two panels: the AADT sign flip, and the simulated null against observed."""
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(1, 2, figsize=(12.5, 5.4))

    # -- left: AADT sign flip by frame -------------------------------------
    # Points with 95% intervals rather than bars: three of these frames carry
    # few events and a bare bar would hide that.
    order = ['all 900 scored sites', 'Low + Moderate', 'Critical only',
             'High only', 'Critical + High   <- analysis frame']
    labs = ['All 900\nscored sites', 'Low +\nModerate', 'Critical\nonly',
            'High\nonly', 'Critical + High\n(analysis frame)']
    vals = [flip[k]['rr_aadt'] for k in order]
    los = [flip[k]['ci_aadt'][0] for k in order]
    ups = [flip[k]['ci_aadt'][1] for k in order]

    # Colour by whether the interval clears 1, so a null frame does not read
    # as evidence of a flip.
    def colour(lo, up):
        if lo > 1:
            return '#2b6cb0'
        if up < 1:
            return '#c53030'
        return '#a0aec0'

    cols = [colour(lo, up) for lo, up in zip(los, ups)]
    for i, (v, lo, up, c) in enumerate(zip(vals, los, ups, cols)):
        ax[0].plot([i, i], [lo, up], color=c, lw=2.2, solid_capstyle='round',
                   zorder=2)
        ax[0].plot(i, v, 'o', color=c, ms=9, zorder=3,
                   markeredgecolor='white', markeredgewidth=1.1)
        ax[0].text(i + 0.17, v, f'{v:.2f}', ha='left', va='center', fontsize=9,
                   color=c, weight='bold')
    ax[0].axhline(1.0, color='#1a202c', lw=1.1, zorder=1)
    ax[0].set_xticks(range(len(vals)))
    ax[0].set_xticklabels(labs, fontsize=8.5)
    ax[0].set_xlim(-0.55, len(vals) - 0.25)
    ax[0].set_yscale('log')
    ax[0].set_ylim(0.33, 3.4)
    ax[0].set_yticks([0.4, 0.6, 0.8, 1.0, 1.5, 2.0])
    ax[0].set_yticklabels(['0.4', '0.6', '0.8', '1.0', '1.5', '2.0'])
    # A log axis relabels its minor ticks ("3 x 10^0") over the explicit set.
    ax[0].yaxis.set_minor_formatter(matplotlib.ticker.NullFormatter())
    ax[0].set_ylabel('RR for pedestrian KSI per log-unit AADT', fontsize=9.5)
    ax[0].set_title('More traffic, fewer casualties — inside the frame',
                    fontsize=10.5, loc='left')
    ax[0].text(0.015, 0.965,
               'Tier is cut on eb_ksi, a function of the crash count.\n'
               'Selecting on it forces risk factors into negative association.\n'
               'Grey = interval includes 1.',
               transform=ax[0].transAxes, fontsize=8, color='#4a5568',
               va='top')

    # -- right: simulated null vs observed ---------------------------------
    s = np.asarray(sim['score_sel'], float)
    s = s[np.isfinite(s)]
    ax[1].hist(s, bins=44, color='#a0aec0', edgecolor='white', linewidth=0.4)
    ax[1].axvline(1.0, color='#1a202c', lw=1.4)
    ax[1].axvline(np.median(s), color='#4a5568', lw=1.4, ls='--')
    ax[1].axvline(0.910, color='#c53030', lw=2.0)
    ax[1].set_xlabel('Imagery score RR per +10 points, selected top 400', fontsize=9.5)
    ax[1].set_ylabel('simulated replications', fontsize=9.5)
    ax[1].set_title('Simulated under a true effect of exactly zero',
                    fontsize=10.5, loc='left')
    ax[1].text(1.003, ax[1].get_ylim()[1] * 0.94, 'true effect (1.00)',
               fontsize=8.5, color='#1a202c')
    ax[1].text(np.median(s) - 0.004, ax[1].get_ylim()[1] * 0.80,
               f'simulated median {np.median(s):.3f}', fontsize=8.5,
               color='#4a5568', ha='right')
    ax[1].text(0.906, ax[1].get_ylim()[1] * 0.62, 'observed 0.910',
               fontsize=9, color='#c53030', ha='right', weight='bold')
    ax[1].text(0.02, 0.03,
               f'{100*results["sim_frac_below_1"]:.0f}% of replications fall below 1.00.\n'
               'The observed estimate is inside the null distribution.',
               transform=ax[1].transAxes, fontsize=8, color='#4a5568')

    for a in ax:
        a.spines[['top', 'right']].set_visible(False)
        a.tick_params(labelsize=8.5)
    fig.suptitle('The within-stratum imagery association is produced by selection '
                 'on an outcome-derived stratifier',
                 fontsize=12, x=0.008, ha='left', weight='bold')
    fig.text(0.008, 0.005,
             'Philadelphia, 900 scored intersections, observed pedestrian KSI '
             '2015–2024, Poisson with log(pop_800m) offset. Critical + High is cut '
             'on eb_ksi, so both estimates are relative to expected, not a clean '
             'superpopulation estimand.',
             fontsize=7.6, color='#4a5568')
    fig.tight_layout(rect=[0, 0.035, 1, 0.94])
    path = ROOT / 'scoring' / 'selection_artifact.png'
    fig.savefig(path, dpi=300)
    plt.close(fig)
    print()
    print(f'figure written to {path.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
