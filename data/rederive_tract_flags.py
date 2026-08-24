"""Add the `has_age` gate flag to the committed tracts.geojson.

`build_tracts_geojson.py` now emits `has_age` (an ACS 65+ share exists), the
gate for the tract layer's Age 65+ mode. That build needs the pipeline's
`tract_ranked.csv`, which is not committed; the flag is a pure function of a
property already in the file, so it is derived here in place. Idempotent.

    uv run python data/rederive_tract_flags.py
"""
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PATH = REPO / "data" / "tracts.geojson"

d = json.loads(PATH.read_text())
n = 0
for f in d["features"]:
    p = f["properties"]
    p["has_age"] = p.get("pct_65plus") is not None
    n += p["has_age"]
PATH.write_text(json.dumps(d, separators=(",", ":")))
print(f"has_age true for {n} of {len(d['features'])} tracts; wrote {PATH.name}")
