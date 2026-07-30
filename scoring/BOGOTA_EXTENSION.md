# Extending the imagery pipeline to Bogotá

Handoff notes. Start a fresh conversation with this file and
`scoring/README.md` as context.

## Why Bogotá is the better test

Philadelphia answered one question and closed it: **a zero-shot VLM safety
score does not predict pedestrian injury once you adjust for exposure.**
Unadjusted ρ = +0.230 (CI +0.035 to +0.408); adjusted for the safety
performance function, ρ = +0.006 (CI −0.191 to +0.202). Measurement
reliability was 0.880, so noise is not the explanation. The result is real.

What Philadelphia *cannot* answer is whether the model perceives the built
environment accurately, because there are no human audits of these
intersections. Bogotá has them. That makes it the right place for the
question that is still open and that actually matters downstream — SPMI
consumes features, and PedAudit's rulebook consumes features, not a scalar.

## Assets available in Bogotá

| Asset | Role in the design |
|---|---|
| STRIDE model | Supervised, in-domain baseline |
| Canvas audits | Human-rated ground truth |
| Human training annotations | Per-feature labels for kappa |
| Google Street View | Same imagery source as the Philadelphia pipeline |

## The three questions worth asking

1. **Feature accuracy.** Cohen's kappa per feature, Gemini vs human audit.
   This is the tractable one and it has never been answered outside Amanda
   Magalhães' Belo Horizonte work.
2. **Model comparison.** Gemini (zero-shot generalist) vs STRIDE
   (supervised, in-domain) vs SAM (segmentation, needs a class head).
   Each is evidence for something different: SAM should win on geometry —
   crossing width, sidewalk continuity — where Gemini is guessing.
3. **Transportability.** Apply STRIDE to Philadelphia and Gemini to both
   cities. Does a Bogotá-trained model survive North Philadelphia? This is
   the strongest paper of the three and fits the SALURBAL framing.

## What has to change in the pipeline

The scoring code is city-agnostic except for these:

- **Input geometry.** `score_intersections.py` reads
  `data/intersections.geojson` and expects `node_id`, `int_name`,
  `eb_ksi`, `risk_tier`, `top50`, `stoptype`, `aadt`, `mu_spf`.
  For Bogotá, supply an equivalent file. Only `node_id` and coordinates are
  strictly required for scoring; the rest are used by `validate_scores.py`.
- **Spatial unit.** Philadelphia scored intersections. The Canvas audits are
  almost certainly segment-based. Match the audit unit, and sample points
  along segments the way ELSI-Urbe did — every 25 m, eight images per point
  covering 360° — so the comparison against human raters is like-for-like.
- **Feature taxonomy.** `prompts.py` uses the ELSI-Urbe list. Reconcile it
  with the Canvas instrument before scoring; per-feature kappa is only
  meaningful if the constructs match. This is the main piece of work.
- **Language and context.** Signage is in Spanish. Test whether prompting in
  Spanish changes detection rates — that is itself a finding.
- **Crash data.** If Bogotá crash data is available, keep the exposure
  adjustment. Do NOT repeat the Philadelphia mistake of correlating against
  an EB-shrunk estimate: with a median EB weight of 0.99, that quantity is
  essentially the SPF's own fitted value.

## Things not to repeat

- **`--thinking low` is unusable.** It produced degenerate output: 32% of
  sites scored exactly 45.0, 32% had zero spread across four headings. Use
  `high`.
- **More headings will not fix a weak association.** Reliability was already
  0.880; eight headings buys 3%, sixteen buys 5%.
- **Do not correlate against an EB-shrunk outcome.** Use observed counts
  with the model expectation as an offset.
- **Never let crash context into the scoring prompt.** `prompts.py` keeps a
  `context-v1` mode for planning use; `validate_scores.py` refuses to run on
  it. The original SafeStreets app fed in Maps grounding, HIN status and
  FARS counts, which would make any validation circular.

## Suggested first step

Score 100 Bogotá segments that already have Canvas audits, using the blind
prompt with a taxonomy reconciled to the Canvas instrument, and compute
per-feature kappa. Roughly $5 and an hour. That single number — does Gemini
agree with a trained human rater on crosswalk presence in Bogotá — decides
whether any of the rest is worth building.
