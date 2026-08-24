"use client";

import type {
  DatasetConfig,
  LineDatasetConfig,
  PointDatasetConfig,
  PolygonDatasetConfig,
} from "@/lib/cities";
import type { RiskTier, ZatCluster } from "@/lib/types";
import {
  RISK_TIER_COLORS,
  RISK_TIER_LABELS,
  RISK_TIERS,
  CLUSTER_COLORS,
  CLUSTER_LABELS,
  CLUSTER_ORDER,
  NO_DATA_FILL,
  NO_DATA_LINE,
  CASUALTY_DENSITY_BREAKS,
  CASUALTY_DENSITY_RAMP,
  PCT60_BREAKS,
  PCT60_RAMP,
  TRACT_EXCESS_BREAKS, TRACT_EXCESS_RAMP,
  TRACT_OBSERVED_BREAKS, TRACT_OBSERVED_RAMP,
  TRACT_POVERTY_BREAKS, TRACT_POVERTY_RAMP,
} from "@/lib/constants";
import {
  SEG_SPF_RAMP,
  SEG_OBSERVED_RAMP,
  SEG_AADT_BREAKS, SEG_AADT_RAMP,
} from "./layers";

export type LegendCounts = Record<string, number>;

interface LegendProps {
  dataset: DatasetConfig;
  layerMode: string;
  counts: LegendCounts;
  /** Shown as a footer. The dashboard republishes municipal open data, so
   *  the credit belongs on the map, not only on an About page. */
  attribution?: string | null;
}

