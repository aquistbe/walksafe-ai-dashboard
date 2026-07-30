#!/usr/bin/env python3
"""Merge imagery scores into the dashboard GeoJSON.

Reads per-node JSON from ``scoring/results/`` and writes:

  * ``data/imagery_scores.json``  - compact lookup keyed by node_id
  * ``data/intersections.geojson`` - optionally enriched in place (--write-geojson)

Only a small, flat subset of each record is attached to the GeoJSON. The map
does not need the per-heading detail, and adding it would inflate a payload
that is already 10 MB. Full records stay in scoring/results/ and are served
per-intersection by the API.

Usage
-----
    python join_scores.py                     # build data/imagery_scores.json
    python join_scores.py --write-geojson     # also enrich the GeoJSON
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent

DEFAULT_RESULTS = HERE / "results"
DEFAULT_GEOJSON = REPO / "data" / "intersections.geojson"
DEFAULT_SCORES = REPO / "data" / "imagery_scores.json"
FRONTEND_DATA = REPO / "frontend" / "public" / "data"

# Binary features surfaced on the map/panel. Others stay in the full record.
HEADLINE_FEATURES = [
    "sidewalk_present",
    "crosswalk_marked",
    "curb_ramp",
    "refuge_island",
    "pedestrian_signal",
    "street_lighting",
    "visual_obstruction",
    "slip_lane",
]


def flatten(record: dict) -> dict | None:
    """Reduce a full scoring record to the fields the dashboard needs."""
    if record.get("status") != "OK":
        return {
            "node_id": record["node_id"],
            "img_status": record.get("status", "UNKNOWN"),
        }

    agg = record.get("aggregate") or {}
    if not agg:
        return {"node_id": record["node_id"], "img_status": "NO_RESULT"}

    feats = agg.get("features", {})

    out: dict = {
        "node_id": record["node_id"],
        "img_status": "OK",
        "img_score": agg.get("safety_score_mean"),
        "img_score_sd": agg.get("safety_score_sd"),
        "img_confidence": agg.get("confidence_mean"),
        "img_headings": agg.get("n_headings_scored"),
        "img_date": (record.get("imagery") or {}).get("capture_date"),
        "img_pano": (record.get("imagery") or {}).get("pano_id"),
        "img_model": record.get("model"),
        "img_prompt_version": record.get("prompt_version"),
        "img_mock": bool(record.get("mock")),
        "n_hazards": len(agg.get("hazards", [])),
        "n_interventions": len(agg.get("interventions", [])),
    }

    for name in HEADLINE_FEATURES:
        f = feats.get(name)
        if isinstance(f, dict):
            out[f"f_{name}"] = f.get("any")
            out[f"f_{name}_prop"] = f.get("proportion")

    crossing = feats.get("crossing_distance")
    if isinstance(crossing, dict):
        out["f_crossing_distance"] = crossing.get("modal")
    lanes = feats.get("through_lanes")
    if isinstance(lanes, dict):
        out["f_through_lanes"] = lanes.get("modal")

    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--results", type=Path, default=DEFAULT_RESULTS)
    ap.add_argument("--geojson", type=Path, default=DEFAULT_GEOJSON)
    ap.add_argument("--out", type=Path, default=DEFAULT_SCORES)
    ap.add_argument("--write-geojson", action="store_true", help="Enrich the GeoJSON in place")
    ap.add_argument("--no-copy-frontend", action="store_true", help="Skip copying to frontend/public/data")
    args = ap.parse_args()

    if not args.results.exists():
        print(f"No results directory at {args.results}. Run score_intersections.py first.")
        return 1

    files = sorted(args.results.glob("*.json"))
    if not files:
        print(f"No result files in {args.results}.")
        return 1

    flat: dict[str, dict] = {}
    n_ok = n_bad = 0
    mock_seen = False

    for fp in files:
        try:
            rec = json.loads(fp.read_text())
        except json.JSONDecodeError:
            print(f"  skipping unreadable {fp.name}")
            n_bad += 1
            continue
        row = flatten(rec)
        if row is None:
            n_bad += 1
            continue
        if row.get("img_mock"):
            mock_seen = True
        flat[str(row["node_id"])] = row
        if row.get("img_status") == "OK":
            n_ok += 1

    args.out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated": __import__("datetime").datetime.now().isoformat(),
        "n_scored": n_ok,
        "n_records": len(flat),
        "contains_mock_data": mock_seen,
        "scores": flat,
    }
    args.out.write_text(json.dumps(payload, indent=2))
    print(f"Wrote {args.out}  ({n_ok} scored, {len(flat)} records)")
    if mock_seen:
        print("  WARNING: some records are mock output. Do not interpret these.")

    if not args.no_copy_frontend and FRONTEND_DATA.exists():
        shutil.copy(args.out, FRONTEND_DATA / args.out.name)
        print(f"Copied to {FRONTEND_DATA / args.out.name}")

    if args.write_geojson:
        gj = json.loads(args.geojson.read_text())
        n_join = 0
        for feat in gj["features"]:
            row = flat.get(str(feat["properties"]["node_id"]))
            if row:
                merged = {k: v for k, v in row.items() if k != "node_id"}
                feat["properties"].update(merged)
                n_join += 1
        args.geojson.write_text(json.dumps(gj, separators=(",", ":")))
        print(f"Enriched {args.geojson}  ({n_join} features joined)")

        if not args.no_copy_frontend and FRONTEND_DATA.exists():
            shutil.copy(args.geojson, FRONTEND_DATA / args.geojson.name)
            print(f"Copied to {FRONTEND_DATA / args.geojson.name}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
