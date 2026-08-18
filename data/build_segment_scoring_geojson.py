#!/usr/bin/env python3
"""Build data/segments_scoring.geojson — the mid-block imagery scoring frame.

Design: stratified case-cohort
------------------------------
The segment risk tiers do not concentrate the observed mid-block burden. Of
657 mid-block pedestrian KSI across 39,761 segments, the Critical tier (n=295)
carries 59 (9%) and Critical+High (n=1,471) carries 167 (25%). Tier-stratified
sampling of the kind used for intersections would spend most of the budget on
segments contributing nothing to the likelihood.

So: take every segment that carries at least one pedestrian KSI (the cases,
n=599, 100% of the events), plus a stratified random subcohort of zero-KSI
segments (the controls) allocated across risk tiers so that the high-exposure
end of the network is represented. Fit the feature model as weighted
Poisson/negative binomial with log(mu_spf_seg) as offset, inverse sampling
probability as weight, and robust standard errors. Weights are written into
the output as `ipw` and printed at build time.

This is outcome-dependent sampling and the weights are not optional. An
unweighted fit on this frame estimates the feature-outcome association in a
population that is ~40% crash-carrying segments, against a network where the
true share is 1.5%.

Geometry
--------
Each selected segment gets Street View sample points spaced at most 25 m apart
along its centreline, matching the ELSI-Urbe protocol used in the Bogota
audits, with the outer 25 m at each end trimmed. That trim matches the
intersection influence zone already subtracted from `exposure_mi`, and it is
what keeps a "mid-block" image from actually showing the junction — which
would import the intersection features we are trying to hold separate.

Note that 25 m is finer than the Street View panorama interval on many streets,
so adjacent points will sometimes resolve to the same panorama. The runner
deduplicates by pano_id within a segment; the image count printed here is
therefore an upper bound on what a run actually costs.

Each point carries the local bearing of the centreline. The runner turns that
into four views: bearing and bearing+180 look along the corridor (lane count,
width, lighting, sight distance), bearing+/-90 look at the frontage (walkway,
buffer, driveways, land use). Fixed compass headings would give a corridor view
on a north-south street and a frontage view on an east-west one; in
Philadelphia's grid that is a systematic confound between street orientation
and which features get observed.

Inputs
------
  data/segments.geojson                  LineString geometry, seg_id
  pipeline/work/segment_ranked.csv       ped_ksi_seg, mu_spf_seg, tiers, AADT

Output
------
  data/segments_scoring.geojson          Point features, one per segment
"""

from __future__ import annotations

import json
import math
import random
from collections import Counter
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
SEG_GEOJSON = HERE / "segments.geojson"
SEG_CSV = REPO / "pipeline" / "work" / "segment_ranked.csv"
OUT = HERE / "segments_scoring.geojson"

SEED = 20260802
N_CONTROLS_BY_TIER = {
    "Critical": 100,
    "High": 150,
    "Moderate": 200,
    "Low": 250,
    "Unmodelled": 200,
}

TRIM_M = 25.0          # intersection influence zone, matches exposure_mi
SPACING_M = 25.0       # ELSI-Urbe protocol, matches the Bogota audits
MAX_POINTS = 60        # backstop only; the longest segment in the frame needs 53

M_PER_DEG_LAT = 111_320.0


# ---------------------------------------------------------------------------
# Geometry helpers (equirectangular; exact enough at block scale)
# ---------------------------------------------------------------------------


def _scale(lat_deg: float) -> float:
    """Metres per degree of longitude at this latitude."""
    return M_PER_DEG_LAT * math.cos(math.radians(lat_deg))


def _seg_len_m(a: list[float], b: list[float]) -> float:
    lat0 = (a[1] + b[1]) / 2.0
    dx = (b[0] - a[0]) * _scale(lat0)
    dy = (b[1] - a[1]) * M_PER_DEG_LAT
    return math.hypot(dx, dy)


def _bearing(a: list[float], b: list[float]) -> float:
    """Compass bearing in degrees from a to b, 0 = north, clockwise."""
    lat0 = (a[1] + b[1]) / 2.0
    dx = (b[0] - a[0]) * _scale(lat0)
    dy = (b[1] - a[1]) * M_PER_DEG_LAT
    return (math.degrees(math.atan2(dx, dy))) % 360.0


def _interpolate(coords: list[list[float]], target_m: float) -> tuple[float, float, float]:
    """Point at `target_m` along the polyline; returns (lng, lat, bearing)."""
    acc = 0.0
    for i in range(len(coords) - 1):
        a, b = coords[i], coords[i + 1]
        d = _seg_len_m(a, b)
        if d == 0:
            continue
        if acc + d >= target_m:
            f = (target_m - acc) / d
            return (
                a[0] + f * (b[0] - a[0]),
                a[1] + f * (b[1] - a[1]),
                _bearing(a, b),
            )
        acc += d
    a, b = coords[-2], coords[-1]
    return (b[0], b[1], _bearing(a, b))


