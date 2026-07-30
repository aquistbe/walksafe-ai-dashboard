#!/usr/bin/env python3
"""Batch imagery scorer for WalkSafe-AI intersections.

Reads ``data/intersections.geojson``, captures Street View imagery at several
headings per intersection, scores each image with Gemini using the BLIND
prompt, and writes one JSON record per intersection keyed by ``node_id``.

Design notes
------------
Per-heading scoring, not one call with four images. Amanda's ELSI-Urbe
comparison found Gemini classified points inconsistently within the same
segment for 55-73% of segments depending on the feature. That dispersion is
real information: scoring each heading separately lets us report the spread
as an uncertainty estimate rather than hiding it inside a single call.

The Street View *metadata* endpoint is free and is always called first. It
tells us whether imagery exists at all and when it was captured, so we never
pay for a missing panorama and every score carries an imagery date.

Imagery itself is not stored by default. Google's terms restrict caching
panoramas; we persist the pano_id and capture date, which is enough to
re-retrieve the same image later. Use --cache-images only for debugging.

Usage
-----
    # Confirm the plumbing without spending anything
    python score_intersections.py --limit 5 --mock

    # Real run over the 50 highest-ranked intersections
    export GEMINI_API_KEY=...
    export GOOGLE_MAPS_API_KEY=...
    python score_intersections.py --top50 --headings 0,90,180,270

    # Resume an interrupted run (already-scored nodes are skipped)
    python score_intersections.py --top50
"""

from __future__ import annotations

import argparse
import json
import os
import random
import ssl
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlencode
from urllib.request import urlopen
from urllib.error import HTTPError, URLError

from prompts import (
    BLIND_PROMPT,
    PROMPT_VERSION_BLIND,
    BINARY_FEATURE_NAMES,
    CATEGORICAL_FEATURES,
    build_response_schema,
)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
DEFAULT_GEOJSON = REPO / "data" / "intersections.geojson"
DEFAULT_OUTDIR = HERE / "results"

SV_METADATA_URL = "https://maps.googleapis.com/maps/api/streetview/metadata"
SV_IMAGE_URL = "https://maps.googleapis.com/maps/api/streetview"

DEFAULT_MODEL = "gemini-3-flash-preview"
DEFAULT_HEADINGS = [0, 90, 180, 270]
DEFAULT_SIZE = "640x640"
DEFAULT_FOV = 90
DEFAULT_PITCH = 0

# Rough unit costs, only used for the pre-run estimate.
COST_PER_SV_IMAGE = 0.007
COST_PER_GEMINI_CALL = 0.006


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@dataclass
class Stats:
    nodes_attempted: int = 0
    nodes_scored: int = 0
    nodes_skipped_existing: int = 0
    nodes_no_imagery: int = 0
    images_fetched: int = 0
    gemini_calls: int = 0
    prompt_tokens: int = 0
    output_tokens: int = 0
    thinking_tokens: int = 0
    errors: list[str] = field(default_factory=list)


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def looks_like_placeholder(val: str) -> bool:
    """True for empty, dotted, or implausibly short values.

    Catches the common case of pasting `export KEY=...` from documentation
    verbatim, which leaves a literal '...' in the shell for the rest of the
    session and silently shadows anything else.
    """
    v = (val or "").strip()
    return not v or v.strip(".") == "" or len(v) < 20


def load_dotenv(path: Path) -> list[str]:
    """Read KEY=value lines from a .env file into os.environ.

    A genuine environment variable wins, so an explicit `export` still
    overrides the file — but a placeholder value does NOT win, otherwise a
    stale `export KEY=...` in the current shell would shadow a valid .env.
    """
    if not path.exists():
        return []
    loaded: list[str] = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip("'\"")
        if not key or not val:
            continue
        if looks_like_placeholder(os.environ.get(key, "")):
            os.environ[key] = val
            loaded.append(key)
    return loaded


_SSL_CTX: ssl.SSLContext | None = None


