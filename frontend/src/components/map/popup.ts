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

import type { CityConfig } from "@/lib/cities";
import type { UnitFeature } from "@/lib/types";
import { isZatFeature } from "@/lib/types";
import { RISK_TIER_COLORS, CLUSTER_COLORS, CLUSTER_LABELS } from "@/lib/constants";
import type { RiskTier } from "@/lib/types";

const FONT = "'DM Sans', system-ui, sans-serif";

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"
  );
}

export function buildPopupHtml(feature: UnitFeature, city: CityConfig): string {
  return isZatFeature(feature) ? zatPopup(feature) : intersectionPopup(feature);
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
       <span style="color: #6B7280;">Per km²:</span>
       <span style="font-weight: 600;">${esc(p.casualties_per_km2)}</span>`
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
