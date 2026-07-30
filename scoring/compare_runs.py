#!/usr/bin/env python3
"""Compare two scoring runs over the same intersections.

Built for settings comparisons — thinking depth, model version, heading
count, prompt version — where the question is whether a cheaper or faster
configuration gives materially different answers.

    python compare_runs.py results results_thinking_high

Reports score differences, rank correlation, and per-feature disagreement.
If the two runs agree closely, the cheaper configuration is free speed. If
they diverge, that divergence is itself a measurement-reliability finding
worth reporting rather than a nuisance.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent


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


def load(d: Path) -> dict[int, dict]:
    out: dict[int, dict] = {}
    for fp in sorted(d.glob("*.json")):
        try:
            rec = json.loads(fp.read_text())
        except json.JSONDecodeError:
            continue
        if rec.get("status") == "OK" and (rec.get("aggregate") or {}):
            out[rec["node_id"]] = rec
    return out


def describe(recs: dict[int, dict]) -> str:
    if not recs:
        return "empty"
    first = next(iter(recs.values()))
    bits = [
        f"model={first.get('model')}",
        f"thinking={first.get('thinking', 'n/a')}",
        f"prompt={first.get('prompt_version')}",
        f"headings={len((first.get('imagery') or {}).get('headings', []))}",
    ]
    if first.get("mock"):
        bits.append("MOCK")
    return ", ".join(bits)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dir_a", type=Path)
    ap.add_argument("dir_b", type=Path)
    args = ap.parse_args()

    for d in (args.dir_a, args.dir_b):
        if not d.exists():
            print(f"No such directory: {d}")
            return 1

    a, b = load(args.dir_a), load(args.dir_b)
    common = sorted(set(a) & set(b))

    print()
    print("=" * 66)
    print("RUN COMPARISON")
    print("=" * 66)
    print(f"  A  {args.dir_a}   ({len(a)} scored)  {describe(a)}")
    print(f"  B  {args.dir_b}   ({len(b)} scored)  {describe(b)}")
    print(f"  overlapping intersections: {len(common)}")

    if not common:
        print("\nNo intersections in common — nothing to compare.")
        return 1

    sa = [a[n]["aggregate"]["safety_score_mean"] for n in common]
    sb = [b[n]["aggregate"]["safety_score_mean"] for n in common]
    diffs = [y - x for x, y in zip(sa, sb)]
    absd = [abs(d) for d in diffs]

    print()
    print("Safety score")
    print(f"  mean A            {sum(sa) / len(sa):6.1f}")
    print(f"  mean B            {sum(sb) / len(sb):6.1f}")
    print(f"  mean difference   {sum(diffs) / len(diffs):+6.1f}  (B minus A)")
    print(f"  mean abs diff     {sum(absd) / len(absd):6.1f} points")
    print(f"  largest abs diff  {max(absd):6.1f} points")

    if len(common) >= 3:
        rho = spearman(sa, sb)
        r = pearson(sa, sb)
        if rho is not None:
            print(f"  rank correlation  {rho:+.3f}")
        if r is not None:
            print(f"  pearson r         {r:+.3f}")

    # Within-run dispersion, for context on whether the between-run
    # difference is large relative to the noise each run already carries.
    sda = [a[n]["aggregate"].get("safety_score_sd") or 0 for n in common]
    sdb = [b[n]["aggregate"].get("safety_score_sd") or 0 for n in common]
    print()
    print("Within-run spread across headings (for scale)")
    print(f"  mean SD in A      {sum(sda) / len(sda):6.1f} points")
    print(f"  mean SD in B      {sum(sdb) / len(sdb):6.1f} points")
    mean_abs = sum(absd) / len(absd)
    mean_sd = (sum(sda) + sum(sdb)) / (len(sda) + len(sdb))
    if mean_sd > 0:
        print(f"  between-run diff is {mean_abs / mean_sd:.2f}x the within-run spread")
        if mean_abs < mean_sd:
            print("  -> the two settings differ by less than each run's own noise")

    print()
    print("Per-intersection")
    for n in sorted(common, key=lambda n: -abs(
        b[n]["aggregate"]["safety_score_mean"] - a[n]["aggregate"]["safety_score_mean"]
    )):
        name = (a[n].get("int_name") or "?")[:40]
        x = a[n]["aggregate"]["safety_score_mean"]
        y = b[n]["aggregate"]["safety_score_mean"]
        print(f"  {name:<40} A {x:5.1f}   B {y:5.1f}   diff {y - x:+6.1f}")

    # Per-feature disagreement on the `any` flag.
    feat_names = sorted(
        {
            k
            for n in common
            for k, v in (a[n]["aggregate"].get("features") or {}).items()
            if isinstance(v, dict) and "any" in v
        }
    )
    rows = []
    for f in feat_names:
        disagree = 0
        total = 0
        for n in common:
            va = (a[n]["aggregate"].get("features") or {}).get(f, {}).get("any")
            vb = (b[n]["aggregate"].get("features") or {}).get(f, {}).get("any")
            if va is None or vb is None:
                continue
            total += 1
            if va != vb:
                disagree += 1
        if total:
            rows.append((f, disagree / total, disagree, total))

    if rows:
        rows.sort(key=lambda t: -t[1])
        print()
        print("Feature detection disagreement between runs")
        any_disagreement = False
        for f, rate, d, t in rows:
            if d:
                print(f"  {f:<24} {rate:5.0%}  ({d}/{t})")
                any_disagreement = True
        if not any_disagreement:
            print("  none — both runs detected identical features everywhere")

    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
