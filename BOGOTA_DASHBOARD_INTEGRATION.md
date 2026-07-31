# Adding Bogotá to the dashboard

Handoff for a fresh conversation. Distinct from `scoring/BOGOTA_EXTENSION.md`,
which covers running the Gemini scorer on Bogotá imagery. This document is
about surfacing the **existing, completed** Bogotá results in the dashboard.

---

## The central problem: different spatial units

The dashboard is built around **point features** — 16,984 Philadelphia
intersections, one GeoJSON Point each, styled as circles, filtered and
ranked individually.

Bogotá's results are **area features** — 840 ZAT zones with cluster
assignments, crash counts and relative risks. Nothing about the current map
layer handles polygons.

This is the real work. It is not a data-loading exercise; it is a
generalisation of the dashboard's data model from "intersection" to
"analysis unit," with point and polygon rendering paths.

Do not try to force ZATs into the intersection schema. Introduce a second
layer type and let the city config declare which it uses.

---

## Data in hand

Two locations. Paths relative to
`~/Library/CloudStorage/OneDrive-DrexelUniversity/FICK01/`

### Geometry — `Manuscripts/AI Co-Scientist Boston 2026/`

| File | Contents |
|---|---|
| **`Zonas_ZAT.geojson`** | **The ZAT boundaries.** 27 MB, 2,356 MultiPolygon features across TWO vintages: `anio_zat` 2019 (1,141 zones) and 2023 (1,215 zones). Join key is `id_zat`. |
| `MANZ.geojson` | Manzana (block) boundaries, 129 MB. Only needed for block-level population. |
| `zat_pop60plus_2018.csv` | ZAT-level 60+ population, 2018 |
| `manzana_pop60plus_2018.csv` | Block-level 60+ population |
| `zat_profile_models_with_age60.csv` | **Newest cluster RR models** (July 30), with and without 60+ share |
| `build_zat_pop.R`, `zat_age60_analysis.R`, `section6_run.R` | The R pipeline that produced the above |
| `walksafe_poster_48x36_v2.pptx` / `.pdf` | Poster in progress |
| `dashboard_shot_a.png`, `dashboard_shot_b.png` | Dashboard screenshots used on the poster |

**Join notes.** Filter to `anio_zat == 2019` to match the 2015–2019 crash
window. That gives 1,141 zones, while the analysis files carry 840 / 783 /
770 rows depending on specification — so expect a partial join. Count and
document the unmatched zones rather than silently dropping them; on a
choropleth, missing zones must render as "no data," not as low risk.

### Results — `Results/prediction312k/ZAT profiles/`

| File | Contents |
|---|---|
| `zat_pr312k_all.csv` | 840 rows. ZAT, cluster (`clus`), 27 built-environment features |
| `profile312k_all_covar_unscaled.csv` | 783 rows. ZAT, `ses_cat`, `clus`, crash counts (`injury`, `death`, `damage`, `total`), `walk_pubt`, `pop_density`, road composition, `MEANIPM` |
| `zat_profile_predict1519_ses_ref2_RR.csv` | RRs, SES-adjusted, profile 2 reference (the July 6 poster numbers) |
| `zat_profile_predict1519_ipm_ref2_RR.csv` | Same, IPM-adjusted |
| `../reliability_by_filtering_threshold.csv` | Extraction reliability by confidence threshold |
| `../feature_stat_by_street/`, `../../sample_disagree_street/` | Street-level stats and validation disagreement examples |

⚠ **Two model specifications exist and disagree.** The July 6 file uses
profile 2 as reference (profile 1 injury RR 0.69, n = 783). The July 30
`zat_profile_models_with_age60.csv` uses a different reference with n = 770
and reports clus1 0.630, clus2 0.807, clus3 0.667 — all three significantly
protective. Pick one for display and label it precisely. Do not mix.

---

## Feature taxonomies share a common ancestor: CANVAS

The 27 Bogotá features and the Gemini scoring taxonomy both descend from
the **CANVAS pedestrian safety audit instrument**, which Quistberg
co-developed. CANVAS seeded the Bogotá item list, and the Gemini taxonomy
was built from it as well.

This is not a coincidence to be worked around — it is the reason
reconciliation is tractable, and it should be stated explicitly wherever
features are displayed or compared.

From `zat_pr312k_all.csv`: sign_traffic, traffic_light, sign_crossing,
pedestrian_light, sign_stop, sign_yield, sign_school_zone, sidewalk,
crosswalk, lane_marking, lane_bike, lane_bus, roundabout, curb, bollards,
median, median_barrier, speed_bump, trees, bus_stop, street_lights, kiosks,
parked_vehicles, sidewalk_obstruction, lane_parking, brt_station, potholes.

