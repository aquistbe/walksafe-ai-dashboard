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

All Bogotá inputs above derive from **City of Bogotá open data, processed by
Universidad de los Andes under subcontract to the WalkSafe-AI project.** The
FICK01 paths in the Source column are where the working copies sit, not the
origin of the data. Because the underlying records are public, redistribution
is not restricted — see "Artefacts hosted outside the repository" below.

Full checksum for the excluded file:

```
5babcd3cc6cb7a1d483ce6adce74775b2a17696c199343f8733270f047421fcd  Zonas_ZAT.geojson
```

Verify a copy with:

```bash
shasum -a 256 data/source/Zonas_ZAT.geojson
```

## Obtaining `Zonas_ZAT.geojson`

Bogotá transport analysis zone boundaries.

**Source: City of Bogotá open data. Processing by Universidad de los Andes
under subcontract to the WalkSafe-AI project.**

The working copy lives at:

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

## Bogotá street segments (`Calles_datos`)

Staged for the Bogotá segment layer.

**Source: City of Bogotá open data. Processing by Universidad de los Andes
under subcontract to the WalkSafe-AI project.** The underlying street,
crash and built-environment records are public municipal data; Uniandes
assembled and joined them. The working copy sits at FICK01
`Data/Bogota/UniAndes/Calles/Calles_datos/`, which is a filesystem path, not
a statement of origin.

| File | Size | SHA-256 (first 16) | Committed |
|---|---|---|---|
| `Calles_datos.shp` | 84 MB | `90bc79d18f6fd89b` | **no** |
| `Calles_datos.dbf` | 105 MB | `4da485a19f3f4704` | **no** |
| `Calles_datos.shx` | 788 KB | — | **no** |
| `Calles_datos.prj` | 419 B | — | yes (records the CRS) |
| `Calles_datos.cpg` | 5 B | — | yes |
| `wt_mean_ses_calle_100m.csv` | 12 MB | `1e0e10fe11ec3d34` | **no** |

**100,819 street segments, 66 attribute fields, crash counts already joined.**
`si_act_pea` is the pedestrian-crash outcome (20,608 crashes; 10,383 segments
carry at least one, 10.3%). `sini_total` is all crashes.

Built environment: `P_Ancho_Cl` mean carriageway width (m), `sum_carril` /
`av_carrile` lanes, `velcidad` speed, `semaforo` signal, `A_Calzada` /
`A_andenes` / `A_separado` areas.

`wt_mean_ses_calle_100m.csv` — 100,669 rows, SES weighted mean per street at a
100 m buffer, joining on `CodigoCL`. Carries `wt_mean` and `ses_cat`.

### Things that will bite

- **The geometry is POLYGONS, not lines.** 100,816 Polygon + 3 MultiPolygon —
  street *footprints*, which is why the area fields exist. Any documentation
  describing this layer as 100,819 LineStrings is wrong, and the size and
  rendering consequences are large: 5,128,282 vertices, roughly 108 MB of raw
  coordinates.
- **CRS is a local projection**, `PCS_CarMAGBOG` (Transverse Mercator on a
  modified GRS80 spheroid, false easting 92334.879). Reproject to EPSG:4326.
- **`sent_vial` is 100% null** — zero non-null values across all 100,819 rows.
  Do not use it for direction.
- **`MVINUMC` lane counts from the malla vial are unusable** — 1-character DBF
  field, 18% overflow, anything ≥ 10 unrecoverable. Use `sum_carril` /
  `av_carrile` here instead.
- **There is no join key to the malla vial.** `CODIGO_IDE` (e.g. 1000022) and
  `MVICIV` (e.g. 18006831) do not overlap at all, nor does any other key pair.
  So the lightweight LineString network in
  `Data/Bogota/Movilidad/Malla_Vial_Integral_Bogota_D_C` cannot be substituted
  for the heavy polygons while keeping the crash outcome.
- **Cloud placeholders.** Many files under FICK01 are OneDrive stubs that read
  as zero bytes until opened in Finder. These two were materialised before
  copying; check `ls -l` before trusting any FICK01 path.
