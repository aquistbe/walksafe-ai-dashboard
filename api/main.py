"""WalkSafe-AI API — serves intersection risk data for the dashboard."""

import os
import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

DATA_DIR = Path(os.getenv("DATA_DIR", "../data"))
SCORING_RESULTS = Path(os.getenv("SCORING_RESULTS_DIR", "../scoring/results"))

# ---------------------------------------------------------------------------
# Cache loaded data in memory at startup
# ---------------------------------------------------------------------------
_geojson: Optional[dict] = None
_summary: Optional[dict] = None
_features_by_node: dict[int, dict] = {}


def _load_data() -> None:
    """Load GeoJSON and summary into memory."""
    global _geojson, _summary, _features_by_node

    geojson_path = DATA_DIR / "intersections.geojson"
    summary_path = DATA_DIR / "summary.json"

    if not geojson_path.exists():
        raise RuntimeError(f"GeoJSON not found at {geojson_path}")

    with open(geojson_path, "r") as f:
        _geojson = json.load(f)

    if summary_path.exists():
        with open(summary_path, "r") as f:
            _summary = json.load(f)
    else:
        _summary = {}

    # Index features by node_id for fast lookup
    for feature in _geojson.get("features", []):
        node_id = feature.get("properties", {}).get("node_id")
        if node_id is not None:
            _features_by_node[int(node_id)] = feature


@asynccontextmanager
async def lifespan(app: FastAPI):
    _load_data()
    yield


app = FastAPI(
    title="WalkSafe-AI API",
    description="Pedestrian safety intersection data for Philadelphia",
    version="0.1.0",
    default_response_class=JSONResponse,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://*.fly.dev",
        "https://*.railway.app",
    ],
    allow_credentials=True,
    allow_methods=["GET"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "ok",
        "intersections_loaded": len(_features_by_node),
    }


@app.get("/api/summary")
async def get_summary():
    """Return the summary statistics JSON."""
    if _summary is None:
        raise HTTPException(status_code=503, detail="Data not loaded")
    return _summary


@app.get("/api/intersections")
async def get_intersections(
    risk_tier: Optional[str] = None,
    on_hin: Optional[bool] = None,
    top50: Optional[bool] = None,
    limit: Optional[int] = None,
):
    """Return the full GeoJSON FeatureCollection, with optional filters.

    Query params:
      - risk_tier: "Critical", "High", "Moderate", or "Low"
      - on_hin: true/false — filter to High Injury Network
      - top50: true/false — filter to top 50 intersections
      - limit: max number of features to return
    """
    if _geojson is None:
        raise HTTPException(status_code=503, detail="Data not loaded")

    features = _geojson.get("features", [])

    if risk_tier:
        features = [
            f for f in features
            if f["properties"].get("risk_tier") == risk_tier
        ]
    if on_hin is not None:
        features = [
            f for f in features
            if f["properties"].get("on_hin") == on_hin
        ]
    if top50 is not None:
        features = [
            f for f in features
            if f["properties"].get("top50") == top50
        ]
    if limit is not None:
        features = features[:limit]

    return {
        "type": "FeatureCollection",
        "metadata": _geojson.get("metadata", {}),
        "features": features,
    }


@app.get("/api/intersections/{node_id}")
async def get_intersection(node_id: int):
    """Return a single intersection feature by node_id."""
    feature = _features_by_node.get(node_id)
    if feature is None:
        raise HTTPException(
            status_code=404,
            detail=f"Intersection with node_id={node_id} not found",
        )
    return feature


@app.get("/api/intersections/{node_id}/imagery")
async def get_intersection_imagery(node_id: int):
    """Full imagery scoring record, including per-heading detail.

    Served from scoring/results/ rather than the GeoJSON: the per-heading
    hazards and interventions are far too large to ship inside a 17k-feature
    collection, but are useful when a single intersection is opened.
    """
    path = SCORING_RESULTS / f"{node_id}.json"
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No imagery scoring record for node_id={node_id}",
        )
    with open(path, "r") as f:
        return json.load(f)
