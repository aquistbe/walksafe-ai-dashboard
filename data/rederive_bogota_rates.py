"""Add the mobility-survey casualty rates to the committed bogota_zats.geojson.

`build_bogota_geojson.py` now writes `casualties_per_10k_trips`,
`injury_per_10k_trips` and `death_per_10k_trips` (outcome per 10,000
walking + public-transport trips, `walk_pubt`, 2019 Bogotá mobility
survey). That build needs `data/source/Zonas_ZAT.geojson`, which is not
committed. The new fields are a pure function of properties already in the
committed file, so this script derives them in place with the same helper
the build uses, and stamps the metadata the same way. Idempotent.

    uv run python data/rederive_bogota_rates.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rates import per_10k  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
PATH = REPO / "data" / "bogota_zats.geojson"

EXPOSURE_META = {
    "field": "walk_pubt",
    "definition": "walking and public-transport trips to each zone recorded by the 2019 Bogota mobility survey, a one-day travel diary of a representative sample from every ZAT (Encuesta de Movilidad)",
    "rates": ["casualties_per_10k_trips", "injury_per_10k_trips", "death_per_10k_trips"],
    "note": "Outcome per 10,000 trips. This is the exposure offset used in "
            "Zewdie et al. 2024 for the ZAT tree analysis; the per-km2 fields "
            "remain as area densities and are not exposure-adjusted.",
}

d = json.loads(PATH.read_text())
n = 0
for f in d["features"]:
    p = f["properties"]
    trips = p.get("walk_pubt")
    p["casualties_per_10k_trips"] = per_10k(p.get("casualties"), trips)
    p["injury_per_10k_trips"] = per_10k(p.get("injury"), trips)
    p["death_per_10k_trips"] = per_10k(p.get("death"), trips, 3)
    n += p["casualties_per_10k_trips"] is not None
d["metadata"]["exposure"] = EXPOSURE_META
PATH.write_text(json.dumps(d, separators=(",", ":")))
print(f"{n} of {len(d['features'])} zones carry casualties_per_10k_trips; wrote {PATH.name}")
