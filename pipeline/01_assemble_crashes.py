"""
01_assemble_crashes.py
WALKSAFE-AI intersection ranking - Step 1
Stack PennDOT CRASH files 2015-2024 (Philadelphia), flag pedestrian KSI,
reconcile crash-level flags against the PERSON table, and QC coordinates.

Outputs (to OUT dir):
  crashes_all.parquet      - all crashes, one row per CRN, with flags
  ped_crashes.parquet      - ped-involved crashes only
  qc_assembly.txt          - row counts, filters, reconciliation log

Codes confirmed from PennDOT Crash Data Dictionary 05.2023:
  INJ_SEVERITY: 0=Not injured, 1=Killed, 2=Suspected Serious, 3=Suspected Minor,
                4=Possible, 8=Injury unknown severity, 9=Unknown if injured
  PERSON_TYPE:  1=Driver, 2=Passenger, 7=Pedestrian, 8=Other, 9=Unknown
  MAX_SEVERITY_LEVEL: 0=PDO, 1=Fatal, 2=Susp Serious, 3=Susp Minor, 4=Possible
  INTERSECTION_RELATED: 1=Y, 0=N
  INTERSECT_TYPE: 00=Mid-block, 01-13 = intersection types
"""
import pandas as pd
import numpy as np
from pathlib import Path
from config import PENNDOT, WORK, QC_LOGS  # repo-relative paths; see pipeline/README.md

DATA = PENNDOT
OUT = WORK
YEARS = range(2015, 2025)

# Philadelphia bounding box (WGS84), generous
LAT_MIN, LAT_MAX = 39.85, 40.15
LON_MIN, LON_MAX = -75.30, -74.94

log = []
def L(msg):
    print(msg)
    log.append(str(msg))

crash_cols = ["CRN","CRASH_YEAR","COUNTY","MUNICIPALITY","DEC_LATITUDE","DEC_LONGITUDE",
              "INTERSECTION_RELATED","INTERSECT_TYPE","LOCATION_TYPE","RELATION_TO_ROAD",
              "TCD_TYPE","TCD_FUNC_CD","MAX_SEVERITY_LEVEL","FATAL_COUNT","INJURY_COUNT",
              "PED_COUNT","PED_DEATH_COUNT","PED_SUSP_SERIOUS_INJ_COUNT","NONMOTR_COUNT",
              "ILLUMINATION","HOUR_OF_DAY","URBAN_RURAL"]

frames = []
for y in YEARS:
    f = DATA / f"Philadelphia_{y}" / f"CRASH_PHILADELPHIA_{y}.csv"
    df = pd.read_csv(f, dtype={"CRN": str}, low_memory=False)
    keep = [c for c in crash_cols if c in df.columns]
    missing = set(crash_cols) - set(keep)
    if missing:
        L(f"{y}: missing columns {missing}")
    frames.append(df[keep].assign(src_year=y))
    L(f"{y}: {len(df)} crash rows")

crash = pd.concat(frames, ignore_index=True)
L(f"Stacked total: {len(crash)}")

# County check
L(f"COUNTY values: {crash['COUNTY'].value_counts(dropna=False).to_dict()}")
n_not67 = (crash["COUNTY"] != 67).sum()
if n_not67:
    L(f"DROP {n_not67} rows with COUNTY != 67")
    crash = crash[crash["COUNTY"] == 67]

# Dedup on CRN
ndup = crash.duplicated("CRN").sum()
L(f"Duplicate CRNs: {ndup}")
if ndup:
    crash = crash.drop_duplicates("CRN", keep="first")

# CRASH_YEAR consistency
L(f"CRASH_YEAR vs folder year mismatches: {(crash['CRASH_YEAR'] != crash['src_year']).sum()}")
L("Crashes per CRASH_YEAR:\n" + crash["CRASH_YEAR"].value_counts().sort_index().to_string())

# --- Pedestrian flags (crash level) ---
for c in ["PED_COUNT","PED_DEATH_COUNT","PED_SUSP_SERIOUS_INJ_COUNT","FATAL_COUNT"]:
    crash[c] = pd.to_numeric(crash[c], errors="coerce").fillna(0).astype(int)
crash["ped_ksi_n"] = crash["PED_DEATH_COUNT"] + crash["PED_SUSP_SERIOUS_INJ_COUNT"]
crash["ped_ksi"] = crash["ped_ksi_n"] > 0
crash["ped_any"] = crash["PED_COUNT"] > 0