def ssl_context() -> ssl.SSLContext:
    """Build an SSL context with a working CA bundle.

    Python installed from python.org on macOS ships without root
    certificates, so HTTPS fails with CERTIFICATE_VERIFY_FAILED until you run
    its "Install Certificates.command". Rather than depending on that, use
    certifi's bundle when it is available — it almost always is, since
    google-genai pulls in httpx which depends on it.
    """
    global _SSL_CTX
    if _SSL_CTX is None:
        try:
            import certifi  # noqa: PLC0415

            _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
        except ImportError:
            _SSL_CTX = ssl.create_default_context()
    return _SSL_CTX


def http_get(url: str, params: dict, timeout: int = 30) -> bytes:
    full = f"{url}?{urlencode(params)}"
    with urlopen(full, timeout=timeout, context=ssl_context()) as resp:
        return resp.read()


class FatalConfigError(RuntimeError):
    """A problem no amount of retrying will fix. Aborts the run."""


def _is_cert_error(exc: BaseException) -> bool:
    if isinstance(exc, ssl.SSLCertVerificationError):
        return True
    reason = getattr(exc, "reason", None)
    if isinstance(reason, ssl.SSLCertVerificationError):
        return True
    return "CERTIFICATE_VERIFY_FAILED" in str(exc)


def with_retry(fn, attempts: int = 4, base_delay: float = 1.5):
    """Retry with exponential backoff and jitter on transient failures."""
    last: Exception | None = None
    for i in range(attempts):
        try:
            return fn()
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            last = exc
            # A missing CA bundle is a setup problem, not a transient one.
            if _is_cert_error(exc):
                raise FatalConfigError(
                    "TLS certificate verification failed.\n"
                    "  Python has no CA bundle. Fix with either:\n"
                    "    python -m pip install --upgrade certifi\n"
                    "  or, for a python.org install:\n"
                    "    /Applications/Python*/Install\\ Certificates.command"
                ) from exc
            status = getattr(exc, "code", None)
            # Client errors other than rate limiting will not fix themselves.
            if status is not None and 400 <= status < 500 and status != 429:
                raise
            if i == attempts - 1:
                break
            delay = base_delay * (2**i) + random.uniform(0, 0.5)
            time.sleep(delay)
        except Exception as exc:  # noqa: BLE001 - SDK raises its own types
            last = exc
            if i == attempts - 1:
                break
            time.sleep(base_delay * (2**i) + random.uniform(0, 0.5))
    raise last  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Street View
# ---------------------------------------------------------------------------


def streetview_metadata(lat: float, lng: float, api_key: str, radius: int = 40) -> dict:
    """Free availability check. Returns status, pano_id, date, exact location."""
    params = {
        "location": f"{lat},{lng}",
        "radius": radius,
        "source": "outdoor",
        "key": api_key,
    }
    raw = with_retry(lambda: http_get(SV_METADATA_URL, params))
    return json.loads(raw.decode("utf-8"))


def streetview_image(
    pano_id: str,
    heading: int,
    api_key: str,
    size: str = DEFAULT_SIZE,
    fov: int = DEFAULT_FOV,
    pitch: int = DEFAULT_PITCH,
) -> bytes:
    """Fetch one JPEG. Addressed by pano_id so headings share one panorama."""
    params = {
        "pano": pano_id,
        "size": size,
        "heading": heading,
        "fov": fov,
        "pitch": pitch,
        "return_error_code": "true",
        "key": api_key,
    }
    return with_retry(lambda: http_get(SV_IMAGE_URL, params))


# ---------------------------------------------------------------------------
# Gemini
# ---------------------------------------------------------------------------


