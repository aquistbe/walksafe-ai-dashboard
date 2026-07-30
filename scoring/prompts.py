"""Versioned prompts and response schemas for imagery-based scoring.

Two modes exist and they are NOT interchangeable:

  BLIND (``blind-v1``)
      Vision only. No location name, no Google Maps grounding, no crash
      history, no High Injury Network status. This is the mode used for any
      analysis that will be compared against crash outcomes, because the
      comparison is only meaningful if the scorer has never seen outcome
      data. Philadelphia's HIN is itself a covariate in the empirical Bayes
      safety performance function, so leaking it into the prompt would make
      the validation doubly circular.

  CONTEXT (``context-v1``)
      The SafeStreets behaviour: location context and crash history are
      supplied and the model is asked to integrate them. Useful for planning
      and advocacy. Never use these scores to validate against ``eb_ksi``.

Prompt text is versioned deliberately. Every stored result records the
prompt version and model name so a score can always be traced to what
produced it.

Feature taxonomy follows the ELSI-Urbe virtual audit instrument so that
per-feature agreement statistics (Cohen's kappa against human raters)
remain comparable.
"""

from __future__ import annotations

PROMPT_VERSION_BLIND = "blind-v1"
PROMPT_VERSION_CONTEXT = "context-v1"

# ---------------------------------------------------------------------------
# Feature taxonomy
# ---------------------------------------------------------------------------

# Binary presence/absence features. Keys are stored verbatim in output JSON.
BINARY_FEATURES: list[tuple[str, str]] = [
    ("sidewalk_present", "A paved walkway separated from the roadway for pedestrians"),
    ("sidewalk_obstruction", "Poles, parked vehicles, vendors, debris or damage blocking the walkway"),
    ("crosswalk_marked", "Painted crossing markings across the roadway"),
    ("curb_ramp", "A sloped curb transition at the crossing point"),
    ("refuge_island", "A raised or painted island in the roadway where a pedestrian can wait mid-crossing"),
    ("median_present", "A continuous divider separating opposing directions of traffic"),
    ("pedestrian_signal", "A signal head displaying a walk/don't-walk indication for pedestrians"),
    ("traffic_light", "A vehicle traffic signal"),
    ("stop_sign", "A stop sign controlling an approach"),
    ("crossing_sign", "Signage warning drivers of a pedestrian crossing"),
    ("lane_markings", "Painted lane lines on the roadway"),
    ("street_lighting", "Street light poles or luminaires"),
    ("bike_lane", "A marked or separated lane for bicycles"),
    ("trees", "Street trees or planted vegetation along the roadway"),
    ("bus_stop", "A bus stop, shelter or transit boarding area"),
    ("slip_lane", "A dedicated right-turn lane separated by a channelizing island"),
    ("visual_obstruction", "Parked vehicles, vegetation, or structures blocking sight lines at the crossing"),
    ("poor_pavement", "Potholes, cracking, or visibly degraded roadway surface"),
]

# Categorical features. Value must be one of the listed options.
CATEGORICAL_FEATURES: list[tuple[str, list[str], str]] = [
    (
        "through_lanes",
        ["1", "2", "3", "4_or_more", "not_visible"],
        "Number of through travel lanes visible across both directions",
    ),
    (
        "crossing_distance",
        ["under_24ft", "24_to_40ft", "40_to_60ft", "over_60ft", "not_visible"],
        "Approximate unprotected crossing distance a pedestrian must cover",
    ),
    (
        "land_use",
        ["residential", "commercial", "mixed", "industrial", "institutional", "not_clear"],
        "Dominant adjacent land use",
    ),
    (
        "sidewalk_condition",
        ["good", "fair", "poor", "absent", "not_visible"],
        "Condition of the pedestrian walkway",
    ),
]

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

_FEATURE_GUIDANCE = """
For every feature below, report what is VISIBLE IN THIS IMAGE only. Do not
infer from what a street like this usually has. If a feature cannot be seen
because of image angle, occlusion, or resolution, mark it not_visible rather
than guessing. Under-reporting is preferable to fabrication.
""".strip()

