# WalkSafe-AI Dashboard

**Live: https://walksafe-ai-dashboard.daq26.workers.dev/**

Interactive public dashboard for exploring pedestrian safety data and
supporting community decision-making about pedestrian infrastructure. Part of
the WalkSafe-AI project. The current phase is crash-based: empirical Bayes
risk estimates built from police-reported crash data, plus a completed
imagery measurement-validation study. SPMI model outputs, optimization, and
PedAudit integration are planned and not yet built — see the Roadmap.

## What the dashboard shows

**Philadelphia** (Phase 0, crash-based prototype)

- **16,984 intersections** ranked by empirical Bayes pedestrian KSI
  (killed or seriously injured) estimates, from PennDOT crash data
  2015–2024 with DVRPC/PennDOT traffic volumes and City of Philadelphia
  GIS layers.
- **Street segments** — mid-block crashes are roughly half of Philadelphia's
  pedestrian KSI and are invisible to an intersection ranking. A segment
  layer (39,761 segments, own SPF with segment length as exposure offset)
  recovers them.
- **Census tracts** — 408 tracts with a tract-level SPF and ACS 2020–2024
  poverty overlay.
- **Imagery scores** — 50 intersections scored blind from Street View
  imagery by a vision-language model (measurement-validation study; the
  association between imagery scores and crash risk is null after exposure
  adjustment).

**Bogotá** (published built-environment extraction)

- **840 ZAT zones** (Zonas de Análisis de Transporte) with
  built-environment cluster profiles from a published deep-learning
  extraction (~312,000 prediction points, 27 features), pedestrian
  casualties 2015–2019, and age-60+ population share.
- **~100,800 street segments** with a segment-level SPF. This layer is
  61 MB, so it is hosted on Cloudflare R2 rather than committed, and loads
  only when selected.

ZAT associations are area-level (ecological), and risk estimates are not
numerically comparable across cities or layers — each uses its own crash
definition, exposure measure, and model. The dashboard labels both caveats
where the results appear.

**Salt Lake City** — planned; shown as a disabled chip in the city switcher.

## Architecture

```
walksafe-ai-dashboard/
├── data/                       # Committed GeoJSON outputs + build scripts
│   ├── source/                 # Build inputs. Small CSVs committed; large raw
│   │   │                       #   geometry is not — provenance and checksums
│   │   │                       #   in data/source/README.md
│   ├── build_geojson.py            # Philadelphia intersections + summary.json
│   ├── build_segments_geojson.py   # Philadelphia segment layer
│   ├── build_segment_scoring_geojson.py  # mid-block imagery scoring frame
│   ├── build_tracts_geojson.py     # Philadelphia tract layer
│   ├── build_bogota_geojson.py     # Bogotá ZAT choropleth
│   ├── build_bogota_segments_geojson.py  # Bogotá segment layer (R2-hosted)
│   ├── intersections.geojson   # 9.8 MB   segments.geojson       # 20 MB
│   ├── tracts.geojson          # 1 MB     bogota_zats.geojson    # 4.3 MB
│   ├── segments_scoring.geojson, imagery_scores.json, summary.json
│   └── bogota_segments.geojson # 61 MB — NOT committed; published to R2
├── pipeline/                   # Analysis pipeline (Python), steps 01–16:
│   │                           #   crashes → snapping → exposure → SPF/EB →
│   │                           #   deliverables; segments 12–14; Bogotá 15;
│   │                           #   tracts 16
├── scoring/                    # Gemini Street View scoring pipeline
│   │                           #   (versioned prompts; no imagery stored)
├── api/                        # FastAPI backend — optional, the frontend
│   │                           #   works standalone from static files
├── frontend/                   # Next.js 14 (App Router) + TypeScript +
│   ├── src/                    #   Tailwind + MapLibre GL JS
│   └── public/data/            # gitignored — populated from data/ by
│                               #   `npm run copy-data` (runs before dev/build)
├── Makefile                    # Entry point for all data builds (`make help`)
├── docker-compose.yml          # Local development full stack
├── CLAUDE.md                   # Working conventions for the repo
├── BOGOTA_DASHBOARD_INTEGRATION.md   # Design records
├── BOGOTA_SEGMENTS.md, SEGMENTS_EXTENSION.md
└── README.md
```

