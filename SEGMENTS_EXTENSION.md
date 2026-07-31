# Extending Philadelphia from intersections to the street network

Handoff for a future conversation. **Do this after the Bogotá integration**
— that work generalises the data model from points to polygons, and
segments are a third geometry type that should reuse the same abstraction
rather than forcing a second refactor.

## Why this matters more than it looks

The current Philadelphia analysis ranks 16,984 intersections. The memo
(`WALKSAFE_site_selection/MEMO_intersection_ranking.md`, section 9) records
that **roughly half of pedestrian KSI in Philadelphia is mid-block** and is
excluded from an intersection-based ranking by design. Of 1,494 geocoded
pedestrian KSI crashes, 727 were coded mid-block; 458 of the 469 that failed
to snap to a node were mid-block events, not snapping failures.

So the current dashboard, by construction, cannot see half the problem. A
low-risk intersection does not imply a safe street, and the site currently
has no way to say so beyond a caveat in the Research page.

This is the single largest structural limitation of the Phase 0 work.

## Split it in two — they have very different cost and value

### Part A: segment-level crash analysis (cheap, high value)

No imagery required. Uses data already in hand.

1. Philadelphia street centerlines (city GIS — already used in the original
   pipeline for road class).
2. Assign the mid-block crashes currently discarded. The snapping logic in
   `02_snap_intersections.py` drops anything beyond 25 m of a node; those
   points fall on segments.
3. Segment-level safety performance function. **Exposure is different here**
   — segment length enters as an offset, alongside AADT and road class.
   This is not the intersection SPF with a different unit; it needs its own
   specification.
4. Empirical Bayes as before, producing a segment risk estimate comparable
   in spirit to `eb_ksi` but not numerically interchangeable with it.

Deliverable: a segment layer that, combined with the intersection layer,
accounts for the full crash burden rather than half of it.

### Part B: segment-level imagery scoring (expensive, lower priority)

Bogotá sampled ~312,000 prediction points at 25 m spacing. Philadelphia's
network is a similar order of magnitude. At the measured rate of roughly
$0.013 per Gemini call and 4 headings per point, city-wide segment scoring
runs into the thousands of dollars — plausibly the entire remaining K01
budget.

Given that the intersection-level imagery score showed **no association
with crash risk after exposure adjustment** (rho +0.006, 95% CI −0.191 to
+0.202), scaling the same instrument across the whole network is hard to
justify until the feature-accuracy question is settled in Bogotá, where
human audits exist.

Recommendation: do Part A now, defer Part B.

## The 25 m sample-and-aggregate approach — a real concern

Quistberg flagged doubt about this method, and the doubt is well founded.

Magalhães' Belo Horizonte analysis found Gemini classified points
inconsistently **within the same segment** for 55–73% of segments depending
on the feature. Our Philadelphia run found the same across headings at a
single point (sight lines 59%, pavement 55%, trees 48%). Aggregating
heterogeneous points to a segment mean discards that variation, and the
aggregation rule — any-point-positive, majority, or proportion — is a
modelling decision that materially changes the resulting variable.

Some of that inconsistency is real signal: sidewalks genuinely end
mid-block, and a tree exists on one corner and not another. Averaging it
away destroys exactly the within-segment variation that a walkability
measure ought to capture.

Alternatives worth considering before committing:

- **Keep the point as the analysis unit**, with segment as a random effect.
  Preserves within-segment variance instead of collapsing it.
- **Report the proportion, not the presence.** "Sidewalk present at 60% of
  sampled points" is a different and probably better construct than
  "segment has a sidewalk."
- **Weight by segment length** rather than treating all segments equally.
- **Sample adaptively** — denser where early points disagree.
- **Report within-segment dispersion as a variable in its own right.**
  Discontinuity may matter more for older pedestrians than mean provision;
  a sidewalk that vanishes halfway is worse than the average suggests.

The last point is the interesting one scientifically, and it is only
available if the aggregation preserves dispersion.

## Dashboard implications

Adds a third geometry type: LineString segments alongside intersection
points and (after the Bogotá work) ZAT polygons. If the Bogotá integration
introduces a proper unit-type abstraction — `point | line | polygon` with a
per-city and per-layer declaration — this becomes mostly a rendering and
styling task.

The map will need a way to show intersections and segments together without
one obscuring the other. Likely a layer toggle rather than simultaneous
display.

## Suggested opening message

> Extend the Philadelphia analysis from intersections to the full street
> network. Read SEGMENTS_EXTENSION.md first. Start with Part A only —
> segment-level crash analysis using the mid-block crashes the current
> pipeline discards. No imagery. The segment SPF needs its own
> specification with length as an offset, not the intersection model
> reapplied.
