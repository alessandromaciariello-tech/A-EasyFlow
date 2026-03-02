"use client";

interface TagBadgeProps {
  label: string;
  variant: "asap" | "normal" | "deep_work" | "noise";
}

const variantStyles: Record<string, string> = {
  asap: "bg-red-100/80 text-red-700 border-red-200/60",
  normal: "bg-emerald-100/60 text-[#2D6A4F] border-[#2D6A4F]/15",
  deep_work: "bg-sky-100/60 text-sky-700 border-sky-200/60",
  noise: "bg-neutral-dark/[0.06] text-neutral-dark/70 border-neutral-dark/10",
};

export default function TagBadge({ label, variant }: TagBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${variantStyles[variant] || variantStyles.normal}`}
    >
      {label}
    </span>
  );
}
