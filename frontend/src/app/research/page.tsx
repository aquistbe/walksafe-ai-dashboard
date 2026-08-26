import type { ReactNode } from "react";
import summary from "../../../../data/summary.json";

// Counts and thresholds come from the same summary.json the map footer reads,
// so the two pages cannot drift apart again (they did: 225/678/3,464/12,617
// here against 150/344/2,803/13,687 in the footer, and 932/783 against
// 728/609 — stale figures from before the mid-block reallocation).
const tiers = summary.risk_tiers as Record<string, number>;
const fmt = (n: number) => n.toLocaleString("en-US");

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      {eyebrow && (
        <div className="text-[11px] font-semibold uppercase tracking-wider text-walksafe-green mb-1.5">
          {eyebrow}
        </div>
      )}
      <h2 className="text-xl font-bold text-walksafe-text mb-4">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-white rounded-xl border border-gray-200 p-5 ${className}`}
    >
      {children}
    </div>
  );
}

function P({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm text-walksafe-text-muted leading-relaxed">
      {children}
    </p>
  );
}

function Stat({
  value,
  label,
  accent = false,
}: {
  value: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
      <div
        className={`text-xl font-bold tabular-nums ${
          accent ? "text-walksafe-red" : "text-walksafe-text"
        }`}
      >
        {value}
      </div>
      <div className="text-[11px] text-gray-500 mt-0.5 leading-tight">
        {label}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: "done" | "active" | "planned" }) {
  const cfg = {
    done: { label: "Complete", cls: "bg-walksafe-green/10 text-walksafe-green" },
    active: { label: "In progress", cls: "bg-amber-100 text-amber-700" },
    planned: { label: "Planned", cls: "bg-gray-100 text-gray-500" },
  }[status];

  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const TOC = [
  ["overview", "Project overview"],
  ["aims", "Research direction"],
  ["methods", "Phase 0 methodology"],
  ["model", "Risk model"],
  ["validation", "Validation"],
  ["equity", "Equity analysis"],
  ["pedaudit", "PedAudit benchmark"],
  ["limitations", "Limitations"],
  ["reproducibility", "Data and code"],
];

export default function ResearchPage() {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-walksafe-bg">
      <div className="max-w-6xl mx-auto px-6 py-10">
        {/* Header */}
        <header className="mb-10 max-w-3xl">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-walksafe-green mb-2">
            Methodology
          </div>
          <h1 className="text-3xl font-bold text-walksafe-text">Research</h1>
          <p className="text-walksafe-text-muted mt-3 leading-relaxed">
            How the risk estimates on this dashboard were produced, what they
            can and cannot support, and how the underlying research program
            fits together. Everything currently shown comes from a completed
            analysis of ten years of Pennsylvania crash records; the machine
            learning components described below are in development.
          </p>
        </header>

        <div className="flex gap-10">
          {/* Table of contents */}
          <nav className="hidden lg:block w-52 shrink-0">
            <div className="sticky top-20">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
                On this page
              </div>
              <ul className="space-y-1">
                {TOC.map(([id, label]) => (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      className="block text-xs text-walksafe-text-muted hover:text-walksafe-green py-1 border-l-2 border-gray-200 hover:border-walksafe-green pl-3 transition-colors"
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>

          {/* Body */}
          <div className="flex-1 min-w-0 space-y-12">
            {/* ---------------------------------------------------------- */}
            <Section id="overview" eyebrow="Context" title="Project overview">
              <P>
                WalkSafe-AI is a research program on older-adult pedestrian
                safety. Adults
                aged 65 and over are killed as pedestrians at substantially
                higher rates than younger adults, and the built-environment
                features that drive that gap — crossing distances, signal
                timing, sight lines, refuge islands — are measurable and
                modifiable.
              </P>
              <P>
                The program has two halves. A city-wide half estimates risk
                everywhere, so limited capital money can be aimed at the right
                places. A site-level half, the PedAudit benchmark, works out
                what specifically to change at a given corner and verifies the
                proposal in microsimulation before anyone pours concrete.
              </P>
              <Card className="bg-amber-50 border-amber-200">
                <div className="flex gap-3">
                  <div className="text-amber-600 shrink-0 mt-0.5">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-amber-900">
                      What the map currently shows
                    </div>
                    <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                      Risk scores on this dashboard are{" "}
                      <strong>crash-based estimates</strong>, not a composite
                      pedestrian-mobility index. They measure where severe
                      pedestrian injuries have concentrated and where the road
                      environment predicts more of them. A composite index that
                      adds walkability and accessibility from street imagery is
                      a later stage of the programme and is not built.
                    </p>
                  </div>
                </div>
              </Card>
            </Section>

            {/* ---------------------------------------------------------- */}
            <Section id="aims" eyebrow="Design" title="Research direction">
              <P>
                WalkSafe-AI is a research programme on pedestrian safety for
                older adults, led at Drexel University&apos;s Dornsife School
                of Public Health. Its premise is that the street features which
                shape whether an older person can walk safely &mdash; crossings,
                signals, sidewalks, lighting, traffic calming &mdash; can be
                measured at scale from street-level imagery with computer
                vision, checked against field audits, and linked to crash
                records with proper attention to pedestrian exposure. The
                longer-term programme extends that measurement into indices of
                safety, walkability and accessibility for older pedestrians,
                weighted with residents, advocates and city staff rather than
                by researchers alone; into tools that help a city choose among
                candidate street investments under a budget; and into public
                platforms co-designed with the communities they describe. Those
                later components depend on funding decisions that are pending,
                and this site reports only what has been built and tested: the
                Phase 0 crash-risk layers for Philadelphia and the imagery
                measurement work in Bogot&aacute; described below.
              </P>
            </Section>

            {/* ---------------------------------------------------------- */}
            <Section
              id="methods"
              eyebrow="Completed July 2026"
              title="Phase 0 methodology"
            >
              <P>
                The current risk layers rank every controlled intersection in
                Philadelphia by expected pedestrian killed-or-seriously-injured
                (KSI) crashes, and every street segment on the walkable network
                by expected mid-block KSI per mile. Together they account for
                the whole crash record rather than the intersection half of it.
                The pipeline runs as fourteen ordered Python scripts, each
                writing its own quality-control log.
              </P>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat value="102,825" label="Crashes screened, 2015–2024" />
                <Stat value="1,496" label="Pedestrian KSI crashes, citywide" accent />
                <Stat value="452" label="Pedestrian deaths, citywide" accent />
                <Stat value="16,984" label="Intersections ranked" />
              </div>
              <Card className="bg-gray-50 py-3">
                <p className="text-xs text-walksafe-text-muted leading-relaxed">
                  <strong className="text-walksafe-text">
                    Reconciling these with the map.
                  </strong>{" "}
                  Every geocoded pedestrian KSI crash is now accounted for, in
                  exactly one of the two map layers. Of 1,494 geocoded crashes
                  2015&ndash;2024:
                </p>
                <ul className="mt-2 space-y-1 text-xs text-walksafe-text-muted">
                  <li>
                    <strong className="text-walksafe-text">767</strong> are coded
                    at an intersection &mdash; 756 within 25 m of a street node
                    and ranked, 11 too far from any node to place.
                  </li>
                  <li>
                    <strong className="text-walksafe-text">727</strong> are coded
                    mid-block &mdash; 724 assigned to a street segment (657 on
                    the walkable network, 67 on expressways, ramps and private
                    roads) and 3 with no segment within 25 m.
                  </li>
                </ul>
                <p className="text-xs text-walksafe-text-muted leading-relaxed mt-2">
                  The intersection layer reports 728 KSI at 609 intersections
                  rather than the 932 it once did. 269 mid-block-coded crashes
                  that happened to fall within 25 m of a node used to be counted
                  there; they are mid-block events and now sit in the segment
                  layer instead. The two layers sum to the citywide burden and
                  must never be added together as risk.
                </p>
              </Card>

              <Card>
                <h3 className="font-semibold text-sm text-walksafe-text mb-3">
                  Pipeline
                </h3>
                <ol className="space-y-3">
                  {[
                    [
                      "Assemble crashes",
                      "Ten years of PennDOT CRASH and PERSON records for Philadelphia County. A pedestrian KSI crash is one with at least one pedestrian killed or suspected seriously injured. Crash-level counters flagged 1,496 such crashes and the person-level derivation flagged 1,455; every person-level case fell inside the crash-level set, so the union was kept.",
                    ],
                    [
                      "Assign crashes to intersections",
                      "Crash points were snapped to the nearest node within 25 metres. The city street-node layer captured 98.6 percent of intersection-coded pedestrian KSI, against 65.8 percent for the state-route layer named in the original protocol, so the city layer became primary and the deviation was documented. Of 469 unassigned crashes, 458 were coded mid-block — the misses are genuine mid-block events, not snapping failures.",
                    ],
                    [
                      "Define the analysis universe",
                      "All 16,984 intersections in the city traffic-control inventory: 3,388 signalized, 3,841 all-way stop, 9,755 conventional. Including zero-crash sites is what makes the empirical Bayes step possible. " + fmt(summary.total_ped_ksi_crashes) + " assigned KSI crashes fall at " + fmt(summary.intersections_with_ksi) + " distinct intersections (after the mid-block reallocation described above).",
                    ],
                    [
                      "Attach exposure and context",
                      "Vehicle volume from PennDOT traffic segments within 30 metres (measured for 99.8 percent of sites), population within 800 metres, schools and parks within 200 metres, control type, and proximity to the 2020 High Injury Network. Roughly a fifth of intersections sit on the HIN and they carry 71.2 percent of assigned pedestrian KSI (recomputed 26 Aug 2026 from the intersection layer after the mid-block reallocation; 68.6 percent before it).",
                    ],
                    [
                      "Estimate risk three ways",
                      "Raw counts, a rate per million entering vehicles, and an empirical Bayes estimate from a negative binomial safety performance function. The three disagree substantially, which is the point — see below.",
                    ],
                    [
                      "Verify",
                      "Cross-checked against federal fatality records, tested for sensitivity to the snapping radius, and re-run against the alternative node layer.",
                    ],
                  ].map(([title, body], i) => (
                    <li key={i} className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-500 text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <div>
                        <div className="text-sm font-medium text-walksafe-text">
                          {title}
                        </div>
                        <p className="text-xs text-walksafe-text-muted mt-1 leading-relaxed">
                          {body}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </Card>

              <Card>
                <h3 className="font-semibold text-sm text-walksafe-text mb-3">
                  Data sources
                </h3>
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-400 border-b border-gray-100">
                        <th className="font-semibold py-2 px-1">Source</th>
                        <th className="font-semibold py-2 px-1">Provider</th>
                        <th className="font-semibold py-2 px-1">Vintage</th>
                        <th className="font-semibold py-2 px-1">Role</th>
                      </tr>
                    </thead>
                    <tbody className="text-walksafe-text-muted">
                      {[
                        ["Crash records (CRASH, PERSON)", "PennDOT", "2015–2024", "Outcome"],
                        ["Street nodes", "City of Philadelphia", "Current", "Intersection snapping"],
                        ["Intersection controls", "City of Philadelphia", "Current", "Analysis universe"],
                        ["Traffic volumes (AADT)", "PennDOT / DVRPC", "2024", "Vehicle exposure"],
                        ["PLACES tract centroids", "CDC", "Current", "Population proxy"],
                        ["High Injury Network", "City of Philadelphia", "2020", "Context flag"],
                        ["Schools", "City of Philadelphia", "2016", "Trip generators"],
                        ["Parks and playgrounds", "Philadelphia Parks & Rec", "Current", "Trip generators"],
                        ["FARS", "NHTSA", "2018–2023", "Validation only"],
                        ["Decennial Census DHC", "US Census Bureau", "2020", "Equity analysis"],
                      ].map((row, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          {row.map((cell, j) => (
                            <td
                              key={j}
                              className={`py-2 px-1 ${
                                j === 0
                                  ? "font-medium text-walksafe-text"
                                  : ""
                              }`}
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </Section>

            {/* ---------------------------------------------------------- */}
            <Section id="model" eyebrow="Statistics" title="Risk model">
              <P>
                Raw crash counts are a poor ranking device at this scale. Most
                intersections have zero or one pedestrian KSI in ten years, so
                the ordering among them is mostly noise, and a site with three
                crashes may simply have been unlucky. Empirical Bayes corrects
                for this by shrinking each observed count toward what the road
                environment predicts.
              </P>

              <Card>
                <h3 className="font-semibold text-sm text-walksafe-text mb-3">
                  Safety performance function
                </h3>
                <p className="text-xs text-walksafe-text-muted mb-3">
                  A negative binomial regression fit across all 16,984
                  intersections:
                </p>
                <div className="bg-gray-50 rounded-lg px-4 py-3 font-mono text-xs text-walksafe-text overflow-x-auto">
                  log E[KSI] = f(log AADT, log population 800m, control type,
                  HIN, schools, parks)
                </div>

                <div className="mt-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
                    Coefficients
                  </div>
                  <table className="w-full text-xs">
                    <tbody className="text-walksafe-text-muted">
                      {[
                        ["Vehicle volume (AADT) elasticity", "0.39", "p < 0.001"],
                        ["Population within 800 m", "0.20", "p < 0.001"],
                        ["High Injury Network", "+1.09", "p < 0.001"],
                        ["Signalized vs all-way stop", "+0.87", "p < 0.001"],
                        ["Conventional stop", "−0.53", "p < 0.001"],
                        ["Schools / parks nearby", "null", "conditional on the rest"],
                      ].map(([label, val, note], i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="py-2">{label}</td>
                          <td className="py-2 text-right font-semibold text-walksafe-text tabular-nums pr-4">
                            {val}
                          </td>
                          <td className="py-2 text-right text-gray-400 w-40">
                            {note}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-xs text-walksafe-text-muted mt-3 leading-relaxed">
                    Overdispersion alpha = 0.97, McFadden pseudo R-squared =
                    0.22. The signalized coefficient is not evidence that
                    signals cause harm; signals sit on the crossing arterials
                    where pedestrians and traffic conflict most.
                  </p>
                </div>
              </Card>

              <Card>
                <h3 className="font-semibold text-sm text-walksafe-text mb-3">
                  Empirical Bayes combination
                </h3>
                <div className="bg-gray-50 rounded-lg px-4 py-3 font-mono text-xs text-walksafe-text overflow-x-auto">
                  EB = w · μ<sub>SPF</sub> + (1 − w) · observed &nbsp;&nbsp;
                  where &nbsp; w = k / (k + μ)
                </div>
                <p className="text-xs text-walksafe-text-muted mt-3 leading-relaxed">
                  Because the ten-year expected count at any single
                  intersection is small, the model-based weight is high — a
                  median of 0.99. In practice the estimate separates genuine
                  multi-crash sites from sites whose traffic volume, road
                  class, and network position already predicted high counts.
                  The field <code className="text-[11px] bg-gray-100 px-1 rounded">eb_ksi</code>{" "}
                  in the data downloads is this quantity, expressed as expected
                  KSI crashes per year.
                </p>
              </Card>

              <Card>
                <h3 className="font-semibold text-sm text-walksafe-text mb-3">
                  Risk tiers
                </h3>
                <div className="space-y-2">
                  {[
                    ["Critical", "#C44536", "0.50 and above", fmt(tiers.Critical)],
                    ["High", "#D4820A", "0.25 to 0.50", fmt(tiers.High)],
                    ["Moderate", "#2563EB", "0.05 to 0.25", fmt(tiers.Moderate)],
                    ["Low", "#6B7280", "below 0.05", fmt(tiers.Low)],
                  ].map(([tier, color, range, count]) => (
                    <div
                      key={tier}
                      className="flex items-center gap-3 text-xs py-1"
                    >
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="font-medium text-walksafe-text w-20">
                        {tier}
                      </span>
                      <span className="text-walksafe-text-muted flex-1">
                        Expected annual KSI {range}
                      </span>
                      <span className="tabular-nums text-gray-400">
                        {count} sites
                      </span>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="border-l-4 border-l-walksafe-orange">
                <h3 className="font-semibold text-sm text-walksafe-text mb-2">
                  Why the three measures disagree
                </h3>
                <p className="text-xs text-walksafe-text-muted leading-relaxed">
                  Ranking by crash rate per million entering vehicles shares{" "}
                  <strong>zero sites</strong> with the empirical Bayes top 50,
                  because it rewards low-volume intersections that happened to
                  record one or two crashes. Raw counts and empirical Bayes
                  overlap at 31 of 50. The dashboard ranks on empirical Bayes;
                  the rate measure is best treated as a screening view, not a
                  priority list.
                </p>
              </Card>
            </Section>

            {/* ---------------------------------------------------------- */}
            <Section id="validation" eyebrow="Quality control" title="Validation">
              <div className="grid sm:grid-cols-2 gap-4">
                <Card>
                  <h3 className="font-semibold text-sm text-walksafe-text mb-2">
                    Against federal records
                  </h3>
                  <p className="text-xs text-walksafe-text-muted leading-relaxed mb-3">
                    Pedestrian fatality counts were compared with NHTSA
                    Fatality Analysis Reporting System data year by year.
                  </p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-100">
                        <th className="text-left font-semibold py-1">Year</th>
                        <th className="text-right font-semibold py-1">FARS</th>
                        <th className="text-right font-semibold py-1">
                          PennDOT
                        </th>
                      </tr>
                    </thead>
                    <tbody className="text-walksafe-text-muted tabular-nums">
                      {[
                        ["2018", 41, 42],
                        ["2019", 29, 29],
                        ["2020", 48, 49],
                        ["2021", 43, 45],
                        ["2022", 60, 64],
                        ["2023", 56, 59],
                      ].map(([y, f, p]) => (
                        <tr key={y as string} className="border-b border-gray-50">
                          <td className="py-1.5">{y}</td>
                          <td className="py-1.5 text-right">{f}</td>
                          <td className="py-1.5 text-right">{p}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                    Gaps of one to four per year are consistent with the FARS
                    30-day death window and its trafficway rules. No material
                    discrepancy.
                  </p>
                </Card>

                <div className="space-y-4">
                  <Card>
                    <h3 className="font-semibold text-sm text-walksafe-text mb-2">
                      Snapping radius
                    </h3>
                    <p className="text-xs text-walksafe-text-muted leading-relaxed">
                      Of the top 20 sites by raw count, 17 are identical between
                      a 15-metre and 25-metre buffer, and 18 between 25 and 30
                      metres. The ranking is not an artefact of the radius.
                    </p>
                  </Card>
                  <Card>
                    <h3 className="font-semibold text-sm text-walksafe-text mb-2">
                      Face validity
                    </h3>
                    <p className="text-xs text-walksafe-text-muted leading-relaxed">
                      All 50 of the top-ranked intersections lie on the city
                      2020 High Injury Network, and all 50 are signalized
                      arterial crossings — an independent line of evidence
                      arriving at the same places.
                    </p>
                  </Card>
                </div>
              </div>
            </Section>

            {/* ---------------------------------------------------------- */}
            <Section id="equity" eyebrow="Distribution" title="Equity analysis">
              <P>
                Demographic composition was measured for each candidate site
                from 2020 Decennial Census block groups within 100 metres, with
                a 400-metre walkshed as sensitivity. The two approaches agree
                closely on minority share.
              </P>
              <Card>
                <div className="grid sm:grid-cols-2 gap-6">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
                      Philadelphia, 2020
                    </div>
                    <ul className="space-y-1.5 text-xs text-walksafe-text-muted">
                      {[
                        ["Under 18", "20.3%"],
                        ["65 and over", "14.3%"],
                        ["Hispanic", "14.9%"],
                        ["Non-Hispanic Black", "38.3%"],
                        ["Non-Hispanic white", "34.3%"],
                      ].map(([l, v]) => (
                        <li key={l} className="flex justify-between">
                          <span>{l}</span>
                          <span className="tabular-nums font-medium text-walksafe-text">
                            {v}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
                      Finding
                    </div>
                    <p className="text-xs text-walksafe-text-muted leading-relaxed">
                      Among the fifteen sites with rising pedestrian KSI and no
                      automated speed enforcement, <strong>thirteen</strong>{" "}
                      exceed the citywide share of children and teenagers, and{" "}
                      <strong>eleven</strong> are at least 90 percent minority.
                      The burden of rising, unenforced pedestrian injury falls
                      overwhelmingly on minority neighbourhoods with
                      above-average child populations.
                    </p>
                    <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
                      Block-group demographics describe residents, not
                      necessarily the people crossing at commercial
                      intersections.
                    </p>
                  </div>
                </div>
              </Card>
            </Section>

            {/* ---------------------------------------------------------- */}
            <Section
              id="pedaudit"
              eyebrow="Site-level benchmark"
              title="PedAudit"
            >
              <P>
                PedAudit turns the question around. Rather than scoring how well
                an automated system follows traffic rules, it scores how well a
                system can audit a real corner for pedestrian risk, propose
                specific design changes, and have those changes hold up in
                simulation.
              </P>
              <Card>
                <h3 className="font-semibold text-sm text-walksafe-text mb-3">
                  How it works
                </h3>
                <div className="space-y-3 text-xs text-walksafe-text-muted leading-relaxed">
                  <p>
                    Site geometry and trajectory data are converted into logical
                    facts at a single, explicit boundary between the learned and
                    the symbolic parts of the system. Everything upstream
                    produces measurements; everything downstream is
                    deterministic and auditable. Baselines are then clean
                    ablations of that one interface.
                  </p>
                  <p>
                    An answer-set solver checks the scene against two rulebooks.
                    The pedestrian-centred one flags speeds above 20 mph at
                    conflict points, unrefuged crossings longer than 24 feet,
                    and average pedestrian delay over 30 seconds. A
                    vehicle-centred rulebook encodes conventional warrants, so
                    trade-offs between the two are made explicit rather than
                    hidden. The same solver then searches for the lowest-cost
                    set of modifications — closing a slip lane, adding a refuge
                    island, extending a curb, daylighting a corner — that brings
                    the site into compliance.
                  </p>
                  <p>
                    Proposals are tested in microsimulation under two different
                    pedestrian behaviour models, and results are never averaged
                    across them. Disagreement between the models is treated as a
                    finding about the largest threat to validity, not as noise
                    to be smoothed away. Sites are split temporally, so no
                    system sees the scoring window before proposing.
                  </p>
                </div>
              </Card>
              <Card className="bg-gray-50">
                <div className="flex items-start gap-3">
                  <div className="text-gray-400 shrink-0 mt-0.5">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="16" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-walksafe-text">
                      Current status
                    </div>
                    <p className="text-xs text-walksafe-text-muted mt-1 leading-relaxed">
                      The end-to-end pipeline runs on a synthetic site with a
                      mock simulator: it checks both rulebooks, solves for a
                      compliant design, applies it, simulates, and writes a
                      report. Field data collection, the real simulation
                      backend, and the perception front end are not yet built.
                      Injury-risk coefficients and several rule thresholds are
                      placeholders pending epidemiological review. Eight
                      Philadelphia sites drawn from the ranking above are
                      registered as instrumentation candidates.
                    </p>
                  </div>
                </div>
              </Card>
            </Section>

            {/* ---------------------------------------------------------- */}
            <Section
              id="limitations"
              eyebrow="Read this"
              title="Limitations"
            >
              <P>
                These constraints are structural, not incidental, and they bound
                what the map can legitimately be used for.
              </P>
              <Card>
                <ul className="space-y-3">
                  {[
                    [
                      "There is no pedestrian volume denominator",
                      "No dataset counts how many people walk through each intersection. Vehicle traffic and nearby residential population stand in for exposure, which means places with heavy foot traffic but modest vehicle volume are probably under-ranked. This is the single largest caveat.",
                    ],
                    [
                      "Mid-block and intersection risk are measured separately and are not comparable",
                      "Roughly half of pedestrian KSI is mid-block, and it now has its own layer rather than being excluded. But the two measures have different denominators (per intersection versus per mile), disjoint crash sets, and different covariates — the segment model omits the High Injury Network. They cannot be ranked against each other or summed. A low-risk intersection still does not imply a safe street; now you can check the street.",
                    ],
                    [
                      "The segment estimate is almost entirely model, not data",
                      "Pedestrian KSI averages 0.018 per segment over ten years, so empirical Bayes shrinks each estimate onto the model prediction. Across the segments that actually carry crashes, observed data supplies about 17 percent of the estimate; at the corridor scale it reaches 56 percent. Rank corridors, and read a segment colour as what the model expects of a street of that type, not as what happened there.",
                    ],
                    [
                      "Segment traffic volume is mostly imputed",
                      "PennDOT assigns a nominal 300 vehicles per day to local roads. Only 33 percent of segments carry a genuine count — 98 percent of arterials but 9 percent of minor local streets. The model therefore estimates a volume effect only where the count is real and leans on road class elsewhere. The intersection layer hid this problem by taking the maximum volume within 30 metres, so any node near an arterial inherited a real number.",
                    ],
                    [
                      "The centerline carries no lane count, width, median or speed limit",
                      "Several of the strongest known segment-level pedestrian risk factors are simply absent from the city street file. This bounds what the segment model can claim regardless of how it is fitted.",
                    ],
                    [
                      "The High Injury Network is endogenous",
                      "The 2020 HIN was itself derived from crash data over a period overlapping this outcome window, so conditioning on it approaches conditioning on the outcome. It carries the largest coefficient in the intersection model and is deliberately excluded from the segment model — one reason the two are not comparable.",
                    ],
                    [
                      "Traffic volumes are current, applied retrospectively",
                      "2024 AADT estimates are used across all ten crash years.",
                    ],
                    [
                      "Traffic controls are current, not historical",
                      "A signal installed midway through the period is treated as though it were always there.",
                    ],
                    [
                      "Injury severity coding has drifted",
                      "Suspected-serious-injury classification has trended upward statewide over the decade, inflating later years — though it should affect intersections roughly proportionally.",
                    ],
                    [
                      "Divided arterials are split across nodes",
                      "Roosevelt Boulevard and similar roads appear as multiple nodes, dividing one functional intersection between carriageways. These sites are likely under-ranked. The segment layer is less exposed to this: both carriageways share a street code, so corridor-level estimates treat the boulevard as one facility even though the individual blocks stay separate.",
                    ],
                    [
                      "Context layers are incomplete",
                      "The schools layer dates from 2016, and no transit stop layer was available, so a major class of pedestrian trip generator is missing.",
                    ],
                  ].map(([title, body], i) => (
                    <li key={i} className="flex gap-3">
                      <span className="text-walksafe-orange shrink-0 mt-1">
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                        >
                          <circle cx="12" cy="12" r="5" />
                        </svg>
                      </span>
                      <div>
                        <div className="text-sm font-medium text-walksafe-text">
                          {title}
                        </div>
                        <p className="text-xs text-walksafe-text-muted mt-0.5 leading-relaxed">
                          {body}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </Section>

            {/* ---------------------------------------------------------- */}
            <Section
              id="reproducibility"
              eyebrow="Transparency"
              title="Data and code"
            >
              <div className="grid sm:grid-cols-2 gap-4">
                <Card>
                  <h3 className="font-semibold text-sm text-walksafe-text mb-2">
                    Reproducibility
                  </h3>
                  <p className="text-xs text-walksafe-text-muted leading-relaxed">
                    Fourteen ordered Python scripts, no notebook state, each
                    emitting a quality-control log recording every row dropped
                    and why. No stochastic steps, so no random seeds are
                    required — the overdispersion parameter is estimated by
                    likelihood profiling over a fixed grid. The pipeline now
                    lives in this repository under <code>pipeline/</code> with a
                    pinned <code>requirements.txt</code>; every path resolves
                    relative to the repository or through an environment
                    variable, so it runs from a clean clone. Raw crash and GIS
                    data stay outside it. Built with Python 3.10, geopandas and
                    statsmodels.
                  </p>
                </Card>
                <Card>
                  <h3 className="font-semibold text-sm text-walksafe-text mb-2">
                    Availability
                  </h3>
                  <p className="text-xs text-walksafe-text-muted leading-relaxed">
                    The full ranked table of all 16,984 intersections, the
                    candidate shortlists, and GIS layers in both projected and
                    geographic coordinate systems are available from the data
                    page. Crash microdata remain subject to PennDOT terms; the
                    derived intersection-level table carries no personal
                    information.
                  </p>
                  <a
                    href="/data"
                    className="inline-flex items-center gap-1.5 mt-3 text-xs font-medium text-walksafe-green hover:text-walksafe-green-dark"
                  >
                    Go to data downloads
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </a>
                </Card>
              </div>

              <Card className="bg-walksafe-nav text-white border-walksafe-nav">
                <h3 className="font-semibold text-sm mb-1.5">
                  Suggested citation
                </h3>
                <p className="text-xs text-gray-300 leading-relaxed font-mono">
                  Quistberg DA, et al. Ranking Philadelphia pedestrian
                  killed-or-seriously-injured intersections using empirical
                  Bayes estimation, 2015–2024. WalkSafe-AI, Urban Health
                  Collaborative, Drexel University; 2026.
                </p>
                <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
                  Peer-reviewed publications from this work are in preparation
                  and will be listed here as they appear.
                </p>
              </Card>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
