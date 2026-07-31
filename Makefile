# WalkSafe-AI dashboard — reproducible data builds
#
#   make check            verify source files are present and unmodified
#   make bogota           build data/bogota_zats.geojson from data/source/
#   make philly           rebuild data/intersections.geojson
#   make data             both
#   make philly-pipeline  run the full analysis pipeline, 01 -> 11
#   make segments         mid-block crashes -> segment SPF -> data/segments.geojson
#   make bogota-segments  Bogota segment SPF -> data/bogota_segments.geojson
#   make upload-bogota-segments   publish that file to R2
#   make verify           type-check the frontend
#   make preview          build and serve exactly as GitHub Pages will
#
# Derived outputs in data/ are committed. Large raw geometry in data/source/
# is not — see data/source/README.md for provenance and checksums.
#
# The pipeline reads raw PennDOT/GIS data from outside the repo. Point at it
# with WALKSAFE_DATA_ROOT; see pipeline/README.md.

PYTHON ?= python3
SRC    := data/source

# The pipeline needs geopandas, statsmodels, folium and pyarrow. Run it through
# uv rather than a venv: this folder is on OneDrive and a venv would sync
# thousands of files.
UV_DEPS := --with pandas --with numpy --with geopandas --with shapely \
           --with pyarrow --with statsmodels --with folium
PIPELINE_PYTHON ?= uv run $(UV_DEPS) python

.PHONY: help check bogota philly data philly-pipeline segments bogota-segments upload-bogota-segments verify preview clean-preview

help:
	@grep -E '^#   make' $(MAKEFILE_LIST) | sed 's/^#   /  /'

# ---------------------------------------------------------------------------
# Source verification
# ---------------------------------------------------------------------------

check:
	@echo "Checking source files in $(SRC)/"
	@missing=0; \
	for f in zat_pr312k_all.csv profile312k_all_covar_unscaled.csv \
	         zat_pop60plus_2018.csv zat_profile_models_with_age60.csv \
	         Zonas_ZAT.geojson; do \
	  if [ -f "$(SRC)/$$f" ]; then \
	    printf "  %-40s ok\n" "$$f"; \
	  else \
	    printf "  %-40s MISSING\n" "$$f"; missing=1; \
	  fi; \
	done; \
	if [ $$missing -eq 1 ]; then \
	  echo ""; \
	  echo "  Large geometry is gitignored by design."; \
	  echo "  See $(SRC)/README.md for how to obtain it."; \
	  exit 1; \
	fi
	@echo "Verifying checksum of the un-committed geometry"
	@echo "5babcd3cc6cb7a1d483ce6adce74775b2a17696c199343f8733270f047421fcd  $(SRC)/Zonas_ZAT.geojson" \
	  | shasum -a 256 -c - || \
	  (echo "  CHECKSUM MISMATCH — a different vintage will silently change the join"; exit 1)

# ---------------------------------------------------------------------------
# Data builds
# ---------------------------------------------------------------------------

bogota: check
	$(PYTHON) data/build_bogota_geojson.py
	@echo "Built data/bogota_zats.geojson"

# build_geojson.py writes intersections.geojson from scratch, which DROPS the
# imagery fields that scoring/join_scores.py merges in afterwards. Running the
# build alone silently removes 50 scored intersections from the dashboard, so
# the join is chained here rather than left as a step to remember.
philly:
	cd data && $(PYTHON) build_geojson.py
	$(PYTHON) scoring/join_scores.py --write-geojson

data: philly bogota

# ---------------------------------------------------------------------------
# Analysis pipeline (needs WALKSAFE_DATA_ROOT — see pipeline/README.md)
# ---------------------------------------------------------------------------

PIPELINE_STEPS := 01_assemble_crashes 02_snap_intersections 03_exposure_covariates \
                  04_risk_measures_eb 05_verification 06_deliverables \
                  07_trend_camera_nacto 08_narrowed_map_scoring \
                  09_drone_feasibility 10_bicycle_ksi_vru 11_demographics_equity

philly-pipeline:
	@for s in $(PIPELINE_STEPS); do \
	  echo ""; echo "=== $$s ==="; \
	  (cd pipeline && $(PIPELINE_PYTHON) $$s.py) || exit 1; \
	done
	@echo ""
	@echo "Pipeline complete. Deliverables in pipeline/outputs/, QC in pipeline/outputs/qc_logs/"

SEGMENT_STEPS := 12_snap_segments 13_segment_covariates 14_segment_spf_eb

segments:
	@for s in $(SEGMENT_STEPS); do \
	  echo ""; echo "=== $$s ==="; \
	  (cd pipeline && $(PIPELINE_PYTHON) $$s.py) || exit 1; \
	done
	$(PIPELINE_PYTHON) data/build_segments_geojson.py
	@echo "Built data/segments.geojson"

# ---------------------------------------------------------------------------
# Bogota street segments
#
# The output is ~55 MB, over Cloudflare Workers' 25 MiB per-asset limit, so it
# is NOT committed and NOT served from the site origin. It lives in R2; the
# browser fetches it directly and only when someone selects that layer.
# ---------------------------------------------------------------------------

bogota-segments:
	(cd pipeline && $(PIPELINE_PYTHON) 15_bogota_segment_spf.py)
	$(PIPELINE_PYTHON) data/build_bogota_segments_geojson.py
	@echo "Built data/bogota_segments.geojson"

# Bucket and public access are configured in the Cloudflare dashboard.
R2_BUCKET   ?= walksafe-ai-data
R2_KEY      ?= bogota_segments.geojson
R2_BASE_URL ?= $(NEXT_PUBLIC_R2_BASE_URL)

# Idempotent: `r2 object put` overwrites the key, so re-running republishes
# rather than duplicating. Content-Encoding is set because the file compresses
# roughly 8x and R2 serves exactly the bytes it is given.
upload-bogota-segments:
	@test -f data/$(R2_KEY) || (echo "Missing data/$(R2_KEY) — run: make bogota-segments"; exit 1)
	@echo "Compressing data/$(R2_KEY) ..."
	@gzip -9 -c data/$(R2_KEY) > /tmp/$(R2_KEY).gz
	@ls -lh data/$(R2_KEY) /tmp/$(R2_KEY).gz | awk '{printf "  %-12s %s\n", $$5, $$9}'
	npx wrangler r2 object put $(R2_BUCKET)/$(R2_KEY) \
	  --file /tmp/$(R2_KEY).gz \
	  --content-type application/geo+json \
	  --content-encoding gzip \
	  --remote
	@rm -f /tmp/$(R2_KEY).gz
	@echo ""
	@if [ -n "$(R2_BASE_URL)" ]; then \
	  echo "Public URL: $(R2_BASE_URL)/$(R2_KEY)"; \
	else \
	  echo "Uploaded to r2://$(R2_BUCKET)/$(R2_KEY)"; \
	  echo "Set NEXT_PUBLIC_R2_BASE_URL to the bucket's public URL so the"; \
	  echo "dashboard loads it, e.g. https://data.example.org"; \
	fi

# ---------------------------------------------------------------------------
# Frontend
# ---------------------------------------------------------------------------

verify:
	cd frontend && npx tsc --noEmit
	@echo "Type check passed"

preview:
	cd frontend && npm run preview:pages

clean-preview:
	rm -rf frontend/out frontend/.preview
