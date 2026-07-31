# WalkSafe-AI Dashboard — project instructions

Public pedestrian safety dashboard plus an imagery scoring pipeline.
Part of the WalkSafe-AI R01 (NIA). Live at
https://aquistbe.github.io/walksafe-ai-dashboard/

## Scope

All work stays inside this repository. Source data may be READ from
elsewhere on disk (FICK01), but nothing is written outside this tree.
Confirm with `git rev-parse --show-toplevel` if unsure.

## Layout

```
data/         GeoJSON + build scripts. Outputs committed, large raw inputs are not.
data/source/  Build inputs. Small CSVs committed; *.geojson gitignored (see its README).
frontend/     Next.js 14 + TypeScript + Tailwind + MapLibre GL JS
scoring/      Gemini Street View scoring pipeline (Python)
api/          FastAPI backend (optional — the frontend works standalone)
```

## Environment

- **Python: use uv.** Do not create a venv inside the repo — this folder is
  on OneDrive and will sync thousands of files.
  `uv run --with geopandas --with shapely python data/build_bogota_geojson.py`
  or `make bogota PYTHON="uv run --with geopandas --with shapely python"`
- **Node 20+.** `npm run dev` copies data automatically via a predev hook.
- **OneDrive quirk:** file operations here can be slow, and locks
  occasionally block deletes. Retry rather than working around it.

## Verification — required before committing

```bash
make verify        # cd frontend && npx tsc --noEmit — must pass clean
make preview       # then open http://localhost:3000/walksafe-ai-dashboard/
```

Pushing to `main` auto-deploys to GitHub Pages via
`.github/workflows/deploy.yml`. Check the preview before pushing; a broken
build ships publicly.

## Conventions

- **Never commit secrets.** `scoring/.env` is gitignored. Keys are read
  from the environment or that file.
- **Never commit imagery.** Google's terms restrict storing Street View
  panoramas. Store `pano_id` and capture date instead.
- **Prompts are versioned.** Editing a prompt in `scoring/prompts.py`
  invalidates comparisons against prior runs. Bump the version, don't edit
  in place, once results are published.
- **Derived data is committed; large raw inputs are not.** Provenance and
  checksums live in `data/source/README.md`.

## Scientific constraints that affect the code

- **`eb_ksi` is a poor criterion for imagery validation.** Median empirical
  Bayes weight is 0.99, so it is nearly the SPF fitted value. Use observed
  `ped_ksi` with `mu_spf` as offset.
- **Exposure confounding is the central hazard.** Pedestrian infrastructure
  is installed where pedestrians and traffic are. Unadjusted, imagery
  scores correlate +0.23 with crash risk; adjusted, +0.006. Any new
  analysis relating built environment to crashes must condition on
  exposure.
- **ZAT analyses are ecological.** Area-level associations, not individual
  risk. This caveat must be visible in the UI wherever ZAT results appear.
- **Feature taxonomies are not independent.** The Bogotá 27 features and
  the Gemini taxonomy in `scoring/prompts.py` both descend from the CANVAS
  pedestrian safety audit. Never describe them as independent instruments.

## Status framing in any user-facing text

- Bogotá = demonstrated (published DINO/STRIDE extraction, ~312,000
  prediction points, 27 features, 2015–2019 crash models).
- Philadelphia = Phase 0 crash-based prototype plus one completed VLM
  measurement-validation study (null after exposure adjustment).
- SPMI, optimization, PedAudit integration = not built. Do not imply
  otherwise in UI copy.