L(f"\nPed-involved crashes (PED_COUNT>0): {crash['ped_any'].sum()}")
L(f"Ped KSI crashes (crash-level flags): {crash['ped_ksi'].sum()}")
L(f"  ped deaths total: {crash['PED_DEATH_COUNT'].sum()}, ped susp serious total: {crash['PED_SUSP_SERIOUS_INJ_COUNT'].sum()}")
L("Ped KSI crashes by year:\n" + crash.loc[crash.ped_ksi, "CRASH_YEAR"].value_counts().sort_index().to_string())
L("Ped fatal (PED_DEATH_COUNT>0) crashes by year:\n" +
  crash.loc[crash.PED_DEATH_COUNT > 0, "CRASH_YEAR"].value_counts().sort_index().to_string())

# --- PERSON-table reconciliation ---
pframes = []
for y in YEARS:
    f = DATA / f"Philadelphia_{y}" / f"PERSON_PHILADELPHIA_{y}.csv"
    p = pd.read_csv(f, dtype={"CRN": str}, low_memory=False)
    pframes.append(p[["CRN","PERSON_TYPE","INJ_SEVERITY"]])
person = pd.concat(pframes, ignore_index=True)
person["PERSON_TYPE"] = pd.to_numeric(person["PERSON_TYPE"], errors="coerce")
person["INJ_SEVERITY"] = pd.to_numeric(person["INJ_SEVERITY"], errors="coerce")

ped_person = person[person["PERSON_TYPE"] == 7]
L(f"\nPERSON rows total: {len(person)}; pedestrian persons (type 7): {len(ped_person)}")
L("Pedestrian INJ_SEVERITY distribution:\n" +
  ped_person["INJ_SEVERITY"].value_counts(dropna=False).sort_index().to_string())

ped_ksi_person_crns = set(ped_person.loc[ped_person["INJ_SEVERITY"].isin([1, 2]), "CRN"])
crash["ped_ksi_person"] = crash["CRN"].isin(ped_ksi_person_crns)
L(f"Ped KSI from PERSON table: {crash['ped_ksi_person'].sum()} crashes")

both = (crash.ped_ksi & crash.ped_ksi_person).sum()
only_crash = (crash.ped_ksi & ~crash.ped_ksi_person).sum()
only_person = (~crash.ped_ksi & crash.ped_ksi_person).sum()
L(f"Reconciliation: both={both}, crash-flags-only={only_crash}, person-only={only_person}")
L(f"Agreement: {both / max(1, (both + only_crash + only_person)):.3f}")

# Final KSI definition: union of the two derivations (documented in memo)
crash["ped_ksi_final"] = crash["ped_ksi"] | crash["ped_ksi_person"]
L(f"Final ped KSI (union): {crash['ped_ksi_final'].sum()} crashes")

# --- Coordinates QC ---
crash["lat"] = pd.to_numeric(crash["DEC_LATITUDE"], errors="coerce")
crash["lon"] = pd.to_numeric(crash["DEC_LONGITUDE"], errors="coerce")
crash["coord_missing"] = crash["lat"].isna() | crash["lon"].isna()
crash["coord_out"] = ~crash["coord_missing"] & (
    (crash["lat"] < LAT_MIN) | (crash["lat"] > LAT_MAX) |
    (crash["lon"] < LON_MIN) | (crash["lon"] > LON_MAX))
crash["coord_ok"] = ~crash["coord_missing"] & ~crash["coord_out"]
L(f"\nCoordinates: missing={crash['coord_missing'].sum()}, "
  f"outside bbox={crash['coord_out'].sum()}, usable={crash['coord_ok'].sum()}")
L("Missing/bad coords among ped KSI crashes: "
  f"{((~crash['coord_ok']) & crash['ped_ksi_final']).sum()} of {crash['ped_ksi_final'].sum()}")
L("Missing/bad coords among ped-any crashes: "
  f"{((~crash['coord_ok']) & crash['ped_any']).sum()} of {crash['ped_any'].sum()}")

crash.to_parquet(OUT / "crashes_all.parquet", index=False)
ped = crash[crash["ped_any"] | crash["ped_ksi_final"]].copy()
ped.to_parquet(OUT / "ped_crashes.parquet", index=False)
L(f"\nSaved {len(crash)} crashes, {len(ped)} ped-involved crashes.")

(QC_LOGS / "qc_assembly.txt").write_text("\n".join(log))
