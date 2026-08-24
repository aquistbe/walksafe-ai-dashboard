/**
 * Hover popup markup.
 *
 * These builders take a feature from the IN-MEMORY collection, never from
 * `e.features[0]`. MapLibre encodes GeoJSON sources to binary vector tiles so
 * one feature index can serve both source types, and its property writer
 * JSON.stringify()s any value that is not a string, boolean or number. Bogotá's
 * `rr` and `features` are nested objects, so off a map event they arrive as
 * strings. Looking the feature up by id sidesteps that entirely and gives the
 * builder a properly typed value.
 */

import type { DatasetConfig, LineDatasetConfig } from "@/lib/cities";
import type { UnitFeature } from "@/lib/types";
import {
  assertNever,
  isIntersectionFeature,
  isSegmentFeature,
  isTractFeature,
  isZatFeature,
} from "@/lib/types";
import { RISK_TIER_COLORS, CLUSTER_COLORS, CLUSTER_LABELS } from "@/lib/constants";
import type { RiskTier } from "@/lib/types";

const FONT = "'DM Sans', system-ui, sans-serif";

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"
  );
}

export function buildPopupHtml(feature: UnitFeature, dataset: DatasetConfig): string {
  // Exhaustive, not a two-way ternary: a segment falling through to the
  // intersection branch would render a panel of undefined fields rather than
  // failing, and nobody would notice.
  if (isZatFeature(feature)) return zatPopup(feature);
  if (isSegmentFeature(feature)) {
    // The dataset was already a parameter here but was never threaded down, so
    // the segment popup read Philadelphia's property names for both cities and
    // showed Bogotá "Mid-block KSI: 0 / Expected KSI/mi: 0.00 / 0.00 mi" on
    // every hover. Guard rather than assume: only a line dataset has `segment`.
    if (dataset.unitType !== "line") return "";
    return segmentPopup(feature, dataset);
  }
  if (isTractFeature(feature)) return tractPopup(feature);
  if (isIntersectionFeature(feature)) return intersectionPopup(feature);
  return assertNever(feature, "popup feature");
}

const CLASS_LABEL: Record<number, string> = {
  2: "Arterial", 3: "Collector", 4: "Local", 5: "Minor local",
};

function segmentPopup(feature: UnitFeature, dataset: LineDatasetConfig): string {
  if (!isSegmentFeature(feature)) return "";
  const p = feature.properties;
  const { outcomeLabel, outcomeLabelShort, distanceUnit } = dataset.measure;
  const { rateField, outcomeField, lengthField } = dataset.segment;

  const outcome = p[outcomeField] ?? 0;
  const rate = p[rateField] ?? 0;
  // Philadelphia subtracts the intersection influence zone from block length,
  // so exposure and length differ there. Bogotá's exposure IS its length.
  const exposure = p.exposure_mi ?? p[lengthField] ?? 0;

  const model = p.has_model
    ? `<span style="color: #6B7280;">Expected ${esc(outcomeLabelShort)}/${esc(distanceUnit)}:</span>
       <span style="font-weight: 600;">${esc(rate.toFixed(2))}</span>`
    : `<span style="color: #9CA3AF; grid-column: 1 / -1;">Outside the model</span>`;

  return `
    <div style="font-family: ${FONT}; font-size: 12px; line-height: 1.5; color: #2D2D2D;">
      <div style="font-weight: 700; font-size: 13px; margin-bottom: 2px;">${esc(p.unit_name)}</div>
      <div style="color: #6B7280; font-size: 10px; margin-bottom: 6px;">
        ${esc(CLASS_LABEL[p.class] ?? p.class)}${p.oneway ? " · one-way" : ""}${p.divided ? " · divided" : ""}
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; font-size: 11px;">
        <span style="color: #6B7280;">Observed ${esc(outcomeLabelShort)}:</span>
        <span style="font-weight: 600;">${esc(outcome)}</span>
        ${model}
        <span style="color: #6B7280;">Exposure:</span>
        <span style="font-weight: 600;">${esc(exposure.toFixed(2))} ${esc(distanceUnit)}</span>
        ${p.has_aadt ? `<span style="color: #6B7280;">AADT:</span><span style="font-weight: 600;">${esc((p.aadt ?? 0).toLocaleString())}</span>` : ""}
      </div>
      <div style="margin-top: 6px; padding-top: 5px; border-top: 1px solid #E5E7EB; color: #9CA3AF; font-size: 10px;">
        ${esc(dataset.segment.popupNote)}
      </div>
      <div style="color: #C9C5BD; font-size: 9px; margin-top: 2px;">
        ${esc(outcomeLabel)}, ${esc(dataset.measure.crashWindow)}
      </div>
    </div>
  `;
}

