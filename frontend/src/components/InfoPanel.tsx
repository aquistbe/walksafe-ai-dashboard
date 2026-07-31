"use client";

import { useState, useCallback } from "react";
import type { IntersectionFeature } from "@/lib/types";
import { IMAGERY_FEATURE_LABELS } from "@/lib/types";
import { TREND_CONFIG, TREND_FALLBACK } from "@/lib/constants";
import RiskBadge from "./RiskBadge";
import {
  Section,
  StatCard,
  DetailRow,
  TrendRow,
  Tag,
  downloadCsv,
} from "./panel/primitives";

/** Colour for an imagery safety score, matching the map ramp. */
function imageryColor(score: number): string {
  if (score < 25) return "#7F1D1D";
  if (score < 50) return "#C44536";
  if (score < 75) return "#D4820A";
  return "#1B6B4A";
}

interface InfoPanelProps {
  feature: IntersectionFeature | null;
  onClose: () => void;
}

export default function InfoPanel({ feature, onClose }: InfoPanelProps) {
  const [shareLabel, setShareLabel] = useState("Share");

  // Download this intersection's full record as a one-row CSV.
  const handleExport = useCallback(() => {
    if (!feature) return;
    const props = feature.properties as unknown as Record<string, unknown>;
    const [lon, lat] = feature.geometry.coordinates;

    const row: Record<string, unknown> = { ...props, longitude: lon, latitude: lat };

    const safeName = (props.int_name as string)
      ?.replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_|_$/g, "")
      .toLowerCase();

    downloadCsv(row, `walksafe_${safeName || props.node_id}.csv`);
  }, [feature]);

  // Copy a deep link that reopens this intersection.
  const handleShare = useCallback(async () => {
    if (!feature) return;
    const url = `${window.location.origin}${window.location.pathname}?site=${feature.properties.node_id}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareLabel("Copied!");
    } catch {
      setShareLabel("Copy failed");
    }
    setTimeout(() => setShareLabel("Share"), 2000);
  }, [feature]);

  if (!feature) return null;

  const p = feature.properties;

  return (
    <div className="absolute right-4 top-4 bottom-4 w-96 bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden z-20">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-walksafe-bg to-white">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0 pr-2">
            <h3 className="font-bold text-base text-walksafe-text leading-tight">
              {p.int_name}
            </h3>
            <div className="flex items-center gap-2 mt-1.5">
              <RiskBadge tier={p.risk_tier} size="sm" />
              <span className="text-xs text-gray-400">
                Rank #{p.rank_eb} of 16,984
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 shrink-0"
            aria-label="Close panel"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Quick tags */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          <Tag label={p.stoptype} />
          {p.on_hin && <Tag label="High Injury Network" accent />}
          {p.top50 && <Tag label="Top 50" accent />}
          {p.pilot_candidate && <Tag label="Pilot Candidate" accent />}
          {p.any_camera > 0 && <Tag label="Speed Camera" />}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto sidebar-scroll">
        {/* Risk Scores */}
        <Section title="Risk Scores">
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="EB Risk Score"
              value={p.eb_ksi.toFixed(3)}
              sublabel="Annual KSI estimate"
            />
            <StatCard
              label="KSI Rate"
              value={(p.ksi_per_mev * 1000).toFixed(1)}
              sublabel="per 1,000 MEV"
            />
            <StatCard
              label="Raw KSI Count"
              value={p.ped_ksi.toString()}
              sublabel="2015-2024"
            />
            <StatCard
              label="Total Ped Crashes"
              value={p.ped_crashes.toString()}
              sublabel="All severity"
            />
          </div>
        </Section>

        {/* Crash Details */}
        <Section title="Crash Details">
          <div className="space-y-2">
            <DetailRow label="Pedestrian Deaths" value={p.ped_deaths.toString()} highlight={p.ped_deaths > 0} />
            <DetailRow label="Suspected Serious Injury" value={p.ped_susp_serious.toString()} />
            <DetailRow label="Total KSI Persons" value={p.ped_ksi_persons.toString()} />
            <DetailRow label="All Ped Crashes" value={p.ped_any.toString()} />
          </div>
        </Section>

        {/* Trends */}
        <Section title="Trends">
          <div className="space-y-2">
            <TrendRow
              label="KSI Crashes"
              before={p.ksi_1519}
              after={p.ksi_2024}
              beforeLabel="2015-19"
              afterLabel="2020-24"
              trend={p.trend_ksi}
            />
            <TrendRow
              label="All Ped Crashes"
              before={p.pedany_1519}
              after={p.pedany_2024}
              beforeLabel="2015-19"
              afterLabel="2020-24"
              trend={p.trend_pedany}
            />
          </div>
        </Section>

        {/* Traffic & Context */}
        <Section title="Traffic & Context">
          <div className="space-y-2">
            <DetailRow
              label="AADT"
              value={p.aadt ? p.aadt.toLocaleString() : "N/A"}
              sublabel={p.aadt_measured ? "Measured" : "Estimated"}
            />
            <DetailRow
              label="Population (800m)"
              value={p.pop_800m ? Math.round(p.pop_800m).toLocaleString() : "N/A"}
            />
            <DetailRow
              label="Schools (200m)"
              value={p.schools_200m.toString()}
            />
            <DetailRow
              label="Parks (200m)"
              value={p.parks_200m.toString()}
            />
            <DetailRow
              label="HIN Distance"
              value={p.on_hin ? "On network" : `${p.hin_dist_m.toFixed(0)}m`}
            />
          </div>
        </Section>

        {/* Imagery assessment — blind scorer, never saw crash data */}
        {p.img_status === "OK" && typeof p.img_score === "number" && (
          <Section title="Built Environment (Imagery)">
            {p.img_mock && (
              <div className="mb-2 px-2 py-1.5 rounded bg-amber-50 border border-amber-200 text-[10px] text-amber-800">
                Mock data — not a real assessment.
              </div>
            )}

            <div className="flex items-baseline gap-2">
              <span
                className="text-2xl font-bold tabular-nums"
                style={{ color: imageryColor(p.img_score) }}
              >
                {Math.round(p.img_score)}
              </span>
              <span className="text-[11px] text-gray-400">/ 100 safety score</span>
              {typeof p.img_score_sd === "number" && p.img_score_sd > 0 && (
                <span className="text-[10px] text-gray-400 ml-auto">
                  ±{p.img_score_sd.toFixed(1)} across {p.img_headings ?? "?"} views
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-3">
              {IMAGERY_FEATURE_LABELS.map(({ key, label, protective }) => {
                const present = p[key] as boolean | null | undefined;
                if (present === null || present === undefined) return null;
                // A protective feature present is good; a hazard present is bad.
                const good = protective ? present : !present;
                return (
                  <div key={key as string} className="flex items-center gap-1.5">
                    <span
                      className={`shrink-0 ${
                        good ? "text-walksafe-green" : "text-walksafe-red"
                      }`}
                    >
                      {present ? (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      )}
                    </span>
                    <span className="text-[11px] text-gray-600 truncate">{label}</span>
                  </div>
                );
              })}
            </div>

            {(p.f_crossing_distance || p.f_through_lanes) && (
              <div className="flex gap-4 mt-3 pt-2 border-t border-gray-100 text-[11px]">
                {p.f_crossing_distance && (
                  <div>
                    <span className="text-gray-400">Crossing: </span>
                    <span className="font-medium text-walksafe-text">
                      {p.f_crossing_distance.replace(/_/g, " ")}
                    </span>
                  </div>
                )}
                {p.f_through_lanes && (
                  <div>
                    <span className="text-gray-400">Lanes: </span>
                    <span className="font-medium text-walksafe-text">
                      {p.f_through_lanes.replace(/_/g, " ")}
                    </span>
                  </div>
                )}
              </div>
            )}

            <p className="text-[10px] text-gray-400 mt-2 leading-snug">
              Assessed from street imagery alone; the model was not given crash
              history.
              {p.img_date && ` Imagery ${p.img_date}.`}
              {typeof p.img_confidence === "number" &&
                ` Model confidence ${Math.round(p.img_confidence)}%.`}
            </p>
          </Section>
        )}

        {/* Speed Camera */}
        {p.any_camera > 0 && p.camera_note && (
          <Section title="Speed Camera">
            <p className="text-xs text-gray-600 leading-relaxed">
              {p.camera_note}
            </p>
          </Section>
        )}

        {/* NACTO Recommendations */}
        {p.nacto_recs && (
          <Section title="Recommended Countermeasures">
            <ul className="space-y-1">
              {p.nacto_recs.split("; ").map((rec, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                  <span className="text-walksafe-green mt-0.5 shrink-0">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>

      {/* Footer actions */}
      <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex gap-2 shrink-0">
        <button
          disabled
          title="Site reports arrive with the SPMI model outputs (Phase 1)"
          className="flex-1 px-3 py-2 bg-gray-200 text-gray-400 text-xs font-medium rounded-lg cursor-not-allowed"
        >
          Full Report
          <span className="ml-1 text-[10px]">(soon)</span>
        </button>
        <button
          onClick={handleExport}
          title="Download this intersection's full record as CSV"
          className="px-3 py-2 border border-gray-200 text-xs font-medium rounded-lg hover:bg-gray-100 transition-colors text-gray-700"
        >
          Export
        </button>
        <button
          onClick={handleShare}
          title="Copy a link that reopens this intersection"
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
