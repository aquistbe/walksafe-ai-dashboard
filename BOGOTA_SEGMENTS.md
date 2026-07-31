# Bogotá segment- and intersection-level risk

Goal: display Bogotá risk at street-segment level alongside the ZAT
choropleth, with a layer toggle, matching how Philadelphia shows
intersections.

**Status: the segment layer is built and live.** This document began as a
forward-looking spec written before the work started. It has been corrected
against what was actually found and shipped, and it is kept as a record of
why the plan changed rather than replaced with a clean description of the
result. Two of its original assumptions were wrong, and both changed the
architecture — see "What changed, and why" below.

Implementation: `pipeline/15_bogota_segment_spf.py`,
`data/build_bogota_segments_geojson.py`, dataset `bogota-segments` in
`frontend/src/lib/cities.ts`.

---

## What changed, and why

Two discoveries drove the design away from what this document originally
proposed.

**1. The geometry is polygons, not lines.**

`Calles_datos.shp` is 100,816 Polygons and 3 MultiPolygons — street
*footprints*, not centerlines. That is why the layer carries `A_Calzada`,
`A_andenes` and `A_separado`: they are areas. An earlier version of this
document described it as "100,819 LineStrings", which is wrong and had two
consequences.

- **Size.** 5,128,282 vertices, roughly 108 MB of raw coordinates — an order
  of magnitude more than a centerline network. A line layer of the same city
  (`Malla_Vial_Integral`) carries 410,360 vertices for 136,957 features.
- **Simplification tolerance.** Street footprints are long thin rectangles
  with a median carriageway width of 6.14 m. Douglas-Peucker at a tolerance
  above roughly half the width collapses the rectangle into a triangle, so
  the 5–10 m tolerances that suit a zone boundary destroy the street. The
  build uses **1.0 m**, which removes 98% of vertices (5,128,282 → 101,955)
  while leaving the rectangles intact.

The obvious escape was checked and does not exist: `Malla_Vial_Integral` is
genuine LineString geometry 12× lighter, but `CODIGO_IDE` and `MVICIV` do
not overlap at all, and no other key pair joins either. The light geometry
and the crash outcome cannot be brought together.

**2. PMTiles was deferred; the file is hosted on R2 instead.**

This document originally argued that vector tiles were the answer and should
be done before adding a third city. The forcing constraint turned out to be
different from the one assumed.

The deployment moved to Cloudflare Workers static assets, which cap a single
asset at **25 MiB**, fixed on every plan — paying more raises the file
*count*, not the file *size*. Measured against that cap, plain GeoJSON could
not work at any useful schema: geometry alone with **zero properties** was
16.8 MB, and a minimum viable seven-field schema reached 28.5 MB. Subsetting
did not rescue it either, since 99,597 of 100,819 segments carry a measured
width — there is no natural analysis subset materially smaller than the whole
network.

R2 is a different product: no per-object limit that matters here, zero
egress, and the browser fetches the file directly. That removed the size
constraint without a tiling pipeline, so the layer shipped as GeoJSON:

- **54.7 MB raw, 6.9 MB on the wire** — the upload gzips and sets
  `Content-Encoding: gzip`; R2 serves exactly the bytes it is given, so
  without that header a visitor would download all 54.7 MB.
- **Lazy-loaded per dataset.** Only someone who selects the Bogotá segment
  layer pays for it. Bogotá defaults to the ZAT layer.
- `make bogota-segments` builds it; `make upload-bogota-segments` publishes
  it, idempotently.

**PMTiles remains the eventual answer for speed**, and would also help
Philadelphia's 20 MB segment layer and 9.8 MB intersection layer. It is no
longer blocking, and it was not done in this pass. The decision was to ship a
working layer and keep tiling as a performance project rather than a
prerequisite.

---

## Data

Everything below is **City of Bogotá open data. Processing by Universidad de
los Andes under subcontract to the WalkSafe-AI project.** The FICK01 paths
are where working copies sit, not the origin. Because the records are public,
redistribution is unrestricted — the R2 upload and a future Zenodo deposit
are both fine.

### Used — segment geometry with attributes and crash counts

`FICK01/Data/Bogota/UniAndes/Calles/Calles_datos/Calles_datos.shp` (+ `.dbf`)

- **n = 100,819 street-footprint POLYGONS**, 66 fields
- Crash counts already joined: `sini_total` (all crashes),
  **`si_act_pea` (pedestrian-involved crashes)** — 20,608 across 10,383
  segments, 10.3% of the network
- Built environment: `P_Ancho_Cl` (mean carriageway width, m),
  `sum_carril` / `av_carrile` (lanes), `A_Calzada`, `A_andenes`,
  `A_separado`, `velcidad` (speed), `semaforo` (signal)

BEPIDL-coded twin, if the standardised indicator names are wanted:
`UniAndes/Calles/Calles_2024_02_07/STREET LEVEL.xlsx`, sheet `datos_calles`
(`BEPRDWITHAVEST`, `BEPNUMLANEST`, `BEPAVELANEST`, `BEPMAXSPEEDST`).

### Used — street-level covariates

