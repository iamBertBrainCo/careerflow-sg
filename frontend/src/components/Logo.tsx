"use client";
import { useId } from "react";

// Brand mark: a career path that rises and flows forward. Mirrors app/icon.svg.
export function LogoMark({ className = "w-9 h-9" }: { className?: string }) {
  // Unique gradient ids: a duplicate id inside a hidden copy would blank out visible ones.
  const id = useId();
  const bg = `${id}-bg`;
  const flow = `${id}-flow`;
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0F2A3A" />
          <stop offset="1" stopColor="#071621" />
        </linearGradient>
        <linearGradient id={flow} x1="14" y1="46" x2="50" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2DD4BF" />
          <stop offset="1" stopColor="#67E8F9" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${bg})`} />
      <path d="M16 45c9 0 10-20 20-20h12" stroke={`url(#${flow})`} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M41 18l8 7-8 7" stroke="#67E8F9" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="45" r="4.5" fill="#2DD4BF" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark className="w-9 h-9 shrink-0" />
      {!compact && (
        <span className="text-[17px] font-semibold tracking-tight text-ink">
          CareerFlow<span className="text-brand"> SG</span>
        </span>
      )}
    </div>
  );
}