class Scorer:
    """Wraps the Gemini client. ``mock=True`` produces plausible fake output."""

    def __init__(
        self,
        api_key: str | None,
        model: str,
        mock: bool = False,
        thinking: str = "low",
    ):
        self.model = model
        self.mock = mock
        self.thinking = thinking
        self.schema = build_response_schema()
        self._client = None
        self._thinking_warned = False
        if not mock:
            try:
                from google import genai  # noqa: PLC0415
            except ImportError:  # pragma: no cover
                sys.exit(
                    "google-genai is not installed. Run:\n"
                    "    pip install -r scoring/requirements.txt"
                )
            if not api_key:
                sys.exit("GEMINI_API_KEY is not set.")
            self._client = genai.Client(api_key=api_key)

    def _thinking_config(self, types_mod):
        """Reduce reasoning depth to cut latency.

        Feature extraction from a single image is a perception task, not a
        reasoning one, and high thinking roughly triples time per call for
        little benefit here. The SDK surface for this differs between model
        generations, so try the options and degrade quietly.
        """
        if self.thinking == "high":
            return None  # model default

        try:
            level = getattr(types_mod, "ThinkingLevel", None)
            if level is not None:
                name = "LOW" if self.thinking == "low" else "MINIMAL"
                val = getattr(level, name, None) or getattr(level, "LOW", None)
                if val is not None:
                    return types_mod.ThinkingConfig(thinking_level=val)
        except Exception:  # noqa: BLE001
            pass

        try:
            budget = 0 if self.thinking == "off" else 512
            return types_mod.ThinkingConfig(thinking_budget=budget)
        except Exception:  # noqa: BLE001
            if not self._thinking_warned:
                log("  note: this SDK/model ignores thinking config; using defaults")
                self._thinking_warned = True
            return None

    def score_image(self, image_bytes: bytes) -> dict:
        if self.mock:
            return self._mock_result()

        from google.genai import types  # noqa: PLC0415

        cfg_kwargs = {
            "response_mime_type": "application/json",
            "response_schema": self.schema,
            # Deterministic decoding. Variation across headings should come
            # from the imagery, not from sampling noise.
            "temperature": 0.0,
        }
        tc = self._thinking_config(types)
        if tc is not None:
            cfg_kwargs["thinking_config"] = tc

        def _call():
            try:
                return self._client.models.generate_content(  # type: ignore[union-attr]
                    model=self.model,
                    contents=[
                        types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                        BLIND_PROMPT,
                    ],
                    config=types.GenerateContentConfig(**cfg_kwargs),
                )
            except TypeError:
                # Older SDK without thinking_config support.
                cfg_kwargs.pop("thinking_config", None)
                return self._client.models.generate_content(  # type: ignore[union-attr]
                    model=self.model,
                    contents=[
                        types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                        BLIND_PROMPT,
                    ],
                    config=types.GenerateContentConfig(**cfg_kwargs),
                )

        resp = with_retry(_call)
        text = getattr(resp, "text", None)
        if not text:
            raise RuntimeError("Gemini returned no text")

        result = json.loads(text)

        # Record token usage from the response itself. Cloud billing can lag
        # by a day or more, so this is the only immediate, exact measure of
        # what a run actually cost.
        um = getattr(resp, "usage_metadata", None)
        if um is not None:
            result["_usage"] = {
                "prompt_tokens": getattr(um, "prompt_token_count", None),
                "output_tokens": getattr(um, "candidates_token_count", None),
                "thinking_tokens": getattr(um, "thoughts_token_count", None),
                "total_tokens": getattr(um, "total_token_count", None),
            }
        return result

    @staticmethod
    def _mock_result() -> dict:
        rng = random.Random()
        feats = {n: rng.choice(["yes", "no", "not_visible"]) for n in BINARY_FEATURE_NAMES}
        for name, options, _ in CATEGORICAL_FEATURES:
            feats[name] = rng.choice(options)
        return {
            "safety_score": rng.randint(15, 85),
            "confidence": rng.randint(50, 95),
            "summary": "MOCK RESULT - no API call was made.",
            "features": feats,
            "hazards": [
                {
                    "name": "Wide unprotected crossing",
                    "severity": "High",
                    "description": "MOCK",
                    "location_in_image": "centre",
                }
            ],
            "interventions": [
                {
                    "title": "Add pedestrian refuge island",
                    "description": "MOCK",
                    "impact": "High",
                    "source": "NACTO Urban Street Design Guide",
                    "estimated_cost": "$$",
                }
            ],
        }


# ---------------------------------------------------------------------------
# Aggregation across headings
# ---------------------------------------------------------------------------