Most map directly onto `scoring/prompts.py` with only naming differences
(`crosswalk_marked`, `pedestrian_signal`, `street_lighting`,
`poor_pavement`). **Build the crosswalk against CANVAS as the canonical
list**, not by pairwise matching — that yields one mapping table serving
the dashboard, the Bogotá scoring extension, and any future city, and it
keeps construct definitions traceable to a validated instrument.

⚠ **Analytic consequence.** Because the taxonomies are not independent,
agreement between Gemini and STRIDE features is evidence about
*reproducibility of a shared instrument across extraction methods*, not
convergent validity from independent measurement. Do not describe them as
independent instruments in any output.

---

## Code that assumes Philadelphia

| File | What to change |
|---|---|
| `frontend/src/lib/constants.ts` | `PHILADELPHIA_CENTER`, `PHILADELPHIA_ZOOM`, `PHILADELPHIA_BOUNDS` are module constants. Move into a per-city config object. `CITIES` already exists but only toggles a label. |
| `frontend/src/lib/types.ts` | `IntersectionProperties` is Philadelphia's crash schema. Needs a sibling type for ZAT-level results, or a discriminated union on unit type. |
| `frontend/src/components/MapExplorer.tsx` | Circle layers with `promoteId: "node_id"`. Needs a fill/line path for polygons and a choropleth colour scale. |
| `frontend/src/components/Sidebar.tsx` | Filters are crash-specific (risk tier, stop type, HIN). Bogotá filters would be profile, SES stratum, RR. |
| `frontend/src/components/InfoPanel.tsx` | Assumes intersection fields throughout. |
| `frontend/src/hooks/useIntersectionData.ts` | Loads one hardcoded dataset. Needs to load per selected city. |
| `api/main.py` | Endpoints are `/api/intersections`. Consider `/api/{city}/units`. |

The cleanest sequencing is to generalise the schema first with Philadelphia
still working, then add Bogotá as the second city. Adding Bogotá by special-
casing will make the third city harder.

---

## Suggested scope for a first pass

1. Build `data/bogota_zats.geojson`: filter `Zonas_ZAT.geojson` to
   `anio_zat == 2019`, join on `id_zat` → `ZAT` against
   `profile312k_all_covar_unscaled.csv` (cluster, SES, crash counts) and
   `zat_pop60plus_2018.csv`. Simplify geometry — 27 MB of MultiPolygon is
   too heavy for the browser; target under 5 MB with mapshaper or
   `shapely.simplify`. Report the join rate. One script mirroring
   `data/build_geojson.py`.
2. Generalise the city config: centre, zoom, bounds and unit type
   (`point` vs `polygon`) move out of `constants.ts` into per-city objects.
3. Add a polygon fill layer and choropleth scale to MapExplorer, keeping
   the existing circle path for Philadelphia.
4. Make the city switcher actually switch data source, centre and bounds.
5. Bogotá InfoPanel: profile, SES stratum, crash counts, 60+ share, and the
   cluster RR with CI (stating which specification).

Stop there. Feature-level display and the ~312,000 GSV point layer can
follow once the polygon path works.

**Ecological caveat must be visible on the map itself**, not only in
methods text: these are area-level associations across 840 zones, not
individual risk, and a choropleth invites exactly that misreading.

---

## Status framing (carry over from the poster docs)

- Bogotá is **demonstrated**: published DINO/STRIDE extraction, ~312,000
  prediction points, 27 features, 840 ZATs, 2015–2019 crash models with
  significant results.
- Philadelphia is a **Phase 0 crash-based prototype** plus one completed
  VLM measurement-validation study (null after exposure adjustment).
- ZAT analyses are **ecological**: area-level associations, not individual
  risk. This caveat must appear wherever ZAT results are displayed.
- Verified RRs (2026-07-06): profile 1 injury 0.69 (0.55–0.88), death 0.62
  (0.40–0.94); SES strata 1–3 carry 1.78–2.70× risk vs stratum 6. Not
  strictly monotonic — peak at stratum 2. Do not describe it as a monotonic
  gradient.

---

## Suggested opening message for the new chat

> Integrate Bogotá into the WalkSafe-AI dashboard. Read
> `BOGOTA_DASHBOARD_INTEGRATION.md` in walksafe-ai-dashboard/ first. The
> Bogotá results are ZAT polygons, not intersection points, so the data
> model needs generalising. Start by finding the ZAT boundary geometry in
> FICK01/BogotaData/.
