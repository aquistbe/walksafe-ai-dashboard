#!/usr/bin/env python3
"""Compare blind imagery scores against crash-based risk.

This is the analysis the whole pipeline exists to support: does a scorer that
has never seen crash data agree with observed pedestrian KSI?

The comparison is only valid for records produced in BLIND mode. The script
refuses to run on context-mode or mock output, because a correlation between
a crash-informed score and crash outcomes measures nothing.

Reported
--------
  * Spearman and Pearson correlation between imagery safety score and eb_ksi
  * The same, restricted to sites with usable imagery confidence
  * Disagreement quadrants, which are usually more interesting than rho:
        - dangerous-looking but few crashes  -> latent risk, or low foot traffic
        - benign-looking but many crashes    -> something imagery cannot see
                                                (speed, signal timing, volume)
  * Per-feature association with eb_ksi
  * Within-intersection heading dispersion, as a reliability check

Usage
-----
    python validate_scores.py
    python validate_scores.py --csv out.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import statistics as st
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
DEFAULT_RESULTS = HERE / "results"
DEFAULT_GEOJSON = REPO / "data" / "intersections.geojson"


# ---------------------------------------------------------------------------
# Statistics (no scipy dependency)
# ---------------------------------------------------------------------------


def _rank(xs: list[float]) -> list[float]:
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    ranks = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        avg = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def pearson(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    return num / (dx * dy) if dx and dy else None


def spearman(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < 3:
        return None
    return pearson(_rank(xs), _rank(ys))


def fisher_ci(r: float, n: int, alpha: float = 0.05) -> tuple[float, float] | None:
    """95% CI for a correlation via Fisher z."""
    if n < 4 or abs(r) >= 1:
        return None
    z = 0.5 * math.log((1 + r) / (1 - r))
    se = 1 / math.sqrt(n - 3)
    crit = 1.959963985 if abs(alpha - 0.05) < 1e-9 else 1.959963985
    lo, hi = z - crit * se, z + crit * se
    return (math.tanh(lo), math.tanh(hi))


def partial_spearman(
    xs: list[float], ys: list[float], zs: list[float]
) -> float | None:
    """Spearman correlation between x and y, controlling for z.

    Standard first-order partial correlation applied to ranks:
        r_xy.z = (r_xy - r_xz r_yz) / sqrt((1 - r_xz^2)(1 - r_yz^2))
    """
    if len(xs) < 5:
        return None
    rx, ry, rz = _rank(xs), _rank(ys), _rank(zs)
    r_xy = pearson(rx, ry)
    r_xz = pearson(rx, rz)
    r_yz = pearson(ry, rz)
    if r_xy is None or r_xz is None or r_yz is None:
        return None
    denom = math.sqrt(max(1e-12, (1 - r_xz**2) * (1 - r_yz**2)))
    return (r_xy - r_xz * r_yz) / denom


def exposure_adjusted_report(rows: list[dict]) -> None:
    """Does imagery predict risk beyond what exposure already explains?

    The unadjusted correlation is confounded: pedestrian infrastructure gets
    built where traffic and pedestrians are, so 'well equipped' and 'busy'
    are the same places, and busy places have more crashes. Three ways to
    look past that, none of them requiring a pedestrian count:

      1. Correlate imagery against the SPF residual — the part of observed
         risk the safety performance function did NOT predict from volume,
         road class, network position and land use.
      2. Partial correlation holding traffic volume constant.
      3. Stratify by control type, which is a strong proxy for road class.
    """
    print()
    print("=" * 68)
    print("EXPOSURE-ADJUSTED ASSOCIATION")
    print("=" * 68)
    print("  The unadjusted correlation above is confounded: infrastructure is")
    print("  installed where people walk and traffic runs, and those are the")
    print("  places with crashes. These views condition on that.")

    img = [r["img_score"] for r in rows]

    # --- 0. Observed counts vs SPF expectation ---------------------------
    #
    # This is the primary test. eb_ksi is a poor criterion here because the
    # empirical Bayes weight is high (median 0.99 in this dataset), so eb_ksi
    # is very nearly the SPF's own fitted value. Correlating imagery against
    # it mostly measures whether imagery can recognise an arterial.
    #
    # Observed counts carry the independent signal. Comparing them to the SPF
    # expectation is an SMR: does a site record more crashes than its traffic
    # volume, road class and network position predict, and does imagery see it?
    smr_rows = [
        r for r in rows
        if isinstance(r.get("mu_spf"), (int, float)) and r["mu_spf"] > 0
        and isinstance(r.get("ped_ksi"), (int, float))
    ]
    if len(smr_rows) >= 10:
        obs = [r["ped_ksi"] for r in smr_rows]
        exp = [r["mu_spf"] for r in smr_rows]
        # Variance-stabilised (Anscombe-like) residual; robust for small counts.
        resid = [(o - e) / math.sqrt(max(e, 0.5)) for o, e in zip(obs, exp)]
        ri = [r["img_score"] for r in smr_rows]
        rho = spearman(ri, resid)
        n_any = sum(1 for o in obs if o > 0)
        print()
        print(f"  0. PRIMARY: observed KSI vs SPF expectation            n = {len(smr_rows)}")
        print(f"     standardised residual (obs - exp)/sqrt(exp)")
        print(f"     sites with at least one observed KSI: {n_any}")
        if rho is not None:
            ci = fisher_ci(rho, len(smr_rows))
            ci_txt = f"   95% CI [{ci[0]:+.3f}, {ci[1]:+.3f}]" if ci else ""
            print(f"       Spearman rho  {rho:+.3f}{ci_txt}")
        if n_any < 25:
            print(f"     LOW POWER: only {n_any} sites have any observed KSI.")
            print("     Rare-count outcomes need several hundred sites to test.")

    # --- 1. SPF residual -------------------------------------------------
    res_rows = [
        r for r in rows
        if isinstance(r.get("mu_spf"), (int, float)) and r["mu_spf"] > 0 and r["eb_ksi"] > 0
    ]
    if len(res_rows) >= 10:
        ri = [r["img_score"] for r in res_rows]
        resid = [math.log(r["eb_ksi"] / r["mu_spf"]) for r in res_rows]
        rho = spearman(ri, resid)
        spread = st.pstdev(resid) if len(resid) > 1 else 0.0
        print()
        print(f"  1. vs EB residual, log(EB / SPF predicted)             n = {len(res_rows)}")
        if rho is not None:
            ci = fisher_ci(rho, len(res_rows))
            ci_txt = f"   95% CI [{ci[0]:+.3f}, {ci[1]:+.3f}]" if ci else ""
            print(f"       Spearman rho  {rho:+.3f}{ci_txt}")
        print(f"       SD of this residual: {spread:.4f}")
        if spread < 0.15:
            print("       NOTE: near-zero spread. Empirical Bayes shrinks each")
            print("       site onto the SPF prediction, so this residual is")
            print("       almost constant and cannot correlate with anything.")
            print("       Use test 0 (observed counts) instead.")
    else:
        print("\n  1. SPF residual: not enough sites with a usable mu_spf")

    # --- 2. Partial correlation, holding AADT constant --------------------
    aadt_rows = [r for r in rows if isinstance(r.get("aadt"), (int, float)) and r["aadt"] > 0]
    if len(aadt_rows) >= 10:
        pr = partial_spearman(
            [r["img_score"] for r in aadt_rows],
            [r["eb_ksi"] for r in aadt_rows],
            [math.log(r["aadt"]) for r in aadt_rows],
        )
        raw = spearman(
            [r["img_score"] for r in aadt_rows], [r["eb_ksi"] for r in aadt_rows]
        )
        print()
        print(f"  2. Holding traffic volume constant                     n = {len(aadt_rows)}")
        if raw is not None:
            print(f"       unadjusted        {raw:+.3f}")
        if pr is not None:
            print(f"       partial (log AADT) {pr:+.3f}")

    # --- 3. Within control type ------------------------------------------
    by_type: dict[str, list[dict]] = {}
    for r in rows:
        if r.get("stoptype"):
            by_type.setdefault(r["stoptype"], []).append(r)

    printed = False
    for stype, group in sorted(by_type.items(), key=lambda kv: -len(kv[1])):
        if len(group) < 10:
            continue
        if not printed:
            print()
            print("  3. Within control type (proxy for road class)")
            printed = True
        rho = spearman([r["img_score"] for r in group], [r["eb_ksi"] for r in group])
        if rho is not None:
            ci = fisher_ci(rho, len(group))
            ci_txt = f"  95% CI [{ci[0]:+.3f}, {ci[1]:+.3f}]" if ci else ""
            print(f"       {stype:<14} n = {len(group):3d}   rho {rho:+.3f}{ci_txt}")

    print()
    print("  If the unadjusted correlation is positive but these are negative,")
    print("  the imagery score is measuring real design risk and the raw")
    print("  association was confounded by exposure. Report both.")


def median(xs: list[float]) -> float:
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


# ---------------------------------------------------------------------------


def check_config_consistency(results_dir: Path) -> bool:
    """Warn if a results directory mixes scoring configurations.

    Resume-by-default makes this easy to do by accident: change --thinking or
    --model, rerun, and the new settings apply only to nodes that had not been
    scored yet. The directory then holds two incomparable populations.
    """
    from collections import Counter

    configs: Counter = Counter()
    for fp in results_dir.glob("*.json"):
        try:
            rec = json.loads(fp.read_text())
        except json.JSONDecodeError:
            continue
        if rec.get("status") != "OK":
            continue
        configs[
            (
                rec.get("model", "?"),
                rec.get("thinking", "unset"),
                rec.get("prompt_version", "?"),
                len((rec.get("imagery") or {}).get("headings", [])),
            )
        ] += 1

    if len(configs) <= 1:
        return True

    print()
    print("!" * 68)
    print("WARNING: this directory mixes scoring configurations.")
    print("Scores from different settings are not directly comparable.")
    print()
    for (model, thinking, prompt, nh), n in configs.most_common():
        print(f"  {n:4d} records   model={model}  thinking={thinking}  prompt={prompt}  headings={nh}")
    print()
    print("Rescore the minority group into the majority configuration, or")
    print("start a clean directory:")
    print("    python score_intersections.py --top50 --thinking high --outdir results_high")
    print("!" * 68)
    return False


def discrimination_report(rows: list[dict]) -> None:
    """Does the score actually distinguish between sites?

    A scorer that returns roughly the same number everywhere cannot correlate
    with anything, no matter how good the imagery is. Catch that before
    concluding 'imagery does not predict crashes'.
    """
    from collections import Counter

    scores = [r["img_score"] for r in rows]
    sds = [r["img_sd"] for r in rows]
    n = len(scores)

    mean = sum(scores) / n
    between = (sum((s - mean) ** 2 for s in scores) / n) ** 0.5
    within = sum(sds) / n if sds else 0.0

    counts = Counter(scores)
    modal_val, modal_n = counts.most_common(1)[0]
    n_zero_sd = sum(1 for s in sds if s == 0.0)

    print()
    print("Score discrimination (can this score separate sites at all?)")
    print(f"    range                     {min(scores):.1f} to {max(scores):.1f}")
    print(f"    between-site SD           {between:.2f}")
    print(f"    mean within-site SD       {within:.2f}   (spread across headings)")
    if within > 0:
        print(f"    ratio                     {between / within:.2f}")
    print(f"    distinct values           {len(counts)} across {n} sites")
    print(f"    most common value         {modal_val} appears {modal_n}x ({modal_n / n:.0%})")
    print(f"    sites with SD = 0         {n_zero_sd} ({n_zero_sd / n:.0%})")

    # How much is measurement error attenuating any correlation?
    #
    # The site-level score is the mean of `k` headings, so its error variance
    # is within_var / k. Reliability of that mean is
    #     R = (observed between-site var - error var) / observed between-site var
    # and an observed correlation is attenuated by sqrt(R). This says directly
    # whether adding headings could rescue a null result.
    k = st.mean([r.get("n_headings", 4) or 4 for r in rows]) if rows else 4
    obs_var = between**2
    err_var = (within**2) / k if k else 0.0
    if obs_var > err_var > 0:
        rel = (obs_var - err_var) / obs_var
        atten = math.sqrt(rel)
        print()
        print("    Measurement reliability")
        print(f"      headings per site       {k:.0f}")
        print(f"      reliability of the mean {rel:.3f}")
        print(f"      attenuation factor      {atten:.3f}")
        print(f"      -> a true correlation of 0.40 would be observed as {0.40 * atten:.3f}")
        for k2 in (8, 16):
            if k2 > k:
                ev = (within**2) / k2
                r2 = (obs_var - ev) / obs_var if obs_var > ev else 1.0
                print(f"      with {k2} headings: attenuation {math.sqrt(r2):.3f} "
                      f"({(math.sqrt(r2) / atten - 1) * 100:+.0f}% vs now)")
        if atten > 0.90:
            print("      Measurement error is NOT the limiting factor here.")
            print("      More headings will not rescue a null association.")

    problems = []
    if modal_n / n > 0.20:
        problems.append(f"{modal_n / n:.0%} of sites share one score — the model is anchoring")
    if n_zero_sd / n > 0.20:
        problems.append(
            f"{n_zero_sd / n:.0%} of sites scored identically across all headings, "
            "which is implausible for real imagery"
        )
    if within > 0 and between / within < 1.5:
        problems.append("between-site variation is close to within-site noise")
    if len(counts) < n / 3:
        problems.append("very few distinct values")

    if problems:
        print()
        print("    WARNING - this score may carry little information:")
        for p in problems:
            print(f"      - {p}")
        print("    A null correlation below may reflect the scorer, not the imagery.")
        print("    Try --thinking high, and check the per-feature results, which")
        print("    are often more discriminating than the composite score.")


def load(results_dir: Path, geojson_path: Path) -> list[dict]:
    gj = json.loads(geojson_path.read_text())
    props = {f["properties"]["node_id"]: f["properties"] for f in gj["features"]}

    rows: list[dict] = []
    n_mock = n_nonblind = 0

    for fp in sorted(results_dir.glob("*.json")):
        rec = json.loads(fp.read_text())
        if rec.get("mock"):
            n_mock += 1
            continue
        if rec.get("mode") and rec["mode"] != "blind":
            n_nonblind += 1
            continue
        if rec.get("status") != "OK":
            continue
        agg = rec.get("aggregate") or {}
        score = agg.get("safety_score_mean")
        if score is None:
            continue
        p = props.get(rec["node_id"])
        if not p:
            continue

        rows.append(
            {
                "node_id": rec["node_id"],
                "int_name": p.get("int_name"),
                "img_score": score,
                "img_sd": agg.get("safety_score_sd") or 0.0,
                "img_conf": agg.get("confidence_mean") or 0.0,
                "n_headings": agg.get("n_headings_scored") or 4,
                "eb_ksi": p.get("eb_ksi", 0.0),
                "mu_spf": p.get("mu_spf"),
                "ped_ksi": p.get("ped_ksi", 0),
                "risk_tier": p.get("risk_tier"),
                "stoptype": p.get("stoptype"),
                "on_hin": p.get("on_hin"),
                "aadt": p.get("aadt"),
                "pop_800m": p.get("pop_800m"),
                "features": agg.get("features", {}),
            }
        )

    if n_mock:
        print(f"NOTE: skipped {n_mock} mock records.")
    if n_nonblind:
        print(f"NOTE: skipped {n_nonblind} non-blind records (not valid for validation).")
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--results", type=Path, default=DEFAULT_RESULTS)
    ap.add_argument("--geojson", type=Path, default=DEFAULT_GEOJSON)
    ap.add_argument("--min-confidence", type=float, default=60.0)
    ap.add_argument("--csv", type=Path, help="Write the joined row-level table here")
    args = ap.parse_args()

    if not args.results.exists():
        print(f"No results at {args.results}")
        return 1

    check_config_consistency(args.results)

    rows = load(args.results, args.geojson)
    if len(rows) < 3:
        print(f"Only {len(rows)} usable blind records - need at least 3. Nothing to report.")
        return 1

    print()
    print("=" * 68)
    print(f"IMAGERY vs CRASH-BASED RISK   (n = {len(rows)} intersections)")
    print("=" * 68)

    discrimination_report(rows)

    img = [r["img_score"] for r in rows]
    eb = [r["eb_ksi"] for r in rows]

    rho = spearman(img, eb)
    r = pearson(img, eb)

    print()
    print("Correlation of imagery safety score with EB expected KSI")
    print("  (negative is the expected direction: safer-looking -> fewer crashes)")
    if rho is not None:
        ci = fisher_ci(rho, len(rows))
        ci_txt = f"  95% CI [{ci[0]:+.3f}, {ci[1]:+.3f}]" if ci else ""
        print(f"    Spearman rho  {rho:+.3f}{ci_txt}")
    if r is not None:
        print(f"    Pearson r     {r:+.3f}")

    hi = [x for x in rows if x["img_conf"] >= args.min_confidence]
    if len(hi) >= 3 and len(hi) < len(rows):
        rho_hi = spearman([x["img_score"] for x in hi], [x["eb_ksi"] for x in hi])
        if rho_hi is not None:
            print(f"    Spearman rho  {rho_hi:+.3f}   (confidence >= {args.min_confidence:.0f}, n = {len(hi)})")

    exposure_adjusted_report(rows)

    # ------------------------------------------------------------------
    # Disagreement quadrants
    # ------------------------------------------------------------------
    med_img = median(img)
    med_eb = median(eb)

    q = {"agree_safe": [], "agree_dangerous": [], "latent_risk": [], "imagery_blind": []}
    for x in rows:
        looks_bad = x["img_score"] < med_img
        crashes_high = x["eb_ksi"] > med_eb
        if looks_bad and crashes_high:
            q["agree_dangerous"].append(x)
        elif not looks_bad and not crashes_high:
            q["agree_safe"].append(x)
        elif looks_bad and not crashes_high:
            q["latent_risk"].append(x)
        else:
            q["imagery_blind"].append(x)

    n = len(rows)
    agree = len(q["agree_dangerous"]) + len(q["agree_safe"])
    print()
    print(f"Quadrants, split at medians (imagery {med_img:.1f}, eb_ksi {med_eb:.3f})")
    print(f"    agree, both dangerous     {len(q['agree_dangerous']):4d}")
    print(f"    agree, both benign        {len(q['agree_safe']):4d}")
    print(f"    looks bad, few crashes    {len(q['latent_risk']):4d}   <- latent risk / low exposure")
    print(f"    looks fine, many crashes  {len(q['imagery_blind']):4d}   <- imagery misses something")
    print(f"    concordance               {agree / n:.1%}")

    for key, title in [
        ("imagery_blind", "Looks fine but crashes are high - inspect these first"),
        ("latent_risk", "Looks dangerous but few recorded crashes"),
    ]:
        items = sorted(q[key], key=lambda x: -x["eb_ksi"])[:5]
        if items:
            print()
            print(f"  {title}:")
            for x in items:
                print(
                    f"    {x['int_name'][:44]:<44} "
                    f"img {x['img_score']:5.1f}  eb {x['eb_ksi']:.3f}  ksi {x['ped_ksi']}"
                )

    # ------------------------------------------------------------------
    # Per-feature association
    # ------------------------------------------------------------------
    print()
    print("Per-feature association with EB expected KSI")
    print("  mean eb_ksi where the feature is present vs absent")
    print()
    feat_names = sorted({k for x in rows for k, v in x["features"].items() if isinstance(v, dict) and "any" in v})
    printed = False
    for fname in feat_names:
        present = [x["eb_ksi"] for x in rows if x["features"].get(fname, {}).get("any") is True]
        absent = [x["eb_ksi"] for x in rows if x["features"].get(fname, {}).get("any") is False]
        if len(present) < 3 or len(absent) < 3:
            continue
        mp, ma = sum(present) / len(present), sum(absent) / len(absent)
        print(f"    {fname:<24} present {mp:.3f} (n={len(present):3d})   absent {ma:.3f} (n={len(absent):3d})   diff {mp - ma:+.3f}")
        printed = True
    if not printed:
        print("    (not enough variation yet - needs a larger sample)")

    # ------------------------------------------------------------------
    # Reliability
    # ------------------------------------------------------------------
    sds = [x["img_sd"] for x in rows]
    mixed_rates = []
    for fname in feat_names:
        vals = [x["features"].get(fname, {}) for x in rows]
        mixed = [v for v in vals if isinstance(v, dict) and v.get("mixed")]
        if vals:
            mixed_rates.append((fname, len(mixed) / len(vals)))

    print()
    print("Reliability across headings within the same intersection")
    print(f"    median SD of safety score   {median(sds):.2f} points")
    if mixed_rates:
        mixed_rates.sort(key=lambda t: -t[1])
        print("    most heading-inconsistent features:")
        for fname, rate in mixed_rates[:5]:
            print(f"      {fname:<24} {rate:.0%} of intersections disagree across headings")

    print()
    print("Reminder: these scores are blind to crash data by construction.")
    print("Do not re-run this against context-mode output.")
    print()

    if args.csv:
        with args.csv.open("w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["node_id", "int_name", "img_score", "img_sd", "img_conf", "eb_ksi", "ped_ksi", "risk_tier", "on_hin", "aadt"])
            for x in rows:
                w.writerow([x["node_id"], x["int_name"], x["img_score"], x["img_sd"], x["img_conf"], x["eb_ksi"], x["ped_ksi"], x["risk_tier"], x["on_hin"], x["aadt"]])
        print(f"Wrote {args.csv}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