function intersectionPopup(feature: UnitFeature): string {
  const p = (feature.properties ?? {}) as unknown as Record<string, unknown>;
  const tier = p.risk_tier as RiskTier;
  const tierColor = RISK_TIER_COLORS[tier] ?? "#6B7280";
  const eb = typeof p.eb_ksi === "number" ? p.eb_ksi.toFixed(2) : String(p.eb_ksi ?? "");

  return `
    <div style="font-family: ${FONT}; font-size: 12px; line-height: 1.5; color: #2D2D2D;">
      <div style="font-weight: 700; font-size: 13px; margin-bottom: 4px;">${esc(p.int_name) || "Unknown"}</div>
      <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
        <span style="display: inline-flex; align-items: center; gap: 4px; background: ${tierColor}18; color: ${tierColor}; font-weight: 600; font-size: 10px; padding: 2px 8px; border-radius: 999px;">
          <span style="width: 6px; height: 6px; border-radius: 50%; background: ${tierColor};"></span>
          ${esc(tier)} Risk
        </span>
        <span style="color: #9CA3AF; font-size: 10px;">Rank #${esc(p.rank_eb)}</span>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; font-size: 11px;">
        <span style="color: #6B7280;">EB KSI:</span>
        <span style="font-weight: 600;">${esc(eb)}</span>
        <span style="color: #6B7280;">KSI crashes:</span>
        <span style="font-weight: 600;">${esc(p.ped_ksi)}</span>
        <span style="color: #6B7280;">Total ped:</span>
        <span style="font-weight: 600;">${esc(p.ped_crashes)}</span>
        ${p.on_hin ? '<span style="color: #6B7280;">HIN:</span><span style="font-weight: 600; color: #C44536;">On HIN</span>' : ""}
      </div>
    </div>
  `;
}

function tractPopup(feature: UnitFeature): string {
  if (!isTractFeature(feature)) return "";
  const p = feature.properties;

  // Deliberately sparse. The tract layer is ECOLOGICAL and its crash count is
  // NOT summable with the intersection or segment layers — those two partition
  // the same crashes, so adding this to them double-counts. A hover popup is
  // the wrong place to carry that caveat, so it shows what a tract IS and
  // leaves the numbers that invite arithmetic to the panel, which explains
  // them.
  const tierChip = p.tier
    ? `<span style="background: ${RISK_TIER_COLORS[p.tier]}22; color: #2D2D2D; font-weight: 600; font-size: 10px; padding: 2px 8px; border-radius: 999px;">${esc(p.tier)}</span>`
    : `<span style="background: #E5E7EB; color: #6B7280; font-weight: 600; font-size: 10px; padding: 2px 8px; border-radius: 999px;">No model</span>`;

  return `<div style="font-family: ui-sans-serif, system-ui; min-width: 190px;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
        <span style="font-weight: 700; font-size: 13px;">${esc(p.unit_name)}</span>
        ${tierChip}
      </div>
      <div style="display: grid; grid-template-columns: auto auto; gap: 2px 10px; font-size: 11px;">
        <span style="color: #6B7280;">Pedestrian KSI:</span>
        <span style="font-weight: 600;">${esc(p.ped_ksi)}</span>
        <span style="color: #6B7280;">Population:</span>
        <span style="font-weight: 600;">${p.pop === null ? "—" : esc(p.pop)}</span>
      </div>
      <div style="margin-top: 6px; font-size: 10px; color: #6B7280;">
        Tract-level association, not individual risk.
      </div>
    </div>`;
}


function zatPopup(feature: UnitFeature): string {
  if (!isZatFeature(feature)) return "";
  const p = feature.properties;

  const chip = p.clus
    ? `<span style="display: inline-flex; align-items: center; gap: 4px; background: ${CLUSTER_COLORS[p.clus]}28; color: #2D2D2D; font-weight: 600; font-size: 10px; padding: 2px 8px; border-radius: 999px;">
         <span style="width: 6px; height: 6px; border-radius: 50%; background: ${CLUSTER_COLORS[p.clus]};"></span>
         Profile ${p.clus}${p.is_reference_cluster ? " · reference" : ""}
       </span>`
    : `<span style="background: #E5E7EB; color: #6B7280; font-weight: 600; font-size: 10px; padding: 2px 8px; border-radius: 999px;">No profile</span>`;

  const crashRows = p.has_covariates
    ? `<span style="color: #6B7280;">Casualties:</span>
       <span style="font-weight: 600;">${esc(p.casualties)}</span>
       <span style="color: #6B7280;">Injuries:</span>
       <span style="font-weight: 600;">${esc(p.injury)}</span>
       <span style="color: #6B7280;">Deaths:</span>
       <span style="font-weight: 600;">${esc(p.death)}</span>
       <span style="color: #6B7280;">Per 10k trips:</span>
       <span style="font-weight: 600;">${esc(p.casualties_per_10k_trips)}</span>`
    : `<span style="color: #9CA3AF; grid-column: 1 / -1;">No crash data joined for this zone</span>`;

  const label = p.clus ? CLUSTER_LABELS[p.clus] : "";

  return `
    <div style="font-family: ${FONT}; font-size: 12px; line-height: 1.5; color: #2D2D2D;">
      <div style="font-weight: 700; font-size: 13px; margin-bottom: 4px;">${esc(p.unit_name)}</div>
      <div style="margin-bottom: 6px;">${chip}</div>
      ${label ? `<div style="color: #6B7280; font-size: 10px; margin-bottom: 6px;">${esc(label)}</div>` : ""}
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; font-size: 11px;">
        ${crashRows}
        ${p.has_pop60 ? `<span style="color: #6B7280;">Aged 60+:</span><span style="font-weight: 600;">${esc(p.pct60plus)}%</span>` : ""}
      </div>
      <div style="margin-top: 6px; padding-top: 5px; border-top: 1px solid #E5E7EB; color: #9CA3AF; font-size: 10px;">
        Zone-level association — not individual risk.
      </div>
    </div>
  `;
}
