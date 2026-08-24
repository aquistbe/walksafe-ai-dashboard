"""Expected pedestrian injuries and deaths per ZAT from the published offset model.

`zat_profile_models_with_age60.csv` holds the fitted rate ratios of the
replication model (negative binomial, offset = log walking + public-transport
trips): intercept, cluster profile (reference 4), MEANIPM, population
density, and the three road-composition shares. Every covariate is in the
ZAT properties, so the linear predictor can be rebuilt exactly:

    expected = exp(b0 + sum(b_k * x_k)) * walk_pubt

Check (24 Aug 2026): over the 770 zones with every covariate, the rebuilt
expectations sum to the observed totals to the unit (injuries 15,400,
deaths 1,197), which is what a fitted count model with an intercept
guarantees — so these ARE the model's fitted values, not an approximation.

Shared by build_bogota_geojson.py and rederive_bogota_rates.py so a
rebuilt file and a re-derived file carry identical numbers.
"""
import csv
import math
from pathlib import Path

MODEL = "replication"
COVARS = ("MEANIPM", "pop_density", "pcta_Collector", "pcta_Local", "pcta_other")
REFERENCE_CLUSTER = 4


def load_coefficients(models_csv: Path) -> dict:
    """{outcome: {term: log RR}} for the replication model."""
    out: dict = {}
    with open(models_csv) as fh:
        for r in csv.DictReader(fh):
            if r["model"] != MODEL:
                continue
            out.setdefault(r["outcome"], {})[r["term"]] = math.log(float(r["RR"]))
    for outcome in ("injury", "death"):
        if outcome not in out or "(Intercept)" not in out[outcome]:
            raise SystemExit(f"{models_csv}: no {MODEL} {outcome} intercept")
    return out


def expected_count(props: dict, coef: dict, outcome: str):
    """Fitted mean for one zone, or None when any model input is missing.
    Never substitutes 0 for a missing covariate: a zone the model could not
    fit must read as no expectation, not as a low one."""
    b = coef[outcome]
    clus = props.get("clus")
    trips = props.get("walk_pubt")
    if clus is None or trips is None or trips <= 0:
        return None
    lp = b["(Intercept)"]
    if clus != REFERENCE_CLUSTER:
        term = f"clus{clus}"
        if term not in b:
            return None
        lp += b[term]
    for k in COVARS:
        x = props.get(k)
        if x is None:
            return None
        lp += b[k] * float(x)
    return math.exp(lp) * float(trips)


def add_expected(props: dict, coef: dict) -> None:
    """Write expected_injury / expected_death / expected_casualties /
    excess_casualties / has_expected onto a zone's properties, in place."""
    ei = expected_count(props, coef, "injury")
    ed = expected_count(props, coef, "death")
    ok = ei is not None and ed is not None and props.get("casualties") is not None
    props["has_expected"] = bool(ok)
    props["expected_injury"] = round(ei, 2) if ei is not None else None
    props["expected_death"] = round(ed, 3) if ed is not None else None
    if ok:
        props["expected_casualties"] = round(ei + ed, 2)
        props["excess_casualties"] = round(props["casualties"] - (ei + ed), 2)
    else:
        props["expected_casualties"] = None
        props["excess_casualties"] = None


EXPECTED_META = {
    "model": "replication (negative binomial, offset log walk_pubt): intercept, cluster profile (ref 4), MEANIPM, pop_density, pcta_Collector, pcta_Local, pcta_other",
    "fields": ["expected_injury", "expected_death", "expected_casualties", "excess_casualties", "has_expected"],
    "definition": "excess_casualties = observed casualties minus the model's fitted expectation for a zone with this profile, covariates and walking + transit trips",
    "check": "rebuilt expectations sum to observed totals over the 770 fitted zones (injuries 15,400; deaths 1,197)",
}