def sample_points(coords: list[list[float]]) -> list[dict]:
    """Place points at most SPACING_M apart, trimming the junction ends.

    Spacing is computed as usable/(n-1) with n = ceil(usable/SPACING_M) + 1, so
    the points span the whole trimmed block and are never more than 25 m apart.
    Taking floor instead would leave a tail of up to 25 m unsampled at the far
    end of every block, which on a 96 m median segment is a quarter of it.
    """
    total = sum(_seg_len_m(coords[i], coords[i + 1]) for i in range(len(coords) - 1))
    if total <= 0:
        lng, lat = coords[0]
        return [{"lng": round(lng, 6), "lat": round(lat, 6), "bearing": 0.0, "at_m": 0.0}]

    usable = total - 2 * TRIM_M
    if usable <= 10.0:
        # Short block: one point at the midpoint, junctions unavoidably in view.
        positions = [total / 2.0]
    else:
        n = min(math.ceil(usable / SPACING_M) + 1, MAX_POINTS)
        positions = [TRIM_M + usable * i / (n - 1) for i in range(n)] if n > 1 else [total / 2.0]

    pts = []
    for at in positions:
        lng, lat, brg = _interpolate(coords, at)
        pts.append({
            "lng": round(lng, 6),
            "lat": round(lat, 6),
            "bearing": round(brg, 1),
            "at_m": round(at, 1),
        })
    return pts


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------


def main() -> int:
    for p in (SEG_GEOJSON, SEG_CSV):
        if not p.exists():
            raise SystemExit(f"Missing {p}")

    geo = json.loads(SEG_GEOJSON.read_text())
    coords_by_id: dict[int, list[list[float]]] = {}
    for f in geo["features"]:
        if f["geometry"]["type"] == "LineString":
            coords_by_id[int(f["properties"]["seg_id"])] = f["geometry"]["coordinates"]

    df = pd.read_csv(SEG_CSV)
    df["seg_id"] = df["SEG_ID"].astype(int)
    df["tier"] = df["seg_risk_tier"].fillna("Unmodelled")
    df["ped_ksi_seg"] = df["ped_ksi_seg"].fillna(0).astype(int)
    df = df[df.seg_id.isin(coords_by_id)].copy()

    cases = df[df.ped_ksi_seg > 0]
    pool = df[df.ped_ksi_seg == 0]

    rng = random.Random(SEED)
    picked_controls, weights = [], {}
    for tier, k in N_CONTROLS_BY_TIER.items():
        stratum = pool[pool.tier == tier]
        n_avail = len(stratum)
        k_eff = min(k, n_avail)
        idx = rng.sample(list(stratum.index), k_eff)
        picked_controls.extend(idx)
        weights[tier] = n_avail / k_eff if k_eff else None

    controls = df.loc[picked_controls]
    frame = pd.concat([cases, controls]).drop_duplicates(subset="seg_id")

    print(f"cases (>=1 ped KSI): {len(cases):5d}  events {int(cases.ped_ksi_seg.sum())}")
    print(f"controls (0 KSI):    {len(controls):5d}")
    print(f"frame total:         {len(frame):5d}")
    print("\ninverse-probability weights for the model (cases = 1.0):")
    for tier, w in weights.items():
        n_av = len(pool[pool.tier == tier])
        print(f"  {tier:<11s} sampled {min(N_CONTROLS_BY_TIER[tier], n_av):4d} of {n_av:6d}  weight {w:8.2f}")

    features, n_points_total = [], 0
    for row in frame.itertuples():
        pts = sample_points(coords_by_id[row.seg_id])
        n_points_total += len(pts)
        is_case = row.ped_ksi_seg > 0
        name = str(getattr(row, "STREETLABE", "") or getattr(row, "ST_NAME", "") or "?")
        block = f"{name} {int(row.L_HUNDRED)}-block" if pd.notna(row.L_HUNDRED) else name
        mid = pts[len(pts) // 2]
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [mid["lng"], mid["lat"]]},
            "properties": {
                # Names the scorer expects
                "node_id": int(row.seg_id),
                "int_name": block,
                # Sampling design
                "sample_points": pts,
                "n_points": len(pts),
                "is_case": bool(is_case),
                "tier": row.tier,
                "ipw": 1.0 if is_case else round(weights[row.tier], 4),
                # Outcome and offset — for validate/model only, never the prompt
                "ped_ksi_seg": int(row.ped_ksi_seg),
                "ped_any_seg": int(getattr(row, "ped_any_seg", 0) or 0),
                "mu_spf_seg": _nz(getattr(row, "mu_spf_seg", None)),
                "eb_ksi_seg": _nz(getattr(row, "eb_ksi_seg", None)),
                "exposure_mi": _nz(getattr(row, "exposure_mi", None)),
                "length_mi": _nz(getattr(row, "length_mi", None)),
                "aadt": _nz(getattr(row, "aadt", None)),
                "aadt_real": bool(getattr(row, "aadt_real", False)),
                "on_hin": bool(getattr(row, "on_hin", False)),
                "road_class": _nz(getattr(row, "CLASS", None)),
                "corridor_id": _nz(getattr(row, "corridor_id", None)),
            },
        })

    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    n_images = n_points_total * 4
    print(f"\nwrote {OUT}")
    print(f"  {len(features)} segments, {n_points_total} sample points, {n_images} images at 4 headings")
    print(f"  point distribution: {dict(sorted(Counter(f['properties']['n_points'] for f in features).items()))}")
    print(f"  rough cost at $0.0135/image: ${n_images * 0.0135:,.0f}")
    return 0


def _nz(v):
    if v is None:
        return None
    try:
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            return None
    except TypeError:
        return None
    if hasattr(v, "item"):
        v = v.item()
    return round(v, 5) if isinstance(v, float) else v


if __name__ == "__main__":
    raise SystemExit(main())
