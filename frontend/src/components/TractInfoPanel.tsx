"use client";

/**
 * Census-tract InfoPanel.
 *
 * Two things here are not styling decisions:
 *
 * 1. Every ACS value renders with its 90% interval, and values with a
 *    coefficient of variation over 30% are marked. At tract level the margins
 *    are large enough to swallow the estimate — one tract reports a median
 *    household income of $102,670 ± $50,798 — so a bare point estimate would
 *    be a misrepresentation, not a simplification.
 *
 * 2. The crash-accounting block states what this layer shares with the other
 *    two. It is the only Philadelphia layer holding the complete geocoded set,
 *    which makes it the one most likely to be added to the others by mistake.
 */

import { useState, useCallback } from "react";
import type { TractFeature, TractCollection, AcsKey, AcsKind } from "@/lib/types";
import { ACS_LABELS, acsReliability, CV_UNRELIABLE } from "@/lib/types";
import { RISK_TIER_COLORS } from "@/lib/constants";
import { bboxCentre } from "@/lib/geo";
import { Section, StatCard, DetailRow, Tag, downloadCsv } from "./panel/primitives";

interface TractInfoPanelProps {
  feature: TractFeature | null;
  metadata: TractCollection["metadata"] | null;
  onClose: () => void;
  attribution?: string | null;
}

const n0 = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v.toLocaleString();
const n1 = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "—"
    : v.toLocaleString(undefined, { maximumFractionDigits: 1 });
const n2 = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v.toFixed(2);

function fmtAcs(v: number | undefined, kind: AcsKind): string {
  if (v === undefined || v === null) return "—";
  return kind === "usd"
    ? `$${Math.round(v).toLocaleString()}`
    : `${v.toFixed(1)}%`;
}

/**
 * One ACS row: estimate, 90% interval, and a reliability mark.
 *
 * The interval is not decoration. Where the CV exceeds 30% the estimate cannot
 * order this tract against its neighbours, and the row says so rather than
 * leaving the reader to infer it from a number that looks precise.
 */
function AcsRow({
  label,
  value,
  moe,
  cv,
  kind,
}: {
  label: string;
  value: number | undefined;
  moe: number | undefined;
  cv: number | undefined;
  kind: AcsKind;
}) {
  const rel = acsReliability(cv);
  const has = value !== undefined && value !== null;

  return (
    <div className="py-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-600">{label}</span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span
            className={`text-xs font-semibold ${
              rel === "unreliable" ? "text-gray-400" : "text-walksafe-text"
            }`}
          >
            {fmtAcs(value, kind)}
          </span>
          {rel === "unreliable" && (
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-50 text-walksafe-red font-semibold"
              title={`Coefficient of variation ${n1(cv)}% — above the ${CV_UNRELIABLE}% Census reliability threshold. Do not use this value to rank tracts.`}
            >
              unreliable
            </span>
          )}
          {rel === "caution" && (
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 font-semibold"
              title={`Coefficient of variation ${n1(cv)}% — use with caution.`}
            >
              ±
            </span>
          )}
        </span>
      </div>
      {has && moe !== undefined && moe !== null && (
        <p className="text-[10px] text-gray-400 tabular-nums">
          90% CI {fmtAcs(value - moe, kind)} to {fmtAcs(value + moe, kind)}
          {cv !== undefined && cv !== null && ` · CV ${n1(cv)}%`}
        </p>
      )}
    </div>
  );
}

