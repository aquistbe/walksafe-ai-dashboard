# Philadelphia analysis pipeline

The eleven numbered scripts that produce the Philadelphia intersection ranking,
plus the segment extension (12, 13). This code previously lived outside any
repository with every path hardcoded to a sandbox mount, so the dashboard's data
had no versioned provenance. It does now.

Methodology is documented in `MEMO_intersection_ranking.md` in the original
`WALKSAFE_site_selection/` folder; this README covers only how to run it.

## Running

```bash
export WALKSAFE_DATA_ROOT="$HOME/Library/CloudStorage/OneDrive-DrexelUniversity/Grants/WALKSAFE-AI Grant/Data"
make philly-pipeline     # 01 -> 11, the intersection ranking
make segments            # 12, 13, 14, then data/segments.geojson
make tracts              # 16 (needs CENSUS_API_KEY), then data/tracts.geojson
```

Every path resolves through `config.py`. Nothing is machine-specific; the only
thing pointing outside the repo is the raw data root.

| Variable | Default | Purpose |
|---|---|---|
| `WALKSAFE_DATA_ROOT` | `<repo>/../Data` | raw external data (below) |
| `WALKSAFE_PENNDOT_DIR` | `$DATA_ROOT/PennDOT` | crash extracts |
| `WALKSAFE_GIS_DIR` | `$DATA_ROOT/Philadelphia GIS` | GIS layers |
| `WALKSAFE_PLACES_DIR` | `$DATA_ROOT/CDC Places` | CDC PLACES |
| `WALKSAFE_FARS_DIR` | `$DATA_ROOT/FARS` | FARS validation |
| `WALKSAFE_WORK_DIR` | `pipeline/work` | intermediates, gitignored |
| `WALKSAFE_OUTPUT_DIR` | `pipeline/outputs` | deliverables, gitignored |

Python dependencies are in `requirements.txt`. Do not create a venv inside this
repository — it is on OneDrive and would sync thousands of files. The Makefile
runs everything through `uv run --with ...`.

## What is committed here, and what is not

**Committed** — the code, and `data/demographics_dhc2020.json`. That file is a
2026-07-06 pull from the Esri Living Atlas 2020 DHC block-group services
(tables P12 age, P9 Hispanic origin by race), made because the Census API was
unreachable and now requires a key. It cannot be regenerated without one, so it
is treated as source rather than intermediate.

**Not committed** — raw source data (tens of GB, licensed, and not ours to
redistribute) and generated outputs. `work/` and `outputs/` are gitignored; the
derived layers the dashboard actually consumes are committed one level up in
`data/`.

## External data — expected layout

Everything below sits under `$WALKSAFE_DATA_ROOT`. Subdirectory names are what
the scripts expect; they match the original working copy.

```
PennDOT/
  Philadelphia_{2015..2024}/CRASH_PHILADELPHIA_{year}.csv
  Philadelphia_{2015..2024}/PERSON_PHILADELPHIA_{year}.csv
  Crash Data Dictionary 05.2023.pdf          # codes were read from this, not assumed
Philadelphia GIS/
  Street_Nodes/                    city street nodes (25,584) — the city-coverage
                                   intersection layer, primary for snapping
  Street_Centerline/               41,229 centerline segments; SEG_ID, FNODE_/TNODE_,
                                   CLASS, ONEWAY, MULTI_REP, ST_CODE
  Intersection_Controls.geojson    control type (stoptype) per node
  PaTraffic2024_03/                PennDOT 2024 traffic segments, CUR_AADT
  PA_AtGradeIntersections2024_03/  PennDOT RMS at-grade intersections (sensitivity only)
  high_injury_network_2020/        Philadelphia HIN, linear
  PhiladelphiaSchool_Facilities2016/
  PPR_Program_Sites/ , PPR_Playgrounds/
CDC Places/
  PLACES__Census_Tract_Data_(GIS_Friendly_Format),_*.csv   # matched by glob, not pinned
FARS/
  FARS{year}NationalCSV/person.csv          # <= 2021
  2022/FARS2022NationalCSV/person.csv
  2023/*PerAux*.csv , 2023/*Accidents*.csv
```

### Provenance and vintage

| Layer | Source | Vintage | Note |
|---|---|---|---|
| Crash / person extracts | PennDOT PCDS, Philadelphia County (67) | 2015–2024 | codes per the 05.2023 dictionary |
| Street_Nodes, Street_Centerline, Intersection_Controls | City of Philadelphia GIS (OpenDataPhilly) | current | control layer is *current*, not historical — a signal installed mid-period reads as always present |
| PaTraffic2024_03 | PennDOT RMS traffic | 2024 | applied to all ten crash years; **53.4% of Philadelphia segments carry the nominal placeholder AADT 300, not a count** |
| PA_AtGradeIntersections2024_03 | PennDOT RMS | 2024 | state-route network only — 65.8% capture vs 98.6% for city nodes, hence sensitivity only |
| high_injury_network_2020 | City of Philadelphia | 2020 | linear |
| PhiladelphiaSchool_Facilities2016 | City of Philadelphia | **2016** | stale; 549 facilities with `ACTIVE == "Open"` |
| PPR_Program_Sites, PPR_Playgrounds | Philadelphia Parks & Recreation | current | 632 combined |
| CDC PLACES tract data | CDC | 2025 release | 389 Philadelphia tracts |
| FARS | NHTSA | 2015–2023 | fatality cross-check only |

## Conventions

- Working CRS is **EPSG:2272** (PA State Plane South, US survey feet).
  Buffers are *stated* in metres and *applied* in feet via `M2FT`.
- Every script writes a QC log to `outputs/qc_logs/qc_*.txt`. In the original
  these went to two different destinations and four scripts wrote none;
  `config.QCLog` is now the single implementation.
- Shapefile + GeoJSON deliverables, both CRS. GeoPackage was unavailable in the
  original environment and the convention was kept.

## Known issues in the inherited code

Recorded rather than silently fixed, because they affect published numbers:

- The archived `qc_covariates.txt` reports `Schools layer: 0` while the shipped
  ranking has 4,491 nodes with a school within 200 m. The archived log is from
  an earlier broken run; the CSV is right.
- `03_exposure_covariates.py`'s docstring says AADT exists only on state routes.
  It does not — coverage is 99.8% — but most local-road values are the nominal
  300 rather than a count, so the docstring's *conclusion* (treat local AADT
  with suspicion) is sound even though its premise is wrong.
- `09_drone_feasibility.py` carries a hand-transcribed desk review. It used to
  join on `rank_eb`, which is a model *result* — it now joins on `int_name` and
  fails loudly if a site has left the shortlist.
