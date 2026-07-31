"use client";

import { useState, useCallback } from "react";
import type { SegmentFeature, SegmentCollection } from "@/lib/types";
import { bboxCentre } from "@/lib/geo";
import { RISK_TIER_COLORS } from "@/lib/constants";
import { Section, StatCard, DetailRow, Tag, downloadCsv } from "./panel/primitives";

interface SegmentInfoPanelProps {
  feature: SegmentFeature | null;
  metadata: SegmentCollection["metadata"] | null;
  onClose: () => void;
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
}: SegmentInfoPanelProps) {
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
    const url = `${window.location.origin}${window.location.pathname}?layer=philadelphia-segments&site=${feature.properties.seg_id}`;
    navigator.clipboard?.writeText(url).then(() => {
      setShareLabel("Copied!");
      setTimeout(() => setShareLabel("Share"), 2000);
    });
  }, [feature]);

  if (!feature) return null;
  const p = feature.properties;
  const ksi = p.ped_ksi_seg ?? 0;

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
              {n2(p.length_mi)} mi block
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
            <span className="font-semibold">Mid-block only.</span> This segment
            and the intersections at its ends split the crash record between
            them. These numbers are not on the same scale as intersection risk
            and must not be added to it.
          </p>
        </div>

        <Section title="Mid-block crashes, 2015–2024">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <StatCard label="Ped KSI" value={n0(ksi)} sublabel="killed or serious" />
            <StatCard
              label="Per mile"
              value={
                p.exposure_mi && p.exposure_mi > 0
                  ? (ksi / p.exposure_mi).toFixed(2)
                  : "—"
              }
            />
          </div>
          <DetailRow label="All pedestrian crashes" value={n0(p.ped_any_seg ?? 0)} />
          <DetailRow
            label="Deaths"
            value={n0(p.ped_deaths_seg ?? 0)}
            highlight={(p.ped_deaths_seg ?? 0) > 0}
          />
          {p.ksi_corridor !== undefined && (
            <DetailRow
              label="On this corridor"
              value={`${n0(p.ksi_corridor)} KSI`}
              sublabel={`${n0(p.corridor_n)} segments`}
            />
          )}
        </Section>

        <Section title="Model estimate">
          {p.has_model ? (
            <>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <StatCard
                  label="Expected KSI/mi"
                  value={n2(p.mu_per_mile)}
                  sublabel="10-year, this road type"
                />
                <StatCard label="Exposure" value={`${n2(p.exposure_mi)} mi`} />
              </div>
              <DetailRow label="Rank by expected KSI/mi" value={`#${n0(p.rank_seg_spf)}`} />

              {/* Estimate and its weight are shown together, always. A shrunk
                  estimate without its weight invites reading a model prediction
                  as an observation. */}
              <div className="mt-2 pt-2 border-t border-gray-100">
                <DetailRow
                  label="Empirical Bayes (segment)"
                  value={n2(p.eb_ksi_seg)}
                  sublabel={`${Math.round((1 - (p.eb_weight_seg ?? 1)) * 100)}% observed`}
                />
                <DetailRow
                  label="Empirical Bayes (corridor)"
                  value={n2(p.eb_ksi_corr)}
                  sublabel={`${Math.round((1 - (p.eb_weight_corr ?? 1)) * 100)}% observed`}
                />
                <p className="text-[10px] text-gray-400 mt-2 leading-snug">
                  At this fine a unit an empirical Bayes estimate is almost
                  entirely the model. The corridor figure is the one worth
                  ranking on — across the streets that carry crashes, observed
                  data supplies about 56% of it against 17% at the segment.
                </p>
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-500">
              This block lies entirely within the influence zones of the
              intersections at its ends, so it has no mid-block exposure of its
              own and is excluded from the model. Its crashes are still counted.
            </p>
          )}
        </Section>

        <Section title="Road context">
          <DetailRow label="Class" value={CLASS_LABEL[p.class] ?? String(p.class)} />
          <DetailRow label="Block length" value={`${n2(p.length_mi)} mi`} />
          <DetailRow label="One-way" value={p.oneway ? "Yes" : "No"} />
          <DetailRow label="Divided carriageway" value={p.divided ? "Yes" : "No"} />
          <DetailRow
            label="On High Injury Network"
            value={`${Math.round((p.hin_frac ?? 0) * 100)}% of length`}
          />
          {p.has_aadt ? (
            <DetailRow label="Traffic (AADT)" value={n0(p.aadt)} sublabel="measured" />
          ) : (
            <DetailRow label="Traffic (AADT)" value="Not measured" sublabel="nominal" />
          )}
          {!p.has_aadt && (
            <p className="text-[10px] text-gray-400 mt-1 leading-snug">
              PennDOT assigns a nominal 300 veh/day to local roads. The model
              estimates a volume effect only where a genuine count exists, so
              this segment&rsquo;s estimate rests on road class instead.
            </p>
          )}
          <DetailRow label="Population within 800 m" value={n0(p.pop_800m)} />
          <DetailRow label="Schools within 200 m" value={n0(p.schools_200m ?? 0)} />
          <DetailRow label="Parks within 200 m" value={n0(p.parks_200m ?? 0)} />
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
    </div>
  );
}