`FICK01/Results/Analysis_output_HX2024/SES_street/wt_mean_ses_calle_100m.csv`
— SES weighted means per street, joining on `CodigoCL` at 99.9%. A `_500m`
variant exists at the wider radius.

### Not yet used — intersection level

`FICK01/Data/Bogota/UniAndes/Intersections/DATOS_CRUCES.xlsx` — MIN/MAX/
PROMEDIO ANCHO CALZADA, TOTAL CARRILES. Geometry in
`UniAndes/Intersections/shapes/`. Still the natural next addition.

### The gap this work filled

Heli's `Analysis_output_HX2024` outputs are **descriptive** —
`feature_stat_by_street/feature_stat312k.csv` is a 19-row summary table, one
row per feature, not per-segment values; `correlation_matrix312k.csv` is a
correlation matrix. The published Bogotá models are **ZAT-level**. There was
no per-segment risk estimate. Producing one was the work.

---

## What was built

### Segment safety performance function

Mirrors the Philadelphia specification in `pipeline/14_segment_spf_eb.py`:
negative binomial with log length as an offset, then empirical Bayes.

```
outcome     si_act_pea (pedestrian-involved crashes)
offset      log(length_km)
covariates  width, lanes, speed, signal presence, SES (estrato factor)
            n = 99,338 carrying 20,527 crashes
            alpha 3.046   pseudo-R2 0.089
            width +0.223  lanes +0.552  signal +1.277  speed -0.017
            SES peaks at stratum 2 (+0.51), declines to -0.80 at stratum 6
```

Two departures from Philadelphia, both forced by the data:

- **Length is derived**, as carriageway area / carriageway width, because a
  polygon layer has no length attribute. Exposure therefore *includes*
  junctions; Philadelphia subtracts a 25 m intersection influence zone.
- **There is no road-class field.** `CodigoCL` is uniformly "CL", a
  sequential id, and no other field carries a hierarchy. Width, lanes and
  speed carry it directly. The `class` in the output GeoJSON is derived from
  lanes and width purely so the shared line renderer has something to style
  with — a display convenience, not a source attribute.

**Empirical Bayes behaves much better here than in Philadelphia.** Median
weight 0.797 across all units, but where crashes actually are the
crash-weighted mean is 0.411 — **58.9% observed**, against 16.5% for
Philadelphia. That follows directly from 10.3% of segments carrying a crash
versus 1.5%. The Philadelphia caveat that the EB estimate is nearly the SPF
fitted value does **not** transfer.

The crash window is assumed to be 2015–2019, matching the ZAT models. The
shapefile carries no window field; the sibling source
`bogota_atropellos_2015_2019_mallavial.json` names that range and the totals
are consistent with the ZAT layer. Recorded as an assumption, not a fact.

### Layer toggle

The city switcher switches **cities**; a second control switches **datasets
within a city**. Modelled explicitly in `cities.ts`: geography and research
maturity belong to the city, everything about the analysis unit belongs to
the dataset.

| City | Datasets |
|---|---|
| Philadelphia | intersections (point), segments (line) |
| Bogotá | ZATs (polygon, default), segments (line) |
| Bogotá | intersections (point) — not built |

Exclusive, not simultaneous: segments over ZATs would be unreadable at city
scale, and stacking two risk ramps invites cross-reading measures that are
not comparable.

---

## Gotchas

- **The geometry is polygons.** See above. This is the single most
  consequential thing to know about this layer.
- **`sent_vial` is 100% null** — zero non-null values across all 100,819
  rows. Do not use it for direction.
- **Cloud placeholders.** Many FICK01 files read as zero bytes until opened
  in Finder. Check `ls -l` before trusting any FICK01 path.
- **Read the `.shp`, not the `.dbf` alone** — the dbf has attributes but no
  geometry.
- **CRS is `PCS_CarMAGBOG`**, a local Transverse Mercator on a modified GRS80
  spheroid. Reproject to EPSG:4326 for display, EPSG:3116 for metric work.
- **`MVINUMC` lane counts from the malla vial are unreliable** (1-char DBF
  field, 18% overflow `*`, anything ≥ 10 unrecoverable). Use `sum_carril` /
  `av_carrile` from `Calles_datos` instead.
- **Width is not available at ZAT level** — only segment, intersection and
  census section. The segment layer therefore adds a variable the ZAT layer
  structurally cannot have, which is itself a reason to build it.

## Comparability

Bogotá segment risk is **not** numerically comparable to Philadelphia's, and
neither is comparable to the ZAT layer:

- different outcome — pedestrian-involved crashes here, killed-or-seriously-
  injured there
- different exposure — junctions included here, excluded there
- different covariates and a different model

The UI states this on the map, in the legend and in the info panel, and
`metadata.not_comparable_to` says it inside the file.

The 27 Bogotá built-environment features and the Gemini scoring taxonomy in
`scoring/prompts.py` both descend from the **CANVAS pedestrian safety audit
instrument**. They are not independent instruments and must not be described
as such.

## What is left

1. **Bogotá intersections** — `DATOS_CRUCES.xlsx` is a smaller, cleaner
   addition now that the segment path works.
2. **PMTiles for all layers** — a performance project, not a blocker. Would
   take the four layers from ~90 MB of GeoJSON to a few MB of tiles and
   remove the R2 special case.
