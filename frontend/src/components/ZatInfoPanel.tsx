"use client";

import { useState, useCallback } from "react";
import type {
  ZatFeature,
  ZatCollection,
  ModelSpecId,
  ModelSpecEstimates,
  CrashOutcome,
} from "@/lib/types";
import { rrDisplay, CANVAS_FEATURE_KEYS } from "@/lib/types";
import {
  CLUSTER_COLORS,
  CLUSTER_LABELS,
  CLUSTER_DESCRIPTIONS,
  SES_LABEL,
} from "@/lib/constants";
import { bboxCentre } from "@/lib/geo";
import { Section, StatCard, DetailRow, Tag, downloadCsv } from "./panel/primitives";

interface ZatInfoPanelProps {
  feature: ZatFeature | null;
  metadata: ZatCollection["metadata"] | null;
  onClose: () => void;
}

const n0 = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v.toLocaleString();
const n1 = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: 1 });

/** Never scientific notation in the UI. */
function fmtP(p: number | null): string {
  if (p === null) return "";
  if (p < 0.001) return "p < 0.001";
  return `p = ${p.toPrecision(3)}`;
}

export default function ZatInfoPanel({ feature, metadata, onClose }: ZatInfoPanelProps) {
  const [shareLabel, setShareLabel] = useState("Share");

  const handleExport = useCallback(() => {
    if (!feature) return;
    const p = feature.properties;
    const [lon, lat] = bboxCentre(feature);

    // Flatten the nested blocks — a naive {...props} spread writes
    // "[object Object]" for `rr` and `features`.
    const row: Record<string, unknown> = {
      unit_id: p.unit_id,
      unit_name: p.unit_name,
      has_data: p.has_data,
      has_features: p.has_features,
      has_covariates: p.has_covariates,
      has_pop60: p.has_pop60,
      area_km2: p.area_km2,
      cluster: p.clus,
      is_reference_cluster: p.is_reference_cluster,
      ses_cat: p.ses_cat,
      injury: p.injury,
      death: p.death,
      casualties: p.casualties,
      expected_casualties: p.expected_casualties,
      excess_casualties: p.excess_casualties,
      casualties_per_10k_trips: p.casualties_per_10k_trips,
      injury_per_10k_trips: p.injury_per_10k_trips,
      death_per_10k_trips: p.death_per_10k_trips,
      casualties_per_km2: p.casualties_per_km2,
      injury_per_km2: p.injury_per_km2,
      death_per_km2: p.death_per_km2,
      pop_total_2018: p.pop_total_2018,
      pop60plus_2018: p.pop60plus_2018,
      pct60plus: p.pct60plus,
      n_manzanas: p.n_manzanas,
      pop_density: p.pop_density,
      walk_pubt: p.walk_pubt,
      pcta_Collector: p.pcta_Collector,
      pcta_Local: p.pcta_Local,
      pcta_other: p.pcta_other,
      MEANIPM: p.MEANIPM,
      bbox_centre_lon: lon,
      bbox_centre_lat: lat,
      caveat: metadata?.caveat ?? "",
    };

    if (p.rr) {
      for (const model of ["replication", "plus_pct60"] as ModelSpecId[]) {
        const block = p.rr[model];
        for (const outcome of ["injury", "death"] as CrashOutcome[]) {
          const e = block?.[outcome];
          row[`rr_${model}_${outcome}`] = e?.rr ?? "";
          row[`rr_${model}_${outcome}_lo`] = e?.lo ?? "";
          row[`rr_${model}_${outcome}_hi`] = e?.hi ?? "";
          row[`rr_${model}_${outcome}_n`] = e?.n ?? "";
        }
      }
    }
    if (p.features) {
      for (const k of CANVAS_FEATURE_KEYS) row[`feat_${k}`] = p.features[k];
    }

    downloadCsv(row, `walksafe_bogota_zat_${p.unit_id}.csv`);
  }, [feature, metadata]);

  const handleShare = useCallback(() => {
    if (!feature) return;
    const url = `${window.location.origin}${window.location.pathname}?city=bogota&site=${feature.properties.unit_id}`;
    navigator.clipboard?.writeText(url).then(() => {
      setShareLabel("Copied!");
      setTimeout(() => setShareLabel("Share"), 2000);
    });
  }, [feature]);

  if (!feature) return null;
  const p = feature.properties;

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
              Transport analysis zone · {n1(p.area_km2)} km²
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
          {p.clus ? (
            <span
              className="text-[10px] px-2 py-0.5 rounded-full font-medium text-walksafe-text"
              style={{ backgroundColor: `${CLUSTER_COLORS[p.clus]}44` }}
            >
              Profile {p.clus}
            </span>
          ) : (
            <Tag label="No profile" />
          )}
          {p.is_reference_cluster && <Tag label="Model reference" accent />}
          {p.ses_cat !== null && <Tag label={`${SES_LABEL} ${p.ses_cat}`} />}
          {!p.has_covariates && <Tag label="No crash data" />}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto sidebar-scroll">
        {/* The ecological caveat comes before any number. */}
        <div className="mx-5 mt-3 mb-1 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <p className="text-[11px] text-amber-900 leading-snug">
            <span className="font-semibold">Ecological.</span> Everything below
            describes {p.unit_name} as an area. It does not estimate risk for any
            individual in it.
          </p>
        </div>

        {/* Zone profile */}
        <Section title="Zone profile">
          {p.clus ? (
            <>
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="w-3.5 h-3.5 rounded-sm border border-black/10 shrink-0"
                  style={{ backgroundColor: CLUSTER_COLORS[p.clus] }}
                />
                <span className="text-sm font-semibold text-walksafe-text">
                  Profile {p.clus} — {CLUSTER_LABELS[p.clus]}
                </span>
              </div>
              <p className="text-[11px] text-gray-600 leading-relaxed">
                {CLUSTER_DESCRIPTIONS[p.clus]}
              </p>
            </>
          ) : (
            <p className="text-xs text-gray-500">
              This zone was not assigned a built-environment profile — it is
              outside the 840 zones covered by the imagery extraction.
            </p>
          )}
        </Section>

        {/* Crashes */}
        <Section title="Pedestrian crashes, 2015–2019">
          {p.has_covariates ? (
            <>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <StatCard label="Casualties" value={n0(p.casualties)} sublabel="injury + death" />
                <StatCard label="Per 10k trips" value={n1(p.casualties_per_10k_trips)} sublabel="walking + transit trips to the zone, 2019 survey" />
              </div>
              <DetailRow label="Injuries" value={n0(p.injury)} />
              <DetailRow label="Deaths" value={n0(p.death)} highlight={(p.death ?? 0) > 0} />
              <DetailRow label="Per km² (area density, not exposure)" value={n1(p.casualties_per_km2)} />
              {p.has_expected && (
                <>
                  <DetailRow label="Expected (offset model)" value={n1(p.expected_casualties)} />
                  <DetailRow
                    label="Excess over expectation"
                    value={(p.excess_casualties ?? 0) > 0 ? `+${n1(p.excess_casualties)}` : n1(p.excess_casualties)}
                    highlight={(p.excess_casualties ?? 0) > 15}
                  />
                </>
              )}
              <p className="text-[10px] text-gray-400 mt-2 leading-snug">
                Damage-only crashes are excluded — nearly every pedestrian struck
                is injured or killed, and the source data agree (19 damage-only
                crashes across all 783 zones).
              </p>
            </>
          ) : (
            <p className="text-xs text-gray-500">
              No crash data joined for this zone. It is outside the 783 zones in
              the crash analysis.
            </p>
          )}
        </Section>

        {/* Relative risk */}
        {p.rr && p.clus && (
          <Section title="Relative risk vs the reference profile">
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-3">
              <p className="text-[10px] text-gray-600 leading-snug">
                Two model specifications are reported. Estimates are{" "}
                <span className="font-semibold">not comparable across them</span>
                {" "}— do not mix.
              </p>
            </div>

            <ModelBlock
              heading="All ages"
              modelId={p.rr.primary_model}
              estimates={p.rr[p.rr.primary_model]}
              isReference={p.rr.is_reference}
              primary
            />

            <div className="mt-3 pt-3 border-t border-gray-100">
              <ModelBlock
                heading="Adjusted for 60+ population share"
                modelId={p.rr.secondary_model}
                estimates={p.rr[p.rr.secondary_model]}
                isReference={p.rr.is_reference}
                note="The 60+ share is a zone-level covariate, not an age-stratified outcome. These are not older-adult-specific risks."
              />
            </div>

            <p className="text-[10px] text-gray-400 mt-3 leading-snug">
              Estimates describe the profile this zone belongs to, not this zone
              individually. Reference: profile {p.rr.reference_cluster}.
            </p>
          </Section>
        )}

        {/* Population */}
        <Section title="Population">
          {p.has_pop60 ? (
            <>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <StatCard label="Aged 60+" value={`${n1(p.pct60plus)}%`} />
                <StatCard label="Residents" value={n0(p.pop_total_2018)} sublabel="2018 census" />
              </div>
              <DetailRow label="Aged 60+ (count)" value={n0(p.pop60plus_2018)} />
              <DetailRow label="City blocks (manzanas)" value={n0(p.n_manzanas)} />
            </>
          ) : (
            <p className="text-xs text-gray-500">No population data joined for this zone.</p>
          )}
        </Section>

        {/* Context */}
        {p.has_covariates && (
          <Section title="Zone context">
            <DetailRow label={`${SES_LABEL} (socioeconomic stratum)`} value={n0(p.ses_cat)} />
            <DetailRow label="Population density" value={n0(p.pop_density)} />
            <DetailRow label="Walking / transit trips" value={n0(p.walk_pubt)} />
            <DetailRow label="Collector roads" value={`${n1(p.pcta_Collector)}%`} />
            <DetailRow label="Local roads" value={`${n1(p.pcta_Local)}%`} />
            <DetailRow label="Other roads" value={`${n1(p.pcta_other)}%`} />
            {p.MEANIPM !== null && <DetailRow label="MEANIPM" value={n1(p.MEANIPM)} />}
            <p className="text-[10px] text-gray-400 mt-2 leading-snug">
              Stratum is shown as a plain category. The socioeconomic gradient in
              these data is not monotonic — risk peaks at stratum 2 — so no
              ordered colour scale is applied.
            </p>
          </Section>
        )}

        {/* CANVAS features */}
        {p.features && (
          <Section title="Built environment (27 CANVAS features)">
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {CANVAS_FEATURE_KEYS.map((k) => (
                <div key={k} className="flex items-center justify-between py-0.5">
                  <span className="text-[10px] text-gray-600 truncate" title={k}>
                    {k.replace(/_/g, " ")}
                  </span>
                  <span className="text-[10px] font-semibold text-walksafe-text tabular-nums ml-1">
                    {n0(p.features![k])}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-2 leading-snug">
              {metadata?.taxonomy_note ??
                "The 27 features derive from the CANVAS pedestrian safety audit instrument, which also seeded the Gemini scoring taxonomy. They are not independent instruments."}
            </p>
          </Section>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex gap-2 shrink-0">
        <button
          onClick={handleExport}
          title="Download this zone's full record as CSV"
          className="flex-1 px-3 py-2 border border-gray-200 text-xs font-medium rounded-lg hover:bg-gray-100 transition-colors text-gray-700"
        >
          Export
        </button>
        <button
          onClick={handleShare}
          title="Copy a link that reopens this zone"
          className={`px-3 py-2 border text-xs font-medium rounded-lg transition-colors ${
            shareLabel === "Copied!"
              ? "border-walksafe-green text-walksafe-green bg-walksafe-green/5"
              : "border-gray-200 text-gray-700 hover:bg-gray-100"
          }`}
        >
          {shareLabel}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ModelBlock({
  heading,
  modelId,
  estimates,
  isReference,
  primary = false,
  note,
}: {
  heading: string;
  modelId: ModelSpecId;
  estimates: ModelSpecEstimates | null;
  isReference: boolean;
  primary?: boolean;
  note?: string;
}) {
  if (!estimates) return null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-xs font-semibold text-walksafe-text">
          {primary && <span className="text-walksafe-green">Primary · </span>}
          {heading}
        </span>
        <span className="text-[10px] text-gray-400 tabular-nums shrink-0">
          {modelId} · n = {estimates.n}
        </span>
      </div>

      {note && (
        <p className="text-[10px] text-gray-500 leading-snug mb-1.5">{note}</p>
      )}

      {(["injury", "death"] as CrashOutcome[]).map((outcome) => (
        <RrRow
          key={outcome}
          label={outcome === "injury" ? "Injury" : "Death"}
          estimate={estimates[outcome]}
          isReference={isReference}
        />
      ))}
    </div>
  );
}

function RrRow({
  label,
  estimate,
  isReference,
}: {
  label: string;
  estimate: ModelSpecEstimates["injury"];
  isReference: boolean;
}) {
  const d = rrDisplay(estimate, isReference);
  if (!d) return null;

  // The reference branch has no lo/hi in scope, so an interval cannot be
  // rendered here even by accident. That is the point of RrDisplay.
  if (d.kind === "reference") {
    return (
      <div className="py-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-600">{label}</span>
          <span className="text-xs font-semibold text-walksafe-text">
            1.00 — reference
          </span>
        </div>
        <p className="text-[10px] text-gray-400 leading-snug">
          This profile is the model&rsquo;s reference category. Others are
          compared against it; it has no interval of its own.
        </p>
      </div>
    );
  }

  const pctLower = Math.round((1 - d.rr) * 100);

  return (
    <div className="py-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-600">{label}</span>
        <span className="text-xs font-semibold text-walksafe-text tabular-nums">
          {d.rr.toFixed(2)}{" "}
          <span className="font-normal text-gray-500">
            (95% CI {d.lo.toFixed(2)}–{d.hi.toFixed(2)})
          </span>
        </span>
      </div>
      <p className="text-[10px] text-gray-400 leading-snug">
        {pctLower > 0
          ? `${pctLower}% lower ${label.toLowerCase()} count than the reference profile`
          : `${Math.abs(pctLower)}% higher ${label.toLowerCase()} count than the reference profile`}
        {estimate?.p !== null && estimate?.p !== undefined && ` · ${fmtP(estimate.p)}`}
      </p>
    </div>
  );
}
