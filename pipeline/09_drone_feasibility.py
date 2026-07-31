"""
09_drone_feasibility.py
WALKSAFE-AI intersection ranking - Step 9 (addendum 2)
Drone/aerial data-collection feasibility for the 15 narrowed sites.

Airspace: queried FAA UAS Facility Map (LAANC grid) service per site,
2026-07-06 (services6.arcgis.com .../FAA_UAS_FacilityMap_Data_V5, point-in-
polygon on site coordinates). ceiling_ft = LAANC grid ceiling; None = no
facility-map cell = uncontrolled (Class G) below the PHL Class B shelf,
Part 107 default 400 ft AGL, no authorization required.

Site factors (El structure, catenary, staging, field-safety context) are
desk-review judgments encoded here for transparency; each requires field
verification. Scoring:
  airspace   0 = Class G / 2 pts; LAANC 400 / 1 pt (small admin step)
  overhead   0-2 (2 = clear; 1 = catenary/wires; 0 = elevated rail structure)
  staging    0-2 (2 = park or large parking adjacent; 1 = curbside feasible)
  safety/ops 0-2 (2 = routine; 1 = active-street complexities; 0 = encampment-
               adjacent, equipment security and staffing protocols required)
  privacy    0-1 (0 if school within 200 m or highly sensitive population;
               affects IRB/consent burden, not legality)
Max 9. Tiers: A >=7, B 5-6, C <5.
"""
import pandas as pd
from pathlib import Path
from config import OUTPUTS  # repo-relative paths; see pipeline/README.md

DELIV = OUTPUTS
# (rank_eb, name, laanc_ceiling ('' = Class G), overhead, staging, safety, privacy, notes)
A = [
 (10, "ARAMINGO AVE & CASTOR AVE", "", 2, 2, 2, 1,
  "Wide commercial arterial; big-box parking for launch/staging; clear sight lines"),
 (46, "E ANN ST & ARAMINGO AVE", "", 2, 2, 2, 0,
  "Open arterial, retail parking staging; school within 200 m (IRB/consent planning)"),
 (36, "N DELAWARE AVE & FRANKFORD AVE", "", 2, 2, 2, 1,
  "Open waterfront; Penn Treaty Park staging (PPR permit); river wind and occasional low helicopter traffic along Delaware"),
 (47, "S 52ND ST & CHESTNUT ST", "400", 2, 1, 1, 0,
  "LAANC auto-approval to 400 ft; dense commercial corridor; curbside staging; school nearby"),
 (31, "CHESTNUT ST & COBBS CREEK PKWY", "400", 2, 2, 2, 1,
  "LAANC to 400 ft; Cobbs Creek park edge for staging (PPR permit); open approaches"),
 (8, "N 5TH ST & W HUNTING PARK AVE", "", 2, 2, 2, 0,
  "Hunting Park (park) adjacent for staging; wide approaches; school within 200 m"),
 (7, "N 5TH ST & W ALLEGHENY AVE", "", 2, 1, 1, 1,
  "Rowhouse commercial; utility wires typical; curbside staging; west anchor of Allegheny corridor"),
 (33, "E ALLEGHENY AVE & G ST", "", 2, 1, 1, 1,
  "East of K&A core; conventional overhead; curbside staging"),
 (39, "E ALLEGHENY AVE & FRANKFORD AVE", "", 2, 1, 1, 0,
  "Conventional cross-section; school within 200 m; east anchor of Allegheny corridor"),
 (15, "S 54TH ST & WOODLAND AVE", "400", 1, 1, 1, 0,
  "Route 11 trolley catenary over Woodland (launch/landing clearance; thin-wire occlusion minor); school nearby"),
 (13, "W LEHIGH AVE & MASCHER ST", "", 2, 1, 0, 1,
  "Kensington cluster: equipment security/staffing protocols; conventional overhead"),
 (25, "E LEHIGH AVE & N FRONT ST", "", 2, 1, 0, 1,
  "Kensington cluster; near El turn at Front/Kensington junction - verify sight lines"),
 (17, "E ALLEGHENY AVE & N FRONT ST", "", 2, 1, 0, 1,
  "Kensington cluster west of K&A; conventional overhead"),
 (9, "E ALLEGHENY AVE & E ST", "", 1, 1, 0, 0,
  "One block from K&A epicenter: encampment-adjacent, El structure nearby, school zone camera block adjacent; fixed/pole cameras preferable"),
 (14, "KENSINGTON AVE & E LEHIGH AVE", "", 0, 1, 0, 0,
  "Market-Frankford El directly over Kensington Ave: nadir view blocked, GPS multipath, SEPTA coordination; drone unsuitable - use pole/building-mounted cameras"),
]

