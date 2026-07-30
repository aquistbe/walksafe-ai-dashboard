# Imagery scoring pipeline

Ports the SafeStreets AI Studio prototype into a reproducible batch pipeline
that scores WalkSafe-AI intersections from Street View imagery, then compares
those scores against crash-based risk.

## Why this is not just the SafeStreets app in a loop

The AI Studio app feeds crash context into the scoring prompt. Three places do
this: the location lookup asks Gemini to search for crashes and High Injury
Network status, the analysis prompt instructs it to weight realized risk, and
an NHTSA FARS call injects fatality counts.

That is the right design for a planning tool and the wrong one for validation.
Philadelphia's High Injury Network is a covariate in the empirical Bayes
safety performance function used to rank these intersections, carrying the
largest coefficient in the model (+1.09). A scorer that reads the HIN and is
then correlated against a model that uses the HIN is measuring itself.

So this pipeline runs a **blind** prompt: one image, no location name, no
grounding, no crash history. Scores produced this way can be compared against
`eb_ksi` honestly. The crash-aware mode is preserved in `prompts.py` as
`context-v1` for planning use, and the validation script refuses to run on it.

## Setup

macOS has no `python` or `pip` on PATH — only `python3`. Recent macOS also
refuses `pip install` outside a virtual environment. A venv solves both:

```bash
cd scoring
python3 -m venv .venv
source .venv/bin/activate          # rerun this in every new shell
python -m pip install -r requirements.txt
```

With the venv active, plain `python` and `pip` work. Without it, substitute
`python3` everywhere below.

Then set real API keys (the values below are placeholders — replace them):

```bash
export GEMINI_API_KEY='your-key-here'        # https://aistudio.google.com/apikey
export GOOGLE_MAPS_API_KEY='your-key-here'   # Street View Static API must be enabled
```

Confirm they took, rather than discovering mid-run that you exported a literal
placeholder:

```bash
echo "${GEMINI_API_KEY:0:6}..."   # should print the first characters of a real key
```

## Run

```bash
# 1. Confirm plumbing with no API calls and no cost
python score_intersections.py --limit 5 --mock

# 2. Score the 50 highest-ranked intersections
python score_intersections.py --top50

# 3. Merge into the dashboard data
python join_scores.py --write-geojson

# 4. Compare against crash-based risk
python validate_scores.py --csv validation.csv
```

Runs resume automatically — intersections that already have a result file are
skipped, so an interrupted run costs nothing to restart. Use `--overwrite` to
force rescoring.

## Speed

Two settings dominate runtime.

`--workers` (default 8) controls how many intersections are scored in
parallel. This is the big lever: the work is almost entirely spent waiting on
network calls, so concurrency scales nearly linearly. Measured on a simulated
1-second-per-call workload, 8 workers ran 7.7× faster than sequential.

`--thinking` (default `low`) controls model reasoning depth. The original
SafeStreets app used `high`, which roughly triples latency per call. Reading
features off a single image is perception rather than reasoning, so `low` is
usually the right trade. Use `--thinking high` if you want to match the
original behaviour, and compare a handful of sites both ways before assuming
it matters.

```bash
python score_intersections.py --top50 --workers 12          # faster
python score_intersections.py --top50 --workers 3           # gentler on quota
python score_intersections.py --top50 --headings 0,180      # half the cost and time
```

If you start seeing 429 rate-limit errors, lower `--workers`. They are retried
with exponential backoff, so a few are harmless, but a wall of them means you
are pushing past your quota. Free-tier Gemini keys have far lower limits than
paid ones.

Halving the headings halves both cost and runtime, at the price of a weaker
uncertainty estimate — two views still give you a spread, just a noisier one.

### Useful selections

```bash
python score_intersections.py --risk-tier Critical        # 225 sites
python score_intersections.py --node-ids 16990,14162      # specific sites
python score_intersections.py --limit 200                 # highest eb_ksi first
```

## What it does per intersection

1. Calls the Street View **metadata** endpoint, which is free. This checks
   whether imagery exists before spending anything and records the capture
   date and panorama id.
2. Fetches images at four headings (0, 90, 180, 270) from that one panorama.
3. Scores **each heading separately** with the blind prompt at temperature 0.
4. Aggregates, keeping the spread as well as the central estimate.

Per-heading scoring is deliberate. The ELSI-Urbe comparison found Gemini gave
inconsistent classifications across points within a single segment for 55–73%
of segments depending on the feature. That dispersion is information about
measurement reliability, and averaging it away inside one multi-image call
would discard it. Here it becomes `safety_score_sd` and a per-feature `mixed`
flag, which is also the model-uncertainty estimate Aim 1 requires.

## Aggregation is a modelling decision

Binary features are stored as **both** `any` (any heading saw it) and
`proportion` (share of headings that saw it). These are different variables
and will produce different SPMI scores. The pipeline does not choose for you;
`join_scores.py` currently surfaces `any` to the dashboard and keeps
`proportion` available.

## Cost

Roughly $0.013 per heading, so about $0.05 per intersection at four headings.

| Scope | Intersections | Approx cost |
|---|---|---|
| Smoke test | 5 | $0.25 |
| Top 50 | 50 | $2.60 |
| Critical tier | 225 | $12 |
| Critical + High | 903 | $47 |
| All | 16,984 | $880 |

The script prints an estimate and asks for confirmation before spending.
Start with the top 50 — that is enough to see whether the correlation exists
before committing to a full run.

## Imagery storage

Panoramas are **not** saved by default. Google's terms restrict caching Street
View imagery, so the pipeline persists the `pano_id` and capture date instead,
which is sufficient to retrieve the identical image again. `--cache-images`
writes JPEGs to `results/images/` for debugging; that directory is gitignored.

This is the main argument for moving to Mapillary for the research corpus:
CC-BY-SA imagery can be archived and reprocessed, which matters when you want
to re-run a new model over the same images two years from now.

## Reproducibility

Every record stores the model name, prompt version, run timestamp, panorama
id, and imagery capture date. Prompts are versioned in `prompts.py` and should
be bumped rather than edited in place once a run has been published.

`gemini-3-flash-preview` is a preview model and will change under you. Pin a
stable version before any run whose results you intend to publish.

## Output

```
scoring/results/<node_id>.json     full record, per-heading detail
data/imagery_scores.json           compact lookup for the dashboard
data/intersections.geojson         enriched with --write-geojson
```

## Files

| File | Purpose |
|---|---|
| `prompts.py` | Versioned prompts, feature taxonomy, response schema |
| `score_intersections.py` | Batch runner |
| `join_scores.py` | Merge into dashboard data |
| `validate_scores.py` | Correlation and disagreement analysis |