export default function TractInfoPanel({
  feature,
  metadata,
  onClose,
  attribution,
}: TractInfoPanelProps) {
  const [shareLabel, setShareLabel] = useState("Share");

  const handleExport = useCallback(() => {
    if (!feature) return;
    const p = feature.properties;
    const [lon, lat] = bboxCentre(feature);

    const row: Record<string, unknown> = {
      tract_id: p.tract_id,
      geoid: p.geoid,
      unit_name: p.unit_name,
      has_model: p.has_model,
      has_crashes: p.has_crashes,
      has_acs: p.has_acs,
      ped_ksi: p.ped_ksi,
      ksi_intersection: p.ksi_intersection ?? 0,
      ksi_midblock: p.ksi_midblock ?? 0,
      ksi_near_boundary_50m: p.ksi_near_boundary ?? 0,
      ped_deaths: p.ped_deaths ?? 0,
      ped_any: p.ped_any ?? 0,
      road_mi: p.road_mi ?? 0,
      pct_arterial: p.pct_arterial ?? 0,
      n_nodes: p.n_nodes ?? 0,
      land_km2: p.land_km2 ?? 0,
      mu_spf: p.mu_spf ?? "",
      eb_ksi: p.eb_ksi ?? "",
      eb_weight: p.eb_weight ?? "",
      eb_per_road_mi: p.eb_per_road_mi ?? "",
      excess_ksi: p.excess_ksi ?? "",
      tier: p.tier ?? "",
      rank_eb: p.rank_eb ?? "",
      ksi_per_10k_pop: p.ksi_per_10k_pop ?? "",
      pop: p.pop ?? "",
      pop_moe: p.pop_moe ?? "",
      bbox_centre_lon: lon,
      bbox_centre_lat: lat,
      caveat: metadata?.caveat ?? "",
    };

    // Estimate, margin of error and CV travel together into the export too.
    // A downloaded point estimate with no interval is the same problem one
    // step downstream.
    for (const { key, label } of ACS_LABELS) {
      const props = p as unknown as Record<string, number | undefined>;
      row[key] = props[key] ?? "";
      row[`${key}_moe`] = props[`${key}_moe`] ?? "";
      row[`${key}_cv`] = props[`${key}_cv`] ?? "";
      void label;
    }

    downloadCsv(row, `walksafe_philadelphia_tract_${p.geoid}.csv`);
  }, [feature, metadata]);

  const handleShare = useCallback(() => {
    if (!feature) return;
    const url = `${window.location.origin}${window.location.pathname}?city=philadelphia&dataset=philadelphia-tracts&site=${feature.properties.tract_id}`;
    navigator.clipboard?.writeText(url).then(() => {
      setShareLabel("Copied!");
      setTimeout(() => setShareLabel("Share"), 2000);
    });
  }, [feature]);

  if (!feature) return null;
  const p = feature.properties;
  const props = p as unknown as Record<string, number | undefined>;
  const tierColor = p.tier ? RISK_TIER_COLORS[p.tier] : "#6B7280";
  const excess = p.excess_ksi ?? 0;
  const nearShare =
    p.ped_ksi > 0 ? ((p.ksi_near_boundary ?? 0) / p.ped_ksi) * 100 : 0;

  return (
    <div className="absolute right-4 top-4 bottom-4 w-96 bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden z-20">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-gray-100 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-walksafe-text truncate">
              {p.unit_name}
            </h3>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Census tract {p.geoid} · {n1(p.land_km2)} km² ·{" "}
              {n1(p.road_mi)} road mi
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 shrink-0"
            title="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {p.tier ? (
            <span
              className="text-[10px] px-2 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: `${tierColor}22`, color: tierColor }}
            >
              {p.tier} risk
            </span>
          ) : (
            <Tag label="Outside the model" />
          )}
          {p.rank_eb ? <Tag label={`Rank #${p.rank_eb} of 407`} /> : null}
          {!p.has_crashes && <Tag label="No KSI recorded" />}
          {!p.has_acs && <Tag label="No ACS estimate" />}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto sidebar-scroll">
        {/* The ecological caveat comes before any number. */}
        <div className="mx-5 mt-3 mb-1 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <p className="text-[11px] text-amber-900 leading-snug">
            <span className="font-semibold">Ecological.</span> Everything below
            describes {p.unit_name} as an area. It does not estimate risk for any
            individual in it, and tract boundaries are administrative — drawn for
            census tabulation, not for traffic safety.
          </p>
        </div>

        {/* Crashes — the complete set, and what that means */}
        <Section title="Pedestrian KSI, 2015–2024">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <StatCard
              label="Killed or seriously injured"
              value={n0(p.ped_ksi)}
              sublabel={`${n0(p.ped_deaths ?? 0)} killed`}
            />
            <StatCard
              label="All pedestrian crashes"
              value={n0(p.ped_any ?? 0)}
            />
          </div>
          <DetailRow
            label="At junctions"
            value={n0(p.ksi_intersection ?? 0)}
            sublabel="intersection layer"
          />
          <DetailRow
            label="Mid-block"
            value={n0(p.ksi_midblock ?? 0)}
            sublabel="segment layer"
          />
          <p className="text-[10px] text-gray-500 leading-snug mt-1.5 bg-gray-50 rounded px-2 py-1.5">
            This tract counts <span className="font-semibold">both</span>. The
            intersection and segment layers split these crashes between them;
            this layer holds all of them. The three layers describe the same
            crashes under different units —{" "}
            <span className="font-semibold">never add them together</span>.
          </p>
        </Section>

        {/* Risk model */}
        <Section title="Risk model">
          {p.has_model ? (
            <>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <StatCard
                  label="Expected KSI/road mi"
                  value={n2(p.eb_per_road_mi)}
                  sublabel="empirical Bayes"
                />
                <StatCard
                  label={excess >= 0 ? "More than expected" : "Fewer than expected"}
                  value={`${excess >= 0 ? "+" : ""}${n1(excess)}`}
                  sublabel="observed − SPF"
                />
              </div>
              <DetailRow label="Observed KSI" value={n0(p.ped_ksi)} />
              <DetailRow label="SPF expectation" value={n1(p.mu_spf)} />
              <DetailRow label="Empirical Bayes estimate" value={n1(p.eb_ksi)} />
              <DetailRow
                label="Weight on the model"
                value={n2(p.eb_weight)}
                sublabel={`${n0(Math.round((1 - (p.eb_weight ?? 0)) * 100))}% observed`}
              />
              <DetailRow label="Arterial / collector" value={`${n1(p.pct_arterial)}%`} />
              <DetailRow label="Intersections" value={n0(p.n_nodes)} />
              {p.aadt_mean ? (
                <DetailRow label="Mean AADT (measured)" value={n0(p.aadt_mean)} />
              ) : null}
              <p className="text-[10px] text-gray-500 leading-snug mt-1.5">
                Negative binomial with <span className="font-semibold">road
                miles</span> as the offset, not residents. Population is a
                covariate. Unlike the segment layer, most of this estimate is
                observed data rather than the model.
              </p>
            </>
          ) : (
            <p className="text-xs text-gray-500">
              This tract is outside the model — it has almost no walkable street
              network. Its crashes are still counted above.
            </p>
          )}
        </Section>

        {/* The boundary problem, per tract */}
        {p.ped_ksi > 0 && (
          <Section title="Boundary effect">
            <DetailRow
              label="KSI within 50 m of this tract's edge"
              value={`${n0(p.ksi_near_boundary ?? 0)} of ${n0(p.ped_ksi)}`}
              sublabel={`${n0(Math.round(nearShare))}%`}
              highlight={nearShare >= 60}
            />
            <p className="text-[10px] text-gray-500 leading-snug mt-1.5">
              Tract boundaries follow streets, and crashes happen on streets.
              Where an arterial divides two tracts its burden splits between
              them, so both read as roughly half the corridor.{" "}
              {metadata
                ? `Citywide, ${metadata.boundary_effect.pct_within_50m}% of KSI sit within 50 m of a boundary.`
                : null}
            </p>
          </Section>
        )}

        {/* Equity — descriptive, with every interval shown */}
        <Section title="Who lives here (ACS 5-year)">
          {p.has_acs ? (
            <>
              <DetailRow
                label="Population"
                value={n0(p.pop)}
                sublabel={p.pop_moe ? `± ${n0(p.pop_moe)}` : undefined}
              />
              <div className="mt-1 divide-y divide-gray-50">
                {ACS_LABELS.map(({ key, label, kind }) => (
                  <AcsRow
                    key={key}
                    label={label}
                    value={props[key as AcsKey]}
                    moe={props[`${key}_moe`]}
                    cv={props[`${key}_cv`]}
                    kind={kind}
                  />
                ))}
              </div>
              <p className="text-[10px] text-gray-500 leading-snug mt-2 bg-gray-50 rounded px-2 py-1.5">
                <span className="font-semibold">Descriptive only.</span> These
                are area characteristics shown beside a crash count, not an
                adjusted association and not a cause. Margins of error at tract
                level are wide — read the interval, not the point estimate.
              </p>
            </>
          ) : (
            <p className="text-xs text-gray-500">
              No ACS estimate for this tract. Small-population tracts are
              suppressed by the Census for disclosure control.
            </p>
          )}
        </Section>

        {/* The confounded denominator, shown and labelled */}
        {p.ksi_per_10k_pop !== undefined && (
          <Section title="Per-capita rate">
            <DetailRow
              label="KSI per 10,000 residents"
              value={n1(p.ksi_per_10k_pop)}
            />
            <p className="text-[10px] text-gray-500 leading-snug mt-1.5">
              Shown because it is what most equity dashboards report, and{" "}
              <span className="font-semibold">not</span> what this layer ranks
              on. A tract with few residents and heavy foot traffic — Center
              City, the Navy Yard — scores extremely high on this measure
              because of how few people sleep there, not because walking there
              is proportionally more dangerous. The risk model uses road miles
              for exactly that reason.
            </p>
          </Section>
        )}

        {attribution && (
          <div className="px-5 py-3">
            <p className="text-[9px] text-gray-400 leading-snug">{attribution}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-5 py-3 border-t border-gray-100 flex gap-2 shrink-0">
        <button
          onClick={handleExport}
          className="flex-1 text-xs font-medium text-walksafe-text bg-walksafe-bg hover:bg-gray-100 rounded-lg py-2 transition-colors"
        >
          Export CSV
        </button>
        <button
          onClick={handleShare}
          className="flex-1 text-xs font-medium text-walksafe-text bg-walksafe-bg hover:bg-gray-100 rounded-lg py-2 transition-colors"
        >
          {shareLabel}
        </button>
      </div>
    </div>
  );
}
