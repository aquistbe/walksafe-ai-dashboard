"use client";

/**
 * Shared InfoPanel building blocks.
 *
 * Moved verbatim out of InfoPanel.tsx so ZatInfoPanel can reuse them rather
 * than growing a second, drifting copy of the same styling.
 */

import { TREND_CONFIG, TREND_FALLBACK } from "@/lib/constants";

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-3 border-b border-gray-50">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
        {title}
      </h4>
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <div className="bg-walksafe-bg rounded-lg px-3 py-2">
      <p className="text-[10px] text-gray-500 font-medium">{label}</p>
      <p className="text-lg font-bold text-walksafe-text mt-0.5">{value}</p>
      {sublabel && <p className="text-[10px] text-gray-400">{sublabel}</p>}
    </div>
  );
}

export function DetailRow({
  label,
  value,
  sublabel,
  highlight = false,
}: {
  label: string;
  value: string;
  sublabel?: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-gray-600">{label}</span>
      <div className="flex items-center gap-1.5">
        <span
          className={`text-xs font-semibold ${
            highlight ? "text-walksafe-red" : "text-walksafe-text"
          }`}
        >
          {value}
        </span>
        {sublabel && <span className="text-[10px] text-gray-400">({sublabel})</span>}
      </div>
    </div>
  );
}

export function TrendRow({
  label,
  before,
  after,
  beforeLabel,
  afterLabel,
  trend,
}: {
  label: string;
  before: number | null;
  after: number | null;
  beforeLabel: string;
  afterLabel: string;
  trend: string | null | undefined;
}) {
  const config = (trend && TREND_CONFIG[trend]) || TREND_FALLBACK;
  const fmt = (v: number | null) => (v === null || v === undefined ? "—" : v);

  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-gray-600">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-400">
          {beforeLabel}: {fmt(before)}
        </span>
        <span style={{ color: config.color }} className="font-bold text-sm">
          {config.arrow}
        </span>
        <span className="text-[10px] text-gray-400">
          {afterLabel}: {fmt(after)}
        </span>
      </div>
    </div>
  );
}

export function Tag({ label, accent = false }: { label: string; accent?: boolean }) {
  return (
    <span
      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
        accent
          ? "bg-walksafe-green/10 text-walksafe-green"
          : "bg-gray-100 text-gray-500"
      }`}
    >
      {label}
    </span>
  );
}

/** Escape a value for CSV output. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Trigger a browser download of a one-row CSV. */
export function downloadCsv(row: Record<string, unknown>, filename: string): void {
  const headers = Object.keys(row);
  const csv =
    headers.join(",") + "\n" + headers.map((h) => csvCell(row[h])).join(",") + "\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
