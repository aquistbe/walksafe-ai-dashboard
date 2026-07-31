# Source data

Inputs to the build scripts in `data/`. Derived outputs
(`intersections.geojson`, `bogota_zats.geojson`, `summary.json`) are what
the dashboard consumes and what gets committed at the `data/` level.

## What is committed here, and what is not

**Committed** — the analysis tables. Small (~470 KB total), and they are the
research outputs a reader would need to reproduce or check the build.

**Not committed** — large raw geometry (`*.geojson`, `*.shp`, `*.zip`).
Excluded to keep clone size reasonable. Provenance and checksums below let
anyone obtain the identical file and verify it.

## Manifest

| File | Size | SHA-256 (first 16) | Committed | Source |
|---|---|---|---|---|
| `zat_pr312k_all.csv` | 340 KB | `2b210ae1bba18c57` | yes | FICK01 `Results/prediction312k/ZAT profiles/` |
| `profile312k_all_covar_unscaled.csv` | 88 KB | `d1ab47b6a7ef20a5` | yes | FICK01 `Results/prediction312k/ZAT profiles/` |
| `zat_pop60plus_2018.csv` | 32 KB | `ef4fe36108bed59c` | yes | FICK01 `Manuscripts/AI Co-Scientist Boston 2026/` |
| `zat_profile_models_with_age60.csv` | 8 KB | `0296ec3b0bbe4217` | yes | FICK01 `Manuscripts/AI Co-Scientist Boston 2026/` |
| `Zonas_ZAT.geojson` | 27 MB | `5babcd3cc6cb7a1d` | **no** | Bogotá ZAT (Zonas de Análisis de Transporte) boundaries — see below |

Full checksum for the excluded file:

```
5babcd3cc6cb7a1d483ce6adce74775b2a17696c199343f8733270f047421fcd  Zonas_ZAT.geojson
```

Verify a copy with:

```bash
shasum -a 256 data/source/Zonas_ZAT.geojson
```

## Obtaining `Zonas_ZAT.geojson`

Bogotá transport analysis zone boundaries. The working copy lives at:

```
FICK01/Manuscripts/AI Co-Scientist Boston 2026/Zonas_ZAT.geojson
```

Contains **two vintages** in one file: `anio_zat` 2019 (1,141 zones) and
2023 (1,215 zones), 2,356 MultiPolygon features total. The build filters to
2019 to match the 2015–2019 crash analysis window.

Join key is `id_zat`, matching the `ZAT` column in the analysis tables.

If regenerating from the original public source rather than the working
copy, confirm the checksum matches — a different vintage or a re-export
will change zone counts and silently alter the join.

## Data contents

**`zat_pr312k_all.csv`** — 840 ZATs. Cluster assignment (`clus`) plus 27
built-environment feature counts extracted by the DINO/STRIDE model from
~312,000 Google Street View prediction points.

**`profile312k_all_covar_unscaled.csv`** — 783 ZATs. Crash counts (`injury`,
`death`, `damage`, `total`, 2015–2019), socioeconomic stratum (`ses_cat`,
Colombian *estrato*, DANE), population density, walking/public-transport
trips, road-type composition, `MEANIPM`.

**`zat_pop60plus_2018.csv`** — ZAT-level population aged 60+, 2018 census.

**`zat_profile_models_with_age60.csv`** — Fitted cluster relative risks with
and without adjustment for the 60+ share. **Reference category is cluster
4**: the dense arterial / mass-transit corridor profile, highest on every
infrastructure count and highest crash burden.

## Reproducibility notes

- Zone counts differ across files (1,141 geometry / 840 features / 783
  covariates / 770 modelled). The build must report its join rate and carry
  unmatched zones through with nulls rather than dropping them.
- ZAT analyses are **ecological**: area-level associations, not individual
  risk.
- The 27 built-environment features derive from the **CANVAS pedestrian
  safety audit instrument**, which also seeded the Gemini scoring taxonomy
  in `scoring/prompts.py`. The two are not independent measurements.
