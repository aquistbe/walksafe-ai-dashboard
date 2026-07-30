"use client";

interface FilterChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
  color?: string;
  disabled?: boolean;
}

export default function FilterChip({
  label,
  active,
  onClick,
  count,
  color,
  disabled = false,
}: FilterChipProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
        transition-all duration-150 border
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        ${
          active
            ? "border-walksafe-green bg-walksafe-green/10 text-walksafe-green"
            : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
        }
      `}
    >
      {/* Color dot indicator */}
      {color && (
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
      )}

      {/* Check mark when active */}
      {active && !color && (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}

      <span>{label}</span>

      {count !== undefined && (
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded-full ${
            active
              ? "bg-walksafe-green/20 text-walksafe-green"
              : "bg-gray-100 text-gray-500"
          }`}
        >
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}