export default function Legend({
  dataset,
  layerMode,
  counts,
  attribution,
}: LegendProps) {
  return (
    <div className="absolute bottom-14 left-3 z-10 bg-white/95 backdrop-blur-sm rounded-lg shadow-md border border-gray-200 p-3 min-w-[190px] max-w-[250px]">
      {dataset.unitType === "polygon" && renderZatLegend(dataset, layerMode, counts)}
      {dataset.unitType === "line" && renderSegmentLegend(dataset, layerMode, counts)}
      {dataset.unitType === "point" &&
        renderIntersectionLegend(dataset, layerMode, counts)}
      {attribution && (
        <p className="text-[9px] text-gray-400 mt-2 pt-2 border-t border-gray-100 leading-snug">
          {attribution}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Street segments — one renderer, both cities
//
// This used to be two functions picked by `dataset.id === "bogota-segments"`,
// which meant a fifth line layer would silently render Philadelphia's titles,
// cut-points and footnotes over its own data. Titles are composed from
// `measure`, breaks and notes come from `segment`, so a new dataset has to
// state its own or it does not compile.
// ---------------------------------------------------------------------------

function renderSegmentLegend(
  dataset: LineDatasetConfig,
  layerMode: string,
  counts: LegendCounts
) {
  const total = counts.total ?? 0;
  const { outcomeLabel, outcomeLabelShort, distanceUnitLong } = dataset.measure;
  const notes = dataset.segment.legendNotes;

  if (layerMode === "observed") {
    return (
      <>
        <Title>Observed {outcomeLabel}</Title>
        <Ramp ramp={SEG_OBSERVED_RAMP} breaks={dataset.segment.observedBreaks} />
        <Coverage
          have={counts.hasCrashes ?? 0}
          total={total}
          what="a recorded crash"
          unitLabelPlural={dataset.unitLabelPlural}
        />
        <NoDataRow
          label="None recorded"
          count={counts.noCrashes}
          color={NO_DATA_LINE}
          dimmed={false}
        />
        <Foot>{notes.observed}</Foot>
      </>
    );
  }
  if (layerMode === "aadt") {
    return (
      <>
        <Title>Traffic volume (AADT)</Title>
        <Ramp ramp={SEG_AADT_RAMP} breaks={SEG_AADT_BREAKS} />
        <Coverage
          have={counts.hasAadt ?? 0}
          total={total}
          what="a genuine traffic count"
          unitLabelPlural={dataset.unitLabelPlural}
        />
        <NoDataRow
          label="Nominal placeholder"
          count={counts.noAadt}
          color={NO_DATA_LINE}
          dimmed={false}
        />
        <Foot>{notes.aadt}</Foot>
      </>
    );
  }
  return (
    <>
      <Title>
        Expected {outcomeLabelShort} per {distanceUnitLong}
      </Title>
      <Ramp ramp={SEG_SPF_RAMP} breaks={dataset.segment.spfBreaks} />
      <Coverage
        have={counts.hasModel ?? 0}
        total={total}
        what="a model estimate"
        unitLabelPlural={dataset.unitLabelPlural}
      />
      <NoDataRow
        label="Outside the model"
        count={counts.noModel}
        color={NO_DATA_LINE}
        dimmed={false}
      />
      <Foot>{notes.spf}</Foot>
    </>
  );
}

/** Coverage stated positively, and as a share, so grey cannot read as broken. */
function Coverage({
  have,
  total,
  what,
  unitLabelPlural,
}: {
  have: number;
  total: number;
  what: string;
  unitLabelPlural: string;
}) {
  if (!total) return null;
  const pct = (have / total) * 100;
  return (
    <p className="text-[10px] text-walksafe-text mt-1.5 leading-snug">
      <span className="font-semibold tabular-nums">{have.toLocaleString()}</span>{" "}
      of <span className="tabular-nums">{total.toLocaleString()}</span>{" "}
      {unitLabelPlural} ({pct.toFixed(1)}%) have {what}.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Bogotá
// ---------------------------------------------------------------------------

function renderZatLegend(
  dataset: PolygonDatasetConfig,
  layerMode: string,
  counts: LegendCounts
) {
  /**
   * No-data count for the ACTIVE mode.
   *
   * Every branch below used to read `counts.none`, which page.tsx fills with
   * the number of zones lacking a CLUSTER. That is right for the zone-profile
   * mode and wrong for the other two: Casualties and Age 60+ both printed 39
   * where the real answers are 96 zones with no crash data and 28 with no
   * population. Coverage differs per variable — that is the whole reason
   * LayerModeConfig carries a gateField — so the count has to come from the
   * mode's own gate.
   */
  const noData = (): number | undefined => {
    const gate = dataset.layerModes.find((m) => m.id === layerMode)?.gateField;
    return gate ? counts[`no_${gate}`] : counts.none;
  };

  if (layerMode === "casualties") {
    return (
      <>
        <Title>Casualties per km²</Title>
        <Ramp ramp={CASUALTY_DENSITY_RAMP} breaks={CASUALTY_DENSITY_BREAKS} />
        <NoDataRow label="No crash data" count={noData()} />
        <Foot>
          Injury + death, {dataset.measure.crashWindow}. Per km², because raw
          counts are not comparable across zones of very different size.
        </Foot>
      </>
    );
  }

  if (layerMode === "age60") {
    return (
      <>
        <Title>Population aged 60+</Title>
        <Ramp ramp={PCT60_RAMP} breaks={PCT60_BREAKS} suffix="%" />
        <NoDataRow label="No population data" count={noData()} />
        <Foot>2018 census, ZAT level.</Foot>
      </>
    );
  }

  // Philadelphia tracts (24 Aug 2026). Before these three branches every
  // tract mode fell through to the zone-profile block below.
  if (layerMode === "excess") {
    return (
      <>
        <Title>Excess pedestrian KSI</Title>
        <Ramp ramp={TRACT_EXCESS_RAMP} breaks={TRACT_EXCESS_BREAKS} minLabel="−8" />
        <NoDataRow label="No model" count={noData()} />
        <Foot>
          Observed minus the safety-performance-function expectation,
          {" "}{dataset.measure.crashWindow}. Blue: fewer than road miles and
          population predict; red: more. Ecological — not individual risk.
        </Foot>
      </>
    );
  }

  if (layerMode === "observed") {
    return (
      <>
        <Title>Observed pedestrian KSI</Title>
        <Ramp ramp={TRACT_OBSERVED_RAMP} breaks={TRACT_OBSERVED_BREAKS} />
        <Foot>
          Killed or seriously injured, {dataset.measure.crashWindow}, by crash
          location. Zero is a count, not missing data. Not summable with the
          intersection or segment layers.
        </Foot>
      </>
    );
  }

  if (layerMode === "poverty") {
    return (
      <>
        <Title>Below the poverty level</Title>
        <Ramp ramp={TRACT_POVERTY_RAMP} breaks={TRACT_POVERTY_BREAKS} suffix="%" />
        <NoDataRow label="No ACS estimate" count={noData()} />
        <Foot>
          ACS 2020–2024 5-year estimate; tract margins of error are large and
          shown with every value in the panel.
        </Foot>
      </>
    );
  }

  // Cluster profile. Ordered by built-environment intensity, not by number —
  // that ordering is what the ramp encodes and what makes the map readable.
  return (
    <>
      <Title>Zone profile</Title>
      <div className="space-y-1.5">
        {CLUSTER_ORDER.map((c: ZatCluster) => (
          <div key={c} className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              <span
                className="w-3 h-3 rounded-sm shrink-0 mt-0.5 border border-black/10"
                style={{ backgroundColor: CLUSTER_COLORS[c] }}
              />
              <span className="text-[11px] text-walksafe-text leading-tight">
                <span className="font-medium">Profile {c}</span>
                {c === 4 && (
                  <span className="text-walksafe-green font-medium"> · reference</span>
                )}
                <br />
                <span className="text-gray-500">{CLUSTER_LABELS[c]}</span>
              </span>
            </div>
            <span className="text-[10px] tabular-nums text-gray-400 font-medium shrink-0">
              {(counts[String(c)] ?? 0).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
      <NoDataRow label="No profile" count={noData()} />
      <Foot>
        Ordered by built-environment intensity. Profile 4 is the model&rsquo;s
        reference category — it carries the most infrastructure and the most
        crashes.
      </Foot>
    </>
  );
}

// ---------------------------------------------------------------------------
// Philadelphia — unchanged content
// ---------------------------------------------------------------------------

function renderIntersectionLegend(
  dataset: PointDatasetConfig,
  layerMode: string,
  counts: LegendCounts
) {
  if (layerMode === "imagery") {
    return (
      <>
        <Title>Imagery Safety Score</Title>
        <div
          className="h-2.5 rounded-full mb-1.5"
          style={{
            background:
              "linear-gradient(to right, #7F1D1D, #C44536, #D4820A, #65A30D, #1B6B4A)",
          }}
        />
        <div className="flex justify-between text-[10px] text-gray-400 mb-2">
          <span>0 hostile</span>
          <span>100 protected</span>
        </div>
        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
          <span
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: "#E5E7EB" }}
          />
          <span className="text-[11px] text-walksafe-text-muted">Not yet scored</span>
        </div>
        <Foot>Scored from street imagery only — the model never saw crash data.</Foot>
      </>
    );
  }

  return (
    <>
      <Title>Risk Tier</Title>
      <div className="space-y-1.5">
        {RISK_TIERS.map((tier: RiskTier) => (
          <div key={tier} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: RISK_TIER_COLORS[tier] }}
              />
              <span className="text-xs text-walksafe-text">
                {RISK_TIER_LABELS[tier]}
              </span>
            </div>
            <span className="text-[10px] tabular-nums text-gray-400 font-medium">
              {(counts[tier] ?? 0).toLocaleString()}
            </span>
          </div>
        ))}
      </div>

      {layerMode === "crashes" && (
        <div className="mt-3 pt-2 border-t border-gray-100">
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
            Circle Size = {dataset.measure.outcomeLabelShort} Count
          </div>
          <div className="flex items-end gap-2 px-1">
            {[3, 5, 8, 12].map((r, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <div
                  className="rounded-full bg-gray-300"
                  style={{ width: r * 2, height: r * 2 }}
                />
                <span className="text-[9px] text-gray-400">{[0, 2, 5, 10][i]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Title({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
      {children}
    </div>
  );
}

function Foot({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] text-gray-400 mt-2 leading-snug">{children}</p>
  );
}

function Ramp({
  ramp,
  breaks,
  suffix = "",
  minLabel = "0",
}: {
  ramp: string[];
  breaks: number[];
  suffix?: string;
  /** Left-edge label. "0" for every sequential ramp; a diverging ramp
   *  (tract excess KSI) starts below zero and must say so. */
  minLabel?: string;
}) {
  return (
    <>
      <div className="flex h-2.5 rounded-full overflow-hidden mb-1">
        {ramp.map((c) => (
          <div key={c} className="flex-1" style={{ backgroundColor: c }} />
        ))}
      </div>
      {/* `suffix` was accepted as a prop and never rendered, so the Bogotá 60+
          ramp printed bare numbers where it meant percentages — 10, 14, 18
          reading as counts rather than shares of the population. */}
      <div className="flex justify-between text-[9px] text-gray-400 tabular-nums mb-1">
        <span>{minLabel}{suffix}</span>
        {breaks.map((b) => (
          <span key={b}>
            {b}
            {suffix}
          </span>
        ))}
        <span />
      </div>
    </>
  );
}

/**
 * The swatch must match what the map actually draws. Line datasets use a
 * darker no-data colour at full opacity; zone fills use the lighter one and
 * are drawn semi-transparent, so the swatch is dimmed to match.
 */
function NoDataRow({
  label,
  count,
  color = NO_DATA_FILL,
  dimmed = true,
}: {
  label: string;
  count?: number;
  color?: string;
  dimmed?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 mt-2 pt-2 border-t border-gray-100">
      <div className="flex items-center gap-2">
        <span
          className={`w-3 h-3 rounded-sm shrink-0 border border-black/10${dimmed ? " opacity-60" : ""}`}
          style={{ backgroundColor: color }}
        />
        <span className="text-[11px] text-walksafe-text-muted">{label}</span>
      </div>
      {count !== undefined && (
        <span className="text-[10px] tabular-nums text-gray-400 font-medium">
          {count.toLocaleString()}
        </span>
      )}
    </div>
  );
}
