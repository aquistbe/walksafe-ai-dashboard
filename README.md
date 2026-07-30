# WalkSafe-AI Dashboard

Interactive web platform for exploring pedestrian safety data, viewing the Senior Pedestrian Mobility Index (SPMI), testing interventions, and supporting community decision-making about pedestrian infrastructure. Part of the WalkSafe-AI R01 project (NIA) and integrated with the PedAudit neurosymbolic benchmark.

**Phase 0 prototype** — built on empirical Bayes analysis of PennDOT crash data (2015–2024) for 16,984 Philadelphia intersections, combined with DVRPC traffic volumes and City of Philadelphia GIS layers. SPMI model outputs will replace the crash-based risk scores as they become available from the Aim 1 GNN pipeline.

## Architecture

```
walksafe-ai-dashboard/
├── data/                  # Source GeoJSON, summary stats, build script
│   ├── intersections.geojson  # 16,984 intersections (9.8 MB)
│   ├── summary.json           # Aggregate statistics
│   └── build_geojson.py       # Reproducible data build pipeline
├── api/                   # FastAPI backend (Python)
│   ├── main.py            # REST endpoints with filtering
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/              # Next.js 14 frontend (TypeScript + Tailwind + MapLibre)
│   ├── src/
│   │   ├── app/           # App Router pages (Map Explorer, Reports, Equity, etc.)
│   │   ├── components/    # Navbar, MapExplorer, Sidebar, InfoPanel, etc.
│   │   ├── hooks/         # Data loading hooks
│   │   └── lib/           # Types, constants, utilities
│   ├── public/data/       # Static data fallback (serves without API)
│   └── Dockerfile
├── docker-compose.yml     # Full stack orchestration
└── README.md
```

## Tech Stack

- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, MapLibre GL JS
- **Backend:** FastAPI (Python 3.11+), CORS-enabled REST API
- **Maps:** MapLibre GL JS with CARTO Positron basemap (open-source, no API key)
- **Deployment:** Docker + Docker Compose, cloud-ready (Fly.io / Railway)

## Quick Start

### Prerequisites

- Node.js 20+ and npm
- Python 3.11+ (for API only)
- Docker and Docker Compose (for containerized deployment)

### Frontend Only (fastest)

The frontend works standalone — it loads data from static files in `public/data/` when the API is unavailable.

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Backend API

```bash
cd api
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

API docs at [http://localhost:8000/docs](http://localhost:8000/docs).

### Docker Compose (Full Stack)

```bash
docker-compose up --build
```

- Frontend: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:8000/api/docs](http://localhost:8000/api/docs)

### Rebuilding the Data

If source data changes (new crash years, updated GIS), rerun the build:

```bash
cd data
pip install pandas geopandas
python build_geojson.py
# Then copy to frontend static:
cp intersections.geojson summary.json ../frontend/public/data/
```

## Data Sources

| Source | Description | Status |
|--------|-------------|--------|
| PennDOT PCDS | Crash data 2015–2024 (CRASH, PERSON tables) | Complete |
| DVRPC Traffic | AADT volumes (PaTraffic2024_03) | Complete |
| Philadelphia GIS | HIN, street nodes, intersection controls, street centerlines | Complete |
| Census 2020 DHC | Block-group age/race demographics (Living Atlas) | Partial (pilot sites) |
| DVRPC Pedestrian Portal | Regional sidewalk inventory, crosswalks, curb ramps | To integrate |
| SPMI model outputs | GNN-produced Safety/Walkability/Accessibility scores | Pending (Aim 1) |
| Participatory weights | Community/stakeholder preference weights | Pending (Aim 2) |
| PedAudit results | Site-level safety audits and intervention simulations | Pending (instrumentation) |

## Key Metrics (Phase 0)

- **eb_ksi** — Empirical Bayes estimate of annual pedestrian KSI crashes per intersection
- **Risk Tiers** — Critical (eb_ksi >= 0.50, top ~1%), High (>= 0.25), Moderate (>= 0.05), Low (< 0.05)
- **16,984** intersections ranked; **783** with at least one KSI crash; **932** total KSI events; **262** fatalities
- **15 pilot candidate sites** identified for PedAudit instrumentation (no speed camera, KSI trending up)

## Dashboard Pages

| Page | Status | Description |
|------|--------|-------------|
| Map Explorer | **Built** | Interactive map with risk-coded intersections, filters, info panel |
| City Reports | Placeholder | Aggregate statistics and trends |
| Equity Dashboard | Placeholder | Demographic/socioeconomic overlay analysis |
| Data Downloads | Placeholder | Public data access and API docs |
| Research | Placeholder | Study methodology and publications |
| About | Placeholder | Project information |

## Environment Variables

```env
# API
API_HOST=0.0.0.0
API_PORT=8000
DATA_DIR=../data

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_MAPLIBRE_STYLE=https://basemaps.cartocdn.com/gl/positron-gl-style/style.json
```

## GitHub Setup

Run these commands in Terminal on your Mac:

```bash
# 1. Navigate to the project
cd ~/Library/CloudStorage/OneDrive-DrexelUniversity/Anthropic/Pedestrian\ Safety/walksafe-ai-dashboard

# 2. Clean up any stale git state and initialize fresh
rm -rf .git
git init -b main

# 3. Stage all files (node_modules excluded by .gitignore)
git add -A

# 4. Initial commit
git commit -m "Phase 0: intersection risk map prototype

- 16,984 Philadelphia intersections ranked by ped KSI (2015-2024)
- Empirical Bayes analysis: 225 Critical, 678 High, 3,464 Moderate, 12,617 Low
- MapLibre GL JS + CARTO Positron basemap (no API key needed)
- FastAPI backend with filtering endpoints (risk tier, HIN, top-50)
- Next.js 14 frontend with interactive map, sidebar filters, info panel
- Docker + docker-compose for cloud deployment
- Frontend works standalone with static data fallback"

# 5. Create the GitHub repo and push (requires gh CLI: brew install gh)
gh repo create walksafe-ai-dashboard --public --source=. --push

# Or if you prefer manual setup:
# git remote add origin git@github.com:aquistbe/walksafe-ai-dashboard.git
# git push -u origin main
```

After pushing, the repo will be at: https://github.com/aquistbe/walksafe-ai-dashboard

## Roadmap

- **Phase 0 (current):** Crash-based intersection risk map with filtering
- **Phase 1:** SPMI integration as GNN model outputs become available
- **Phase 2:** Optimization results, community weights, equity dashboard
- **Phase 3:** PedAudit intervention testing, public launch
- **Phase 4:** Automated updates, additional cities, sustainability

## Related Projects

- **WALKSAFE_site_selection/** — Intersection ranking pipeline (Python)
- **pedaudit/** — Neurosymbolic pedestrian safety benchmark (Python + ASP)
- **WalkSafe-AI R01** — NIA grant proposal

## License

MIT — see [LICENSE](LICENSE).