def aggregate(per_heading: list[dict]) -> dict:
    """Combine per-heading results into one record per intersection.

    Binary features report BOTH ``any`` and ``proportion``. The choice between
    them is a modelling decision, not a detail: 'any heading shows a crosswalk'
    and 'most headings show a crosswalk' are different variables and will give
    different SPMI scores. Both are stored so the decision stays downstream and
    explicit.
    """
    scored = [r for r in per_heading if r.get("result")]
    if not scored:
        return {}

    results = [r["result"] for r in scored]

    scores = [r["safety_score"] for r in results if isinstance(r.get("safety_score"), int)]
    confs = [r["confidence"] for r in results if isinstance(r.get("confidence"), int)]

    mean_score = sum(scores) / len(scores) if scores else None
    if len(scores) > 1 and mean_score is not None:
        var = sum((s - mean_score) ** 2 for s in scores) / (len(scores) - 1)
        sd_score = var**0.5
    else:
        sd_score = 0.0

    features: dict[str, Any] = {}

    for name in BINARY_FEATURE_NAMES:
        vals = [r.get("features", {}).get(name) for r in results]
        vals = [v for v in vals if v in ("yes", "no", "not_visible")]
        visible = [v for v in vals if v != "not_visible"]
        n_yes = sum(1 for v in visible if v == "yes")
        features[name] = {
            "any": n_yes > 0,
            "proportion": round(n_yes / len(visible), 3) if visible else None,
            "n_visible": len(visible),
            "n_headings": len(vals),
            # Disagreement across headings of the same intersection.
            "mixed": 0 < n_yes < len(visible),
        }

    for name, _options, _desc in CATEGORICAL_FEATURES:
        vals = [r.get("features", {}).get(name) for r in results]
        vals = [v for v in vals if v]
        informative = [v for v in vals if v not in ("not_visible", "not_clear")]
        modal = max(set(informative), key=informative.count) if informative else None
        features[name] = {
            "modal": modal,
            "values": vals,
            "agreement": round(informative.count(modal) / len(informative), 3)
            if informative and modal
            else None,
        }

    # Deduplicate hazards and interventions by title, keeping worst severity.
    sev_rank = {"High": 3, "Medium": 2, "Low": 1}
    hazards: dict[str, dict] = {}
    for r in results:
        for h in r.get("hazards", []) or []:
            key = (h.get("name") or "").strip().lower()
            if not key:
                continue
            prev = hazards.get(key)
            if prev is None or sev_rank.get(h.get("severity", "Low"), 0) > sev_rank.get(
                prev.get("severity", "Low"), 0
            ):
                hazards[key] = h

    interventions: dict[str, dict] = {}
    for r in results:
        for iv in r.get("interventions", []) or []:
            key = (iv.get("title") or "").strip().lower()
            if key and key not in interventions:
                interventions[key] = iv

    return {
        "safety_score_mean": round(mean_score, 1) if mean_score is not None else None,
        "safety_score_sd": round(sd_score, 2),
        "safety_score_min": min(scores) if scores else None,
        "safety_score_max": max(scores) if scores else None,
        "confidence_mean": round(sum(confs) / len(confs), 1) if confs else None,
        "n_headings_scored": len(scored),
        "features": features,
        "hazards": list(hazards.values()),
        "interventions": list(interventions.values()),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def select_nodes(geojson: dict, args) -> list[dict]:
    feats = geojson["features"]

    # Stratified random sample across risk tiers.
    #
    # This is the selection to use for validation. The top-50 set is entirely
    # Critical-tier, signalized, High Injury Network arterials, so eb_ksi
    # barely varies within it. Correlating an imagery score against an
    # outcome with almost no variance is a restricted-range design: it
    # attenuates the correlation toward zero regardless of how good the
    # scorer is. Sampling across tiers restores the variance the test needs.
    if args.stratify:
        rng = random.Random(args.seed)
        by_tier: dict[str, list[dict]] = {}
        for f in feats:
            by_tier.setdefault(f["properties"].get("risk_tier", "?"), []).append(f)

        picked: list[dict] = []
        for tier in ("Critical", "High", "Moderate", "Low"):
            pool = by_tier.get(tier, [])
            if not pool:
                continue
            k = min(args.stratify, len(pool))
            picked.extend(rng.sample(pool, k))
        rng.shuffle(picked)
        return picked

    if args.node_ids:
        wanted = {int(x) for x in args.node_ids.split(",")}
        feats = [f for f in feats if f["properties"]["node_id"] in wanted]
    elif args.top50:
        feats = [f for f in feats if f["properties"].get("top50")]
    elif args.risk_tier:
        tiers = set(args.risk_tier.split(","))
        feats = [f for f in feats if f["properties"].get("risk_tier") in tiers]

    feats.sort(key=lambda f: f["properties"].get("eb_ksi", 0), reverse=True)

    if args.limit:
        feats = feats[: args.limit]
    return feats


def main(argv: Iterable[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--geojson", type=Path, default=DEFAULT_GEOJSON)
    ap.add_argument("--outdir", type=Path, default=DEFAULT_OUTDIR)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--headings", default=",".join(str(h) for h in DEFAULT_HEADINGS))
    ap.add_argument("--size", default=DEFAULT_SIZE)
    ap.add_argument("--fov", type=int, default=DEFAULT_FOV)
    ap.add_argument("--limit", type=int, help="Max intersections to process")
    ap.add_argument("--top50", action="store_true", help="Only the top-50 flagged sites")
    ap.add_argument("--risk-tier", help="Comma-separated tiers, e.g. Critical,High")
    ap.add_argument("--node-ids", help="Comma-separated node_id values")
    ap.add_argument(
        "--stratify",
        type=int,
        metavar="N",
        help="Random sample of N intersections from EACH risk tier. Use this "
        "for validation: the top-50 set has almost no variance in eb_ksi, "
        "which attenuates any correlation toward zero.",
    )
    ap.add_argument("--seed", type=int, default=20260730, help="Sampling seed (default 20260730)")
    ap.add_argument(
        "--workers",
        type=int,
        default=8,
        help="Intersections scored in parallel (default 8). Lower if you hit 429s.",
    )
    ap.add_argument(
        "--thinking",
        choices=["off", "minimal", "low", "high"],
        default="low",
        help="Model reasoning depth. Lower is much faster; 'high' matches the "
        "original SafeStreets behaviour (default: low)",
    )
    ap.add_argument("--mock", action="store_true", help="No API calls; fabricate results")
    ap.add_argument("--cache-images", action="store_true", help="Persist JPEGs (see terms note)")
    ap.add_argument("--overwrite", action="store_true", help="Rescore nodes that already have results")
    ap.add_argument("--yes", action="store_true", help="Skip the cost confirmation prompt")
    ap.add_argument(
        "--price-in",
        type=float,
        help="USD per million input tokens, for the cost report (see ai.google.dev/pricing)",
    )
    ap.add_argument(
        "--price-out",
        type=float,
        help="USD per million output tokens (thinking tokens bill as output)",
    )
    args = ap.parse_args(list(argv) if argv is not None else None)

    headings = [int(h) for h in args.headings.split(",")]

    if not args.geojson.exists():
        log(f"ERROR: {args.geojson} not found")
        return 1

    log(f"Loading {args.geojson}")
    geojson = json.loads(args.geojson.read_text())
    nodes = select_nodes(geojson, args)

    if not nodes:
        log("No intersections matched the selection criteria.")
        return 1

    args.outdir.mkdir(parents=True, exist_ok=True)
    img_dir = args.outdir / "images"
    if args.cache_images:
        img_dir.mkdir(exist_ok=True)

    existing = {p.stem for p in args.outdir.glob("*.json")} if not args.overwrite else set()
    todo = [n for n in nodes if str(n["properties"]["node_id"]) not in existing]

    n_calls = len(todo) * len(headings)
    est = n_calls * (COST_PER_SV_IMAGE + COST_PER_GEMINI_CALL)

    log(f"Selected {len(nodes)} intersections; {len(existing)} already scored; {len(todo)} to do")
    log(f"{len(headings)} headings each -> ~{n_calls} images and {n_calls} Gemini calls")
    log(f"Rough cost estimate: ${est:.2f}" + (" (MOCK - nothing will be spent)" if args.mock else ""))

    if not todo:
        log("Nothing to do.")
        return 0

    if not args.mock and not args.yes:
        try:
            if input("Proceed? [y/N] ").strip().lower() not in ("y", "yes"):
                log("Aborted.")
                return 0
        except EOFError:
            log("No TTY for confirmation; pass --yes to run non-interactively.")
            return 1

    if not args.mock:
        loaded = load_dotenv(HERE / ".env")
        if loaded:
            log(f"Loaded from scoring/.env: {', '.join(loaded)}")

    maps_key = os.getenv("GOOGLE_MAPS_API_KEY") or os.getenv("VITE_GOOGLE_MAPS_API_KEY") or ""
    gem_key = os.getenv("GEMINI_API_KEY") or ""

    if not args.mock:
        for name, val in (("GOOGLE_MAPS_API_KEY", maps_key), ("GEMINI_API_KEY", gem_key)):
            if not val:
                log(f"ERROR: {name} is not set.")
                log(f"  Either export it:   export {name}='your-key-here'")
                log(f"  or add it to:       {HERE / '.env'}")
                return 1
            if looks_like_placeholder(val):
                log(f"ERROR: {name} is a placeholder, not a real key (got {val!r}).")
                log("  This usually means an earlier 'export KEY=...' is still set")
                log("  in this shell. Fix it in the SAME terminal with:")
                log(f"    export {name}='your-real-key'")
                log(f"  or put it in {HERE / '.env'} and unset the shell value:")
                log(f"    unset {name}")
                return 1

    scorer = Scorer(gem_key, args.model, mock=args.mock, thinking=args.thinking)
    stats = Stats()
    run_ts = datetime.now(timezone.utc).isoformat()

    lock = threading.Lock()
    abort = threading.Event()

    def process(feat: dict) -> dict | None:
        """Score one intersection. Runs on a worker thread."""
        if abort.is_set():
            return None

        p = feat["properties"]
        node_id = p["node_id"]
        lng, lat = feat["geometry"]["coordinates"]
        label = p.get("int_name", "?")

        if args.mock:
            meta = {
                "status": "OK",
                "pano_id": f"MOCK_{node_id}",
                "date": "2025-06",
                "location": {"lat": lat, "lng": lng},
            }
        else:
            meta = streetview_metadata(lat, lng, maps_key)

        if meta.get("status") != "OK":
            with lock:
                stats.nodes_no_imagery += 1
            record = {
                "node_id": node_id,
                "int_name": label,
                "status": meta.get("status", "UNKNOWN"),
                "run_ts": run_ts,
            }
            (args.outdir / f"{node_id}.json").write_text(json.dumps(record, indent=2))
            return record

        pano_id = meta["pano_id"]
        per_heading: list[dict] = []

        for h in headings:
            if abort.is_set():
                break
            entry: dict[str, Any] = {"heading": h}
            try:
                if args.mock:
                    img = b"MOCK"
                else:
                    img = streetview_image(pano_id, h, maps_key, size=args.size, fov=args.fov)
                    with lock:
                        stats.images_fetched += 1
                    if args.cache_images:
                        (img_dir / f"{node_id}_{h}.jpg").write_bytes(img)

                res = scorer.score_image(img)
                entry["result"] = res
                usage = res.pop("_usage", None)
                with lock:
                    stats.gemini_calls += 1
                    if usage:
                        entry["usage"] = usage
                        stats.prompt_tokens += usage.get("prompt_tokens") or 0
                        stats.output_tokens += usage.get("output_tokens") or 0
                        stats.thinking_tokens += usage.get("thinking_tokens") or 0
            except FatalConfigError:
                raise
            except Exception as exc:  # noqa: BLE001
                entry["error"] = str(exc)[:300]
                with lock:
                    stats.errors.append(f"node {node_id} heading {h}: {exc}")
            per_heading.append(entry)

        record = {
            "node_id": node_id,
            "int_name": label,
            "status": "OK",
            "run_ts": run_ts,
            "model": args.model,
            "prompt_version": PROMPT_VERSION_BLIND,
            "mode": "blind",
            "mock": bool(args.mock),
            "thinking": args.thinking,
            "imagery": {
                "pano_id": pano_id,
                "capture_date": meta.get("date"),
                "lat": meta.get("location", {}).get("lat"),
                "lng": meta.get("location", {}).get("lng"),
                "requested_lat": lat,
                "requested_lng": lng,
                "headings": headings,
                "fov": args.fov,
                "size": args.size,
            },
            "per_heading": per_heading,
            "aggregate": aggregate(per_heading),
        }
        (args.outdir / f"{node_id}.json").write_text(json.dumps(record, indent=2))
        with lock:
            stats.nodes_scored += 1
        return record

    workers = max(1, args.workers)
    log(f"Scoring with {workers} worker{'s' if workers != 1 else ''}, thinking={args.thinking}")
    started = time.time()

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(process, f): f for f in todo}
        done_n = 0
        try:
            for fut in as_completed(futures):
                feat = futures[fut]
                node_id = feat["properties"]["node_id"]
                label = feat["properties"].get("int_name", "?")
                done_n += 1
                with lock:
                    stats.nodes_attempted += 1

                try:
                    record = fut.result()
                except FatalConfigError as exc:
                    abort.set()
                    log("")
                    log("ABORTING - configuration problem, not a transient failure:")
                    for line in str(exc).splitlines():
                        log(f"  {line}")
                    for f2 in futures:
                        f2.cancel()
                    log("")
                    log("Nothing was charged: this failed on the free metadata call.")
                    return 1
                except Exception as exc:  # noqa: BLE001
                    with lock:
                        stats.errors.append(f"node {node_id}: {exc}")
                    log(f"[{done_n}/{len(todo)}] {label[:40]} FAILED: {str(exc)[:100]}")
                    continue

                if record is None:
                    continue

                elapsed = time.time() - started
                rate = done_n / elapsed if elapsed > 0 else 0
                eta = (len(todo) - done_n) / rate if rate > 0 else 0

                if record.get("status") != "OK":
                    log(f"[{done_n}/{len(todo)}] {label[:40]} - no imagery ({record['status']})")
                else:
                    agg = record.get("aggregate") or {}
                    log(
                        f"[{done_n}/{len(todo)}] {label[:40]:<40} "
                        f"score {agg.get('safety_score_mean')} "
                        f"(sd {agg.get('safety_score_sd')})  "
                        f"eta {eta / 60:.1f}m"
                    )
        except KeyboardInterrupt:
            abort.set()
            log("")
            log("Interrupted. Finished work is saved; rerun to resume.")
            for f2 in futures:
                f2.cancel()

    log("")
    log(f"elapsed          {(time.time() - started) / 60:.1f} min")
    log("=" * 60)
    log(f"attempted        {stats.nodes_attempted}")
    log(f"scored           {stats.nodes_scored}")
    log(f"no imagery       {stats.nodes_no_imagery}")
    log(f"images fetched   {stats.images_fetched}")
    log(f"gemini calls     {stats.gemini_calls}")
    log(f"errors           {len(stats.errors)}")

    # Token accounting, measured from the API responses rather than waiting
    # on Cloud billing (which can lag more than a day).
    if stats.gemini_calls and (stats.prompt_tokens or stats.output_tokens):
        n = stats.gemini_calls
        billed_out = stats.output_tokens + stats.thinking_tokens
        log("")
        log("token usage (measured, not estimated)")
        log(f"  input tokens         {stats.prompt_tokens:,}")
        log(f"  output tokens        {stats.output_tokens:,}")
        if stats.thinking_tokens:
            log(f"  thinking tokens      {stats.thinking_tokens:,}  (billed as output)")
        log(f"  per call: {stats.prompt_tokens / n:,.0f} in / {billed_out / n:,.0f} out")

        if args.price_in and args.price_out:
            cost_gem = (
                stats.prompt_tokens / 1e6 * args.price_in
                + billed_out / 1e6 * args.price_out
            )
            cost_sv = stats.images_fetched * COST_PER_SV_IMAGE
            total = cost_gem + cost_sv
            per_node = total / max(1, stats.nodes_scored)
            log("")
            log(f"  gemini cost          ${cost_gem:.4f}")
            log(f"  street view cost     ${cost_sv:.4f}  (est. at ${COST_PER_SV_IMAGE}/image)")
            log(f"  TOTAL                ${total:.4f}   (${per_node:.4f} per intersection)")
            log("")
            log("  projected at this configuration:")
            for label, count in (
                ("Critical tier (225)", 225),
                ("Critical + High (903)", 903),
                ("full city (16,984)", 16984),
            ):
                log(f"    {label:<24} ${per_node * count:,.2f}")
        else:
            log("")
            log("  Pass --price-in and --price-out (USD per million tokens, from")
            log("  ai.google.dev/pricing) to convert this into dollars.")
    log(f"results in       {args.outdir}")
    if stats.errors:
        log("first few errors:")
        for e in stats.errors[:5]:
            log(f"  {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