## Tech Stack

- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, MapLibre GL JS
- **Backend:** FastAPI (Python 3.11+), CORS-enabled REST API — optional
- **Maps:** MapLibre GL JS with CARTO Positron basemap (open-source, no API key)
- **Deployment:** Cloudflare Workers static assets (`frontend/wrangler.jsonc`,
  serving the Next.js export in `frontend/out/`), with Cloudflare R2 for
  GeoJSON too large to ship as a site asset. Docker Compose is for local
  development only.

## Quick Start

### Prerequisites

- Node.js 20+ and npm
- [uv](https://docs.astral.sh/uv/) for anything Python (API, data builds)
- Docker and Docker Compose (only for the containerized local stack)

### Frontend Only (fastest)

The frontend works standalone — no API needed. `npm run dev` copies the
committed data into `public/data/` automatically.

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Backend API (optional)

Adds per-intersection imagery detail and filtered queries. Run through uv
rather than a venv (this tree may live on a synced drive, and a venv would
sync thousands of files):

```bash
cd api
uv run --with-requirements requirements.txt uvicorn main:app --reload --port 8000
```

API docs at [http://localhost:8000/docs](http://localhost:8000/docs).

### Docker Compose (local full stack)

```bash
docker-compose up --build
```

- Frontend: [http://localhost:3000](http://localhost:3000)
- API docs: [http://localhost:8000/docs](http://localhost:8000/docs)

## Deployment

The site deploys to Cloudflare Workers as a static export. **Deploys are
manual** — pushing to `main` publishes nothing.

```bash
cd frontend
npm run build:static
npx wrangler deploy
```

Check the export locally first with `make preview` (from the repo root).

The Bogotá segment layer exceeds the 25 MiB per-asset limit for Workers
static assets, so it is published to an R2 bucket instead
(`make upload-bogota-segments`); the browser fetches it from
`NEXT_PUBLIC_R2_BASE_URL` (set in `frontend/.env.production`) only when that
layer is selected.

To publish new imagery scores: rerun
`python scoring/join_scores.py --write-geojson`, commit `data/`, then rebuild
and deploy as above.

## Rebuilding the Data

The Makefile is the entry point — run `make help` for the full target list.
Python dependencies resolve through uv; no venv setup is needed.

```bash
make check            # verify source files are present, checksum the geometry
make philly           # data/intersections.geojson + imagery-score join
make bogota           # data/bogota_zats.geojson
make data             # both of the above
make segments         # mid-block crashes → segment SPF → data/segments.geojson
make tracts           # tract SPF + ACS equity → data/tracts.geojson
make bogota-segments  # Bogotá segment SPF → data/bogota_segments.geojson
make philly-pipeline  # full Philadelphia analysis pipeline, steps 01–11
make verify           # type-check the frontend
```

Three prerequisites, documented in `pipeline/README.md` and
`data/source/README.md`:

- The Philadelphia pipeline reads raw PennDOT/GIS data from outside the
  repo; point `WALKSAFE_DATA_ROOT` at it.
- Large raw geometry in `data/source/` is gitignored by design.
  `make check` verifies what is present and checksums the Bogotá ZAT
  boundaries so a different vintage cannot silently change the join.
- `make tracts` needs a free [Census API
  key](https://api.census.gov/data/key_signup.html) (`CENSUS_API_KEY` in
  the environment or the gitignored repo-root `.env`) for the ACS pull;
  TIGER/Line tract boundaries are fetched and cached automatically.

## Data Sources

| Source | Description | Status |
|--------|-------------|--------|
| PennDOT PCDS | Crash data 2015–2024 (CRASH, PERSON tables) | Integrated |
| DVRPC / PennDOT traffic | AADT volumes (PaTraffic2024_03) | Integrated |
| Philadelphia GIS | HIN, street nodes, intersection controls, centerlines | Integrated |
| Census 2020 DHC | Block-group age/race demographics for the 15 narrowed candidate sites (100 m and 400 m catchments) with citywide comparison | Integrated (site catchments) |
| ACS 2020–2024 | Tract-level poverty for the equity overlay | Integrated (tract layer) |
| Bogotá open data | ZAT boundaries, 2015–2019 crashes, 27 built-environment features from a published ~312k-point extraction; processed by Universidad de los Andes | Integrated |
| Google Street View | Imagery input to VLM scoring; only `pano_id` and capture date are stored — imagery is never committed | Integrated (50 intersections) |
| Gemini scoring pipeline | Blind imagery safety scores (`scoring/`, versioned prompts) | Validation study complete |
| DVRPC Pedestrian Portal | Regional sidewalk inventory, crosswalks, curb ramps | To integrate |
| SPMI model outputs | GNN-produced Safety/Walkability/Accessibility scores | Pending (not built) |
| Participatory weights | Community/stakeholder preference weights | Pending (not built) |
| PedAudit results | Site-level safety audits and intervention simulations | Pending (not built) |

## Key Metrics (Philadelphia, Phase 0)

- **eb_ksi** — empirical Bayes estimate of annual pedestrian KSI crashes
  per intersection
- **Risk tiers** — Critical (eb_ksi ≥ 0.50): 150 · High (≥ 0.25): 344 ·
  Moderate (≥ 0.05): 2,803 · Low (< 0.05): 13,687
- **16,984** intersections ranked; **609** with at least one KSI crash;
  **728** KSI events; **195** pedestrian deaths; **7,762** pedestrian
  crashes of all severities
- **15** narrowed candidate sites; an **8-site** shortlist (no speed
  camera, KSI trending up) for potential instrumentation

All figures are generated into `data/summary.json` by the build and are the
numbers the dashboard serves.

## Dashboard Pages

| Page | Status | Description |
|------|--------|-------------|
| Map Explorer | **Built** | Multi-city map: five data layers, risk/crash/imagery modes, filters, info panels |
| Research | **Built** | Methods: crash data, SPF/EB, segment and tract models, imagery scoring, limitations |
| About | **Built** | Project overview, methods notes, data credits (Universidad de los Andes subcontract), team, contact |
| Data Downloads | Partial | Source attribution is live; download links are still "coming soon" |
| City Reports | Coming soon | Stub page |
| Equity Dashboard | Coming soon | Stub page |

## Environment Variables

```env
# API (read by api/main.py; docker-compose sets these)
API_HOST=0.0.0.0
API_PORT=8000
DATA_DIR=../data

# Frontend — all optional
NEXT_PUBLIC_API_URL=            # unset = fully static, no API calls
NEXT_PUBLIC_MAPLIBRE_STYLE=     # defaults to CARTO Positron
NEXT_PUBLIC_R2_BASE_URL=        # R2 public base URL for the large layers
                                #   (set for production in frontend/.env.production)
NEXT_PUBLIC_BASE_PATH=          # only for serving under a subpath
```

## Roadmap

- **Phase 0 (current):** crash-based risk maps — Philadelphia intersections,
  segments, and tracts; Bogotá ZATs and segments; imagery
  measurement-validation study
- **Phase 1:** SPMI integration as model outputs become available
- **Phase 2:** optimization results, community weights, equity dashboard
- **Phase 3:** PedAudit intervention testing, public launch
- **Phase 4:** automated updates, additional cities (Salt Lake City),
  sustainability

## Related Projects

- **WALKSAFE_site_selection** — intersection ranking pipeline this repo's
  `pipeline/` was ported from
- **pedaudit** — neurosymbolic pedestrian safety benchmark (Python + ASP)

## Funding

This dashboard and the Bogotá built-environment work are supported in part
by the [Built Environment, Pedestrian Injuries and Deep Learning (BEPIDL)
Study](https://www.fic.nih.gov/Grants/Search/Pages/irsda-k01tw011782.aspx),
NIH Fogarty International Center award K01 TW011782. The content is solely
the responsibility of the authors and does not necessarily represent the
official views of the National Institutes of Health.

## AI-Assisted Development

Much of this repository was built with Claude Code (Anthropic's coding
agent): the analysis pipeline, the dashboard, the build scripts, and most of
the documentation were drafted by Claude and reviewed before merging.
Commits record this with `Co-Authored-By` trailers and session links. Study
design, model specification, and interpretation of results are the
investigators'; every derived number is reproducible from the committed
build scripts and the provenance notes in `data/source/README.md`.

## License

MIT — see [LICENSE](LICENSE).
