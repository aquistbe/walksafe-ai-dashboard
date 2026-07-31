# WalkSafe-AI dashboard — reproducible data builds
#
#   make check      verify source files are present and unmodified
#   make bogota     build data/bogota_zats.geojson from data/source/
#   make philly     rebuild data/intersections.geojson
#   make data       both
#   make verify     type-check the frontend
#   make preview    build and serve exactly as GitHub Pages will
#
# Derived outputs in data/ are committed. Large raw geometry in data/source/
# is not — see data/source/README.md for provenance and checksums.

PYTHON ?= python3
SRC    := data/source

.PHONY: help check bogota philly data verify preview clean-preview

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

philly:
	cd data && $(PYTHON) build_geojson.py

data: philly bogota

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