BLIND_PROMPT = f"""
You are conducting a systematic street-level audit of the pedestrian
environment from a single street view image.

You are given ONE image. You do not know where it is, and you must not
speculate about the city, neighbourhood, or any crash history. Judge only
what the image shows about the physical environment.

{_FEATURE_GUIDANCE}

Then assess pedestrian risk from the built environment alone:

1. safety_score, 0 to 100, where 0 is extremely hostile to pedestrians and
   100 is fully protected. Base this ONLY on visible physical design:
   crossing exposure, traffic speed implied by lane width and geometry,
   separation between people and vehicles, sight lines, and the presence or
   absence of pedestrian infrastructure.

2. hazards: specific physical conditions in this image that endanger
   pedestrians. Be concrete about what and where. Do not list a hazard you
   cannot see.

3. interventions: countermeasures addressing the hazards you identified,
   aligned with NACTO Urban Street Design Guide practice.

4. confidence, 0 to 100, reflecting how well this image supports the
   assessment. Low resolution, obstructed views, or a vantage point far from
   the crossing should lower it.

Return JSON conforming to the schema. Do not speculate about crash history,
injury records, or whether this location is on any safety priority network.
""".strip()

CONTEXT_PROMPT_TEMPLATE = """
You are a senior transportation engineer auditing a pedestrian environment.

{context_block}

{feature_guidance}

Assess the location, integrating the context above into your risk judgement
and intervention priorities. Provide safety_score (0-100), hazards,
interventions aligned with NACTO guidance, and confidence (0-100).

Return JSON conforming to the schema.
""".strip()


def build_context_prompt(context_block: str) -> str:
    """Prompt for the crash-aware planning mode. Not for validation use."""
    return CONTEXT_PROMPT_TEMPLATE.format(
        context_block=context_block.strip(),
        feature_guidance=_FEATURE_GUIDANCE,
    )


# ---------------------------------------------------------------------------
# Response schema
# ---------------------------------------------------------------------------


def build_response_schema() -> dict:
    """OpenAPI-style schema accepted by the google-genai structured output API."""
    feature_props: dict[str, dict] = {}

    for name, desc in BINARY_FEATURES:
        feature_props[name] = {
            "type": "STRING",
            "enum": ["yes", "no", "not_visible"],
            "description": desc,
        }

    for name, options, desc in CATEGORICAL_FEATURES:
        feature_props[name] = {
            "type": "STRING",
            "enum": options,
            "description": desc,
        }

    return {
        "type": "OBJECT",
        "properties": {
            "safety_score": {
                "type": "INTEGER",
                "description": "0 (hostile) to 100 (fully protected), built environment only",
            },
            "confidence": {
                "type": "INTEGER",
                "description": "0 to 100, how well this image supports the assessment",
            },
            "summary": {
                "type": "STRING",
                "description": "Two or three sentences on the pedestrian environment shown",
            },
            "features": {
                "type": "OBJECT",
                "properties": feature_props,
                "required": [n for n, _ in BINARY_FEATURES],
            },
            "hazards": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "name": {"type": "STRING"},
                        "severity": {"type": "STRING", "enum": ["High", "Medium", "Low"]},
                        "description": {"type": "STRING"},
                        "location_in_image": {"type": "STRING"},
                    },
                    "required": ["name", "severity", "description"],
                },
            },
            "interventions": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "title": {"type": "STRING"},
                        "description": {"type": "STRING"},
                        "impact": {"type": "STRING", "enum": ["High", "Medium", "Low"]},
                        "source": {"type": "STRING"},
                        "estimated_cost": {"type": "STRING", "enum": ["$", "$$", "$$$"]},
                    },
                    "required": ["title", "description", "impact"],
                },
            },
        },
        "required": ["safety_score", "confidence", "summary", "features", "hazards", "interventions"],
    }


ALL_FEATURE_NAMES: list[str] = [n for n, _ in BINARY_FEATURES] + [
    n for n, _, _ in CATEGORICAL_FEATURES
]
BINARY_FEATURE_NAMES: list[str] = [n for n, _ in BINARY_FEATURES]
