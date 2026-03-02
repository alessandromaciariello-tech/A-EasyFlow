"use client";

interface TagBadgeProps {
  label: string;
  variant: "asap" | "normal" | "deep_work" | "noise";
}

const variantStyles: Record<string, string> = {
  asap: "bg-red-100 text-red-800 border-red-200",
  normal: "bg-green-100 text-[#01af3b] border-[#01af3b]/20",
  deep_work: "bg-blue-100 text-[#2596be] border-[#2596be]/20",
  noise: "bg-gray-100 text-[#666666] border-gray-200",
};

export default function TagBadge({ label, variant }: TagBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${variantStyles[variant] || variantStyles.normal}`}
    >
      {label}
    </span>
  );
}
