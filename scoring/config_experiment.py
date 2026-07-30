#!/usr/bin/env python3
"""Stage A: find the scoring configuration worth scaling.

Runs several configurations over the SAME stratified sample of
intersections, then reports which ones actually differ. The question is not
"which scores highest" — it is "which configuration measures reliably enough
that between-site differences exceed within-site noise".

Configurations run by default:

  base      4 headings, high thinking          the current default
  head8     8 headings, high thinking          should cut within-site noise
  repeat    identical to `base`, rerun         measures non-determinism
  pro       4 headings, Pro model              is the bigger model worth it

`repeat` is the one people skip and shouldn't. Temperature is 0, so `base`
and `repeat` see identical inputs with identical settings; any difference
between them is pure run-to-run noise, and it sets the floor on what the
other comparisons can possibly mean.

Usage
-----
    python config_experiment.py --stratify 15 --price-in 0.30 --price-out 2.50
    python config_experiment.py --stratify 15 --only base,head8
    python config_experiment.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import math
import statistics as st
import sys
from collections import Counter
from pathlib import Path

import score_intersections as si

HERE = Path(__file__).resolve().parent

ALL_HEADINGS_8 = "0,45,90,135,180,225,270,315"

CONFIGS: dict[str, dict] = {
    "base": {"headings": "0,90,180,270", "thinking": "high", "model": None,
             "desc": "4 headings, high thinking (current default)"},
    "head8": {"headings": ALL_HEADINGS_8, "thinking": "high", "model": None,
              "desc": "8 headings, high thinking"},
    "repeat": {"headings": "0,90,180,270", "thinking": "high", "model": None,
               "desc": "identical to base, rerun (non-determinism check)"},
    "pro": {"headings": "0,90,180,270", "thinking": "high", "model": "PRO",
            "desc": "4 headings, Pro model"},
}


def load_scores(d: Path) -> dict[int, dict]:
    out: dict[int, dict] = {}
    for fp in sorted(d.glob("*.json")):
        try:
            rec = json.loads(fp.read_text())
        except json.JSONDecodeError:
            continue
        agg = rec.get("aggregate") or {}
        if rec.get("status") == "OK" and agg.get("safety_score_mean") is not None:
            out[rec["node_id"]] = rec
    return out


def discrimination(recs: dict[int, dict]) -> dict:
    scores = [r["aggregate"]["safety_score_mean"] for r in recs.values()]
    sds = [r["aggregate"].get("safety_score_sd") or 0.0 for r in recs.values()]
    if len(scores) < 2:
        return {}
    between = st.pstdev(scores)
    within = st.mean(sds) if sds else 0.0
    counts = Counter(scores)
    return {
        "n": len(scores),
        "mean": st.mean(scores),
        "between_sd": between,
        "within_sd": within,
        "ratio": between / within if within else float("inf"),
        "distinct": len(counts),
        "modal_share": counts.most_common(1)[0][1] / len(scores),
        "zero_sd_share": sum(1 for s in sds if s == 0.0) / len(sds),
        "range": (min(scores), max(scores)),
    }


def mean_abs_diff(a: dict[int, dict], b: dict[int, dict]) -> tuple[float, int]:
    common = set(a) & set(b)
    if not common:
        return (float("nan"), 0)
    diffs = [
        abs(b[n]["aggregate"]["safety_score_mean"] - a[n]["aggregate"]["safety_score_mean"])
        for n in common
    ]
    return (st.mean(diffs), len(common))


def feature_disagreement(a: dict[int, dict], b: dict[int, dict]) -> float:
    """Share of (site, feature) pairs where the two runs disagree."""
    common = set(a) & set(b)
    tot = dis = 0
    for n in common:
        fa = (a[n]["aggregate"].get("features") or {})
        fb = (b[n]["aggregate"].get("features") or {})
        for k, va in fa.items():
            if not isinstance(va, dict) or "any" not in va:
                continue
            vb = fb.get(k)
            if not isinstance(vb, dict) or "any" not in vb:
                continue
            tot += 1
            if va["any"] != vb["any"]:
                dis += 1
    return dis / tot if tot else float("nan")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stratify", type=int, default=15, help="Sites per risk tier (default 15 = 60 total)")
    ap.add_argument("--seed", type=int, default=20260730)
    ap.add_argument("--outroot", type=Path, default=HERE / "experiments")
    ap.add_argument("--pro-model", default="gemini-3-pro-preview",
                    help="Model string for the 'pro' config — verify this is current")
    ap.add_argument("--only", help="Comma-separated subset, e.g. base,head8")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--price-in", type=float)
    ap.add_argument("--price-out", type=float)
    ap.add_argument("--mock", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="Print the plan and exit")
    ap.add_argument("--analyze-only", action="store_true", help="Skip scoring, just compare existing output")
    args = ap.parse_args()

    names = [n.strip() for n in args.only.split(",")] if args.only else list(CONFIGS)
    for n in names:
        if n not in CONFIGS:
            print(f"Unknown config '{n}'. Choose from: {', '.join(CONFIGS)}")
            return 1

    n_sites = args.stratify * 4
    print()
    print("=" * 72)
    print("STAGE A - CONFIGURATION EXPERIMENT")
    print("=" * 72)
    print(f"  sample: {args.stratify} per tier = {n_sites} intersections (seed {args.seed})")
    print(f"  output: {args.outroot}")
    print()
    total_calls = 0
    for n in names:
        c = CONFIGS[n]
        nh = len(c["headings"].split(","))
        calls = n_sites * nh
        total_calls += calls
        model = args.pro_model if c["model"] == "PRO" else "(default)"
        print(f"  {n:<8} {c['desc']:<48} {nh} headings, {calls} calls, model {model}")
    print()
    print(f"  total: {total_calls} images and {total_calls} Gemini calls")

    if args.dry_run:
        print("\n(dry run - nothing executed)")
        return 0

    args.outroot.mkdir(parents=True, exist_ok=True)

    if not args.analyze_only:
        for n in names:
            c = CONFIGS[n]
            outdir = args.outroot / n
            print()
            print("-" * 72)
            print(f"RUNNING: {n}  ({c['desc']})")
            print("-" * 72)

            argv = [
                "--stratify", str(args.stratify),
                "--seed", str(args.seed),
                "--headings", c["headings"],
                "--thinking", c["thinking"],
                "--workers", str(args.workers),
                "--outdir", str(outdir),
                "--yes",
            ]
            if c["model"] == "PRO":
                argv += ["--model", args.pro_model]
            if args.price_in and args.price_out:
                argv += ["--price-in", str(args.price_in), "--price-out", str(args.price_out)]
            if args.mock:
                argv.append("--mock")

            rc = si.main(argv)
            if rc != 0:
                print(f"\n'{n}' exited with status {rc}. Continuing with the rest.")

    # ------------------------------------------------------------------
    # Analysis
    # ------------------------------------------------------------------
    loaded = {n: load_scores(args.outroot / n) for n in names}
    loaded = {n: v for n, v in loaded.items() if v}

    if not loaded:
        print("\nNo results to analyse.")
        return 1

    print()
    print("=" * 72)
    print("DISCRIMINATION BY CONFIGURATION")
    print("=" * 72)
    print(f"  {'config':<8} {'n':>4} {'range':>13} {'betwSD':>7} {'withSD':>7} {'ratio':>6} {'distinct':>9} {'sd=0':>6}")
    for n, recs in loaded.items():
        d = discrimination(recs)
        if not d:
            continue
        rng = f"{d['range'][0]:.0f}-{d['range'][1]:.0f}"
        print(
            f"  {n:<8} {d['n']:>4} {rng:>13} {d['between_sd']:>7.2f} {d['within_sd']:>7.2f} "
            f"{d['ratio']:>6.2f} {d['distinct']:>9} {d['zero_sd_share']:>5.0%}"
        )
    print()
    print("  ratio = between-site SD / within-site SD.")
    print("  Higher is better: it means real differences between intersections")
    print("  exceed the disagreement between views of the same intersection.")
    print("  Below ~1.5 the score struggles to separate sites at all.")

    if "base" in loaded and "repeat" in loaded:
        md, nc = mean_abs_diff(loaded["base"], loaded["repeat"])
        fd = feature_disagreement(loaded["base"], loaded["repeat"])
        print()
        print("=" * 72)
        print("NON-DETERMINISM FLOOR  (base vs repeat, identical settings)")
        print("=" * 72)
        print(f"  mean |difference|          {md:.2f} points   (n={nc})")
        print(f"  feature disagreement       {fd:.1%}")
        print()
        print("  Temperature is 0, so this is irreducible run-to-run noise.")
        print("  Any other configuration difference smaller than this is not real.")

    if "base" in loaded:
        print()
        print("=" * 72)
        print("EACH CONFIGURATION vs BASE")
        print("=" * 72)
        floor = None
        if "repeat" in loaded:
            floor, _ = mean_abs_diff(loaded["base"], loaded["repeat"])
        for n, recs in loaded.items():
            if n == "base":
                continue
            md, nc = mean_abs_diff(loaded["base"], recs)
            fd = feature_disagreement(loaded["base"], recs)
            verdict = ""
            if floor and not math.isnan(md) and not math.isnan(floor):
                verdict = (
                    "  <- within noise, not a real difference"
                    if md <= floor
                    else f"  <- {md / floor:.1f}x the noise floor"
                )
            print(f"  {n:<8} mean |diff| {md:6.2f} pts   features differ {fd:5.1%}   (n={nc}){verdict}")

    print()
    print("=" * 72)
    print("HOW TO READ THIS")
    print("=" * 72)
    print("  1. Pick the configuration with the highest ratio.")
    print("  2. Ignore any difference from base smaller than the noise floor.")
    print("  3. If head8 improves the ratio, the extra cost buys real precision;")
    print("     if it does not, stay at 4 headings and spend the money on")
    print("     more intersections or human-audited ground truth instead.")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
