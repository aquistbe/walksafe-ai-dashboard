import type { RiskTier } from "@/lib/types";
import { RISK_TIER_COLORS, RISK_TIER_BG_COLORS, RISK_TIER_LABELS } from "@/lib/constants";

interface RiskBadgeProps {
  tier: RiskTier;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

export default function RiskBadge({
  tier,
  size = "md",
  showLabel = true,
}: RiskBadgeProps) {
  const color = RISK_TIER_COLORS[tier];
  const bgColor = RISK_TIER_BG_COLORS[tier];
  const label = showLabel ? RISK_TIER_LABELS[tier] : tier;

  const sizeClasses = {
    sm: "text-[10px] px-1.5 py-0.5",
    md: "text-xs px-2 py-1",
    lg: "text-sm px-3 py-1.5",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${sizeClasses[size]}`}
      style={{ backgroundColor: bgColor, color }}
    >
      <span
        className={`rounded-full ${size === "sm" ? "w-1.5 h-1.5" : "w-2 h-2"}`}
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
