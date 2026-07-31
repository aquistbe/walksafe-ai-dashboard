"""
Shared configuration for the WalkSafe-AI Philadelphia pipeline.

Every path, CRS and magic constant is resolved here so the scripts run from a
clean clone on any machine. They previously hardcoded 23 absolute paths under
`/sessions/wonderful-awesome-fermi/mnt/...`, a sandbox mount that no longer
exists — the pipeline was unrunnable as shipped.

Layout
------
    <repo>/pipeline/          this file and the numbered scripts
    <repo>/pipeline/data/     small committed inputs that cannot be re-fetched
    <repo>/pipeline/work/     intermediates (gitignored)
    <repo>/pipeline/outputs/  deliverables + qc_logs (gitignored)

Raw source data lives OUTSIDE the repo and is never committed: PennDOT crash
extracts, Philadelphia GIS layers, CDC PLACES and FARS. Point at it with
WALKSAFE_DATA_ROOT; see pipeline/README.md for provenance.

    export WALKSAFE_DATA_ROOT="$HOME/Library/CloudStorage/OneDrive-DrexelUniversity/Grants/WALKSAFE-AI Grant/Data"

Individual roots can be overridden separately if a layout differs:
WALKSAFE_PENNDOT_DIR, WALKSAFE_GIS_DIR, WALKSAFE_PLACES_DIR, WALKSAFE_FARS_DIR,
WALKSAFE_WORK_DIR, WALKSAFE_OUTPUT_DIR.
"""

import os
from pathlib import Path

# ---------------------------------------------------------------------------
# Roots
# ---------------------------------------------------------------------------

PIPELINE = Path(__file__).resolve().parent
REPO = PIPELINE.parent


def _env(name: str, default: Path) -> Path:
    v = os.getenv(name)
    return Path(v).expanduser() if v else default


# External raw data. Default assumes a sibling `Data/` next to the repo; in
# practice this is set via WALKSAFE_DATA_ROOT.
DATA_ROOT = _env("WALKSAFE_DATA_ROOT", REPO.parent / "Data")

PENNDOT = _env("WALKSAFE_PENNDOT_DIR", DATA_ROOT / "PennDOT")
GIS = _env("WALKSAFE_GIS_DIR", DATA_ROOT / "Philadelphia GIS")
PLACES = _env("WALKSAFE_PLACES_DIR", DATA_ROOT / "CDC Places")
FARS = _env("WALKSAFE_FARS_DIR", DATA_ROOT / "FARS")

# Committed inputs that cannot be regenerated (see README).
INPUTS = PIPELINE / "data"

# Intermediates and deliverables, both inside the repo and both gitignored.
WORK = _env("WALKSAFE_WORK_DIR", PIPELINE / "work")
OUTPUTS = _env("WALKSAFE_OUTPUT_DIR", PIPELINE / "outputs")
QC_LOGS = OUTPUTS / "qc_logs"

for _d in (WORK, OUTPUTS, QC_LOGS):
    _d.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Analysis constants
#
# These were duplicated across files — CRS in 4, M2FT in 5, the snap buffer in
# 6 places, the bounding box and year range in 2 each. A single definition
# means a change cannot apply to only half the pipeline.
# ---------------------------------------------------------------------------

#: PA State Plane South, US survey feet. All spatial work happens here.
CRS = 2272

#: Buffers are stated in metres but applied in feet, because CRS is in feet.
M2FT = 3.280839895

#: Crash years analysed.
YEARS = range(2015, 2025)
N_YEARS = len(list(YEARS))

#: Philadelphia County FIPS as coded in the PennDOT extracts.
COUNTY_CODE = 67

#: Generous bounding box used to discard impossible coordinates.
#: (lat_min, lat_max, lon_min, lon_max)
PHILLY_BBOX = (39.85, 40.15, -75.30, -74.94)

#: Distance within which a crash is considered to belong to an intersection.
SNAP_BUFFER_M = 25

#: Sensitivity buffers reported alongside the primary.
SNAP_BUFFERS_M = (15, 25, 30)

#: AADT assumed where no traffic segment is near enough to join.
LOCAL_AADT = 2000

#: PennDOT's nominal AADT placeholder for local roads. 53.4% of Philadelphia
#: traffic segments carry exactly this value — it is not a measured count, and
#: any segment-level exposure term must treat it as such.
NOMINAL_AADT = 300

#: Street_Centerline CLASS codes forming the walkable network. Excludes
#: expressways (1) and ramps (9, 10) where pedestrians have no legal access,
#: city-boundary lines (14), driveways (6), private/park roads (12, 13) and
#: walkways (15, 18).
WALKABLE_CLASSES = (2, 3, 4, 5)

CLASS_LABELS = {
    1: "Expressway",
    2: "Arterial",
    3: "Collector",
    4: "Local",
    5: "Minor local",
    6: "Driveway",
    9: "Ramp",
    10: "Ramp",
    12: "Private / park",
    13: "Private",
    14: "City boundary",
    15: "Walkway",
    18: "Other",
}

# ---------------------------------------------------------------------------
# QC logging
#
# The original scripts each re-declared `log = []` plus a local `L()`, and wrote
# to two different destinations (01-05 to the scratch dir, 07 and 10 to the
# deliverables dir) while 06, 08, 09 and 11 wrote no log at all. One helper,
# one destination.
# ---------------------------------------------------------------------------


class QCLog:
    """Accumulates human-readable QC lines and writes them on close()."""

    def __init__(self, name: str):
        self.name = name if name.endswith(".txt") else f"qc_{name}.txt"
        self.lines: list[str] = []

    def __call__(self, msg) -> None:
        print(msg)
        self.lines.append(str(msg))

    def close(self) -> Path:
        path = QC_LOGS / self.name
        path.write_text("\n".join(self.lines))
        print(f"\n[qc] {path}")
        return path

    # Usable as a context manager so the log is written even on an early return.
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


def require(path: Path, what: str) -> Path:
    """Fail early and legibly when external data is missing."""
    if not path.exists():
        raise SystemExit(
            f"\nMissing {what}:\n  {path}\n\n"
            "Raw source data is not committed. Set WALKSAFE_DATA_ROOT to the "
            "folder documented in pipeline/README.md, e.g.\n"
            '  export WALKSAFE_DATA_ROOT="$HOME/Library/CloudStorage/'
            'OneDrive-DrexelUniversity/Grants/WALKSAFE-AI Grant/Data"\n'
        )
    return path