rows = []
for rank, name, ceil, over, stag, safe, priv, note in A:
    air = 2 if ceil == "" else 1
    score = air + over + stag + safe + priv
    tier = "A" if score >= 7 else ("B" if score >= 5 else "C")
    rows.append(dict(rank_eb_at_desk_review=rank, int_name=name,
                     laanc_ceiling_ft=(ceil or "none (Class G, 400 ft)"),
                     airspace_pts=air, overhead_pts=over, staging_pts=stag,
                     safety_pts=safe, privacy_pts=priv,
                     feasibility_score=score, tier=tier, notes=note))
df = pd.DataFrame(rows)
n = pd.read_csv(DELIV / "narrowed_shortlist_nocamera_trending_up.csv")

# Join on int_name, NOT rank_eb. This table is a desk review transcribed by
# hand on 2026-07-06 against the ranks of that day; rank_eb is a *result* and
# moves whenever the SPF is refit. Joining on it silently dropped or
# mis-attached rows via an inner merge. int_name identifies the site itself.
# rank_eb_at_desk_review is retained only so the original desk review is traceable.
before = len(df)
df = df.merge(
    n[["node_id", "int_name", "rank_eb", "ksi_1519", "ksi_2024",
       "nacto_score", "lat", "lon"]],
    on="int_name", how="left", validate="one_to_one")
# Report staleness loudly and keep the rows. The left join retains a site that
# has left the shortlist with a null rank_eb, which is visible in the CSV; the
# old inner join on rank_eb dropped it without a word.
df["still_shortlisted"] = df.node_id.notna()
stale = df.loc[~df.still_shortlisted, "int_name"].tolist()
reviewed = set(df.int_name)
unreviewed = [n for n in n.int_name if n not in reviewed]

if stale or unreviewed:
    print("\n" + "!" * 68)
    print("DESK REVIEW IS OUT OF DATE with the current ranking.")
    if stale:
        print(f"\n  {len(stale)} reviewed site(s) have left the narrowed shortlist")
        print("  (retained below with a null rank_eb, NOT silently dropped):")
        for s in stale:
            print(f"    - {s}")
    if unreviewed:
        print(f"\n  {len(unreviewed)} shortlisted site(s) have no desk review "
              "and no feasibility score:")
        for s in unreviewed:
            print(f"    - {s}")
    print("\n  Feasibility scores describe the site, not its rank, so the "
          "existing\n  rows remain valid. New sites need a field/desk review "
          "before use.")
    print("!" * 68 + "\n")

moved = int((df.rank_eb.notna() & (df.rank_eb != df.rank_eb_at_desk_review)).sum())
if moved:
    print(f"NOTE: {moved} of {before} reviewed sites changed rank since "
          "2026-07-06.")

df = df.sort_values(["feasibility_score", "rank_eb"], ascending=[False, True], na_position="last")
df.to_csv(DELIV / "drone_feasibility_narrowed_sites.csv", index=False)
print(df[["tier", "feasibility_score", "rank_eb", "int_name", "laanc_ceiling_ft"]].to_string(index=False))
