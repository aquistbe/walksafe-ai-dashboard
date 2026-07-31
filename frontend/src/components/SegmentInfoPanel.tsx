"use client";

import { useState, useCallback } from "react";
import type { SegmentFeature, SegmentCollection } from "@/lib/types";
import type { LineDatasetConfig } from "@/lib/cities";
import { bboxCentre } from "@/lib/geo";
import { RISK_TIER_COLORS } from "@/lib/constants";
import { Section, StatCard, DetailRow, Tag, downloadCsv } from "./panel/primitives";

interface SegmentInfoPanelProps {
  feature: SegmentFeature | null;
  metadata: SegmentCollection["metadata"] | null;
  onClose: () => void;
  /**
   * The dataset itself. Unit, outcome name, crash window, property names and
   * the "outside the model" explanation all come from here — this panel used
   * to take two optional labels and default them to Philadelphia's, then read
   * `p.length_mi` and render PennDOT's nominal-AADT note regardless of city.
   */
  dataset: LineDatasetConfig;
  attribution?: string;
}

const CLASS_LABEL: Record<number, string> = {
  2: "Arterial", 3: "Collector", 4: "Local", 5: "Minor local",
};

const n0 = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v.toLocaleString();
const n2 = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v.toFixed(2);

export default function SegmentInfoPanel({
  feature,
  metadata,
  onClose,
  dataset,
  attribution,
}: SegmentInfoPanelProps) {
  const { distanceUnit: U, outcomeLabel, outcomeLabelShort } = dataset.measure;
  const { rateField, outcomeField, lengthField, hasTrafficVolume } = dataset.segment;
  const [shareLabel, setShareLabel] = useState("Share");

  const handleExport = useCallback(() => {
    if (!feature) return;
    const p = feature.properties;
    const [lon, lat] = bboxCentre(feature);
    downloadCsv(
      {
        ...p,
        // Labelled as a bbox centre, not a true centroid — a curved street's
        // bbox centre can sit off the line entirely.
        bbox_centre_lon: lon,
        bbox_centre_lat: lat,
        caveat: metadata?.caveat ?? "",
      },
      `walksafe_segment_${p.seg_id}.csv`
    );
  }, [feature, metadata]);

  const handleShare = useCallback(() => {
    if (!feature) return;
    // The layer id came from the dataset, not a literal: this used to hardcode
    // `philadelphia-segments`, so sharing a Bogotá segment produced a link that
    // reopened Philadelphia and resolved the Bogotá seg_id against it.
    const url =
      `${window.location.origin}${window.location.pathname}` +
      `?layer=${dataset.id}&site=${feature.properties.seg_id}`;
    navigator.clipboard?.writeText(url).then(() => {
      setShareLabel("Copied!");
      setTimeout(() => setShareLabel("Share"), 2000);
    });
  }, [feature, dataset.id]);

  if (!feature) return null;
  const p = feature.properties;
  const outcome = p[outcomeField] ?? 0;
  const len = p[lengthField];
  const perU = p[rateField];

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
              {CLASS_LABEL[p.class] ?? `Class ${p.class}`} ·{" "}
              {n2(len)} {U} block
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
          {p.tier && (
            <span
              className="text-[10px] px-2 py-0.5 rounded-full font-medium text-white"
              style={{ backgroundColor: RISK_TIER_COLORS[p.tier] }}
            >
              {p.tier}
            </span>
          )}
          {p.oneway && <Tag label="One-way" />}
          {p.divided && <Tag label="Divided" />}
          {(p.hin_frac ?? 0) >= 0.5 && <Tag label="High Injury Network" />}
          {!p.has_model && <Tag label="Outside the model" />}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto sidebar-scroll">
        {/* The non-comparability warning comes before any number. */}
        <div className="mx-5 mt-3 mb-1 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <p className="text-[11px] text-amber-900 leading-snug">
            {metadata?.caveat ??
              "This layer's numbers are not on the same scale as the other layers' and must not be added to them."}
          </p>
        </div>

        <Section title={`Observed crashes, ${dataset.measure.crashWindow}`}>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <StatCard label={outcomeLabelShort} value={n0(outcome)} />
            <StatCard
              label={`Per ${U}`}
              value={len && len > 0 ? (outcome / len).toFixed(2) : "—"}
            />
          </div>
          {p.ped_any_seg !== undefined && (
            <DetailRow label="All pedestrian crashes" value={n0(p.ped_any_seg)} />
          )}
          {p.ped_deaths_seg !== undefined && (
            <DetailRow
              label="Deaths"
              value={n0(p.ped_deaths_seg)}
              highlight={(p.ped_deaths_seg ?? 0) > 0}
            />
          )}
          {p.ksi_corridor !== undefined && (
            <DetailRow
              label="On this corridor"
              value={`${n0(p.ksi_corridor)} ${outcomeLabelShort}`}
              sublabel={`${n0(p.corridor_n)} segments`}
            />
          )}
        </Section>

        <Section title="Model estimate">
          {p.has_model ? (
            <>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <StatCard
                  label={`Expected per ${U}`}
                  value={n2(perU)}
                  sublabel="this road type"
                />
                <StatCard
                  label="Exposure"
                  value={`${n2(p.exposure_mi ?? len)} ${U}`}
                />
              </div>
              <DetailRow label={`Rank by expected per ${U}`} value={`#${n0(p.rank_seg_spf)}`} />

              {/* Estimate and its weight are shown together, always. A shrunk
                  estimate without its weight invites reading a model prediction
                  as an observation. */}
              <div className="mt-2 pt-2 border-t border-gray-100">
                <DetailRow
                  label="Empirical Bayes (segment)"
                  value={n2(p.eb_ksi_seg)}
                  sublabel={`${Math.round((1 - (p.eb_weight_seg ?? 1)) * 100)}% observed`}
                />
                {p.eb_ksi_corr !== undefined && (
                  <DetailRow
                    label="Empirical Bayes (corridor)"
                    value={n2(p.eb_ksi_corr)}
                    sublabel={`${Math.round((1 - (p.eb_weight_corr ?? 1)) * 100)}% observed`}
                  />
                )}
                <p className="text-[10px] text-gray-400 mt-2 leading-snug">
                  An empirical Bayes estimate blends the model with what was
                  observed. The weight beside each figure says how much came
                  from the data — read the estimate and its weight together.
                </p>
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-500">
              {dataset.segment.outsideModelNote}
            </p>
          )}
        </Section>

        {/* Every row below is conditional on the field actually being emitted.
            These are Philadelphia's covariates — HIN, AADT, population, schools
            and parks are not in the Bogotá extract — and rendering them
            unconditionally printed a column of em-dashes plus PennDOT's
            nominal-AADT note over a Colombian street. */}
        <Section title="Road context">
          <DetailRow label="Class" value={CLASS_LABEL[p.class] ?? String(p.class)} />
          <DetailRow label="Block length" value={`${n2(len)} ${U}`} />
          <DetailRow label="One-way" value={p.oneway ? "Yes" : "No"} />
          {p.divided !== undefined && (
            <DetailRow label="Divided carriageway" value={p.divided ? "Yes" : "No"} />
          )}
          {p.width_m !== undefined && (
            <DetailRow label="Carriageway width" value={`${n2(p.width_m)} m`} />
          )}
          {p.lanes !== undefined && <DetailRow label="Lanes" value={n0(p.lanes)} />}
          {p.speed !== undefined && (
            <DetailRow label="Speed limit" value={`${n0(p.speed)} km/h`} />
          )}
          {p.has_signal !== undefined && (
            <DetailRow label="Signalised" value={p.has_signal ? "Yes" : "No"} />
          )}
          {p.hin_frac !== undefined && (
            <DetailRow
              label="On High Injury Network"
              value={`${Math.round(p.hin_frac * 100)}% of length`}
            />
          )}
          {hasTrafficVolume && (
            <>
              {p.has_aadt ? (
                <DetailRow label="Traffic (AADT)" value={n0(p.aadt)} sublabel="measured" />
              ) : (
                <>
                  <DetailRow label="Traffic (AADT)" value="Not measured" sublabel="nominal" />
                  <p className="text-[10px] text-gray-400 mt-1 leading-snug">
                    PennDOT assigns a nominal 300 veh/day to local roads. The
                    model estimates a volume effect only where a genuine count
                    exists, so this segment&rsquo;s estimate rests on road class
                    instead.
                  </p>
                </>
              )}
            </>
          )}
          {p.pop_800m !== undefined && (
            <DetailRow label="Population within 800 m" value={n0(p.pop_800m)} />
          )}
          {p.schools_200m !== undefined && (
            <DetailRow label="Schools within 200 m" value={n0(p.schools_200m)} />
          )}
          {p.parks_200m !== undefined && (
            <DetailRow label="Parks within 200 m" value={n0(p.parks_200m)} />
          )}
        </Section>
      </div>

      <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex gap-2 shrink-0">
        <button
          onClick={handleExport}
          title="Download this segment's record as CSV"
          className="flex-1 px-3 py-2 border border-gray-200 text-xs font-medium rounded-lg hover:bg-gray-100 transition-colors text-gray-700"
        >
          Export
        </button>
        <button
          onClick={handleShare}
          title="Copy a link that reopens this segment"
          className={`px-3 py-2 border text-xs font-medium rounded-lg transition-colors ${
            shareLabel === "Copied!"
              ? "border-walksafe-green text-walksafe-green bg-walksafe-green/5"
              : "border-gray-200 text-gray-700 hover:bg-gray-100"
          }`}
        >
          {shareLabel}
        </button>
      </div>
      {attribution && (
        <div className="px-5 py-2 border-t border-gray-100 bg-gray-50 shrink-0">
          <p className="text-[9px] text-gray-400 leading-snug">{attribution}</p>
        </div>
      )}
    </div>
  );
}
