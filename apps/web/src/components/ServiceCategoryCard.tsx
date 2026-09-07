"use client";

import type { ReactNode } from "react";

/** A single filterable-service-category tile for /find's new category-
 *  selection step — icon in a soft tinted circle, title, one-line
 *  subtitle, a small circular arrow button, and a soft wave along the
 *  card's own bottom edge, all driven by the caller's `accent`/`iconBg`
 *  (see lib/serviceCategories.ts's three categories) so a future fourth
 *  category needs only a new metadata entry and icon, not a new
 *  component. Mirrors the exact same visual language and wave/icon-
 *  circle/arrow-button technique the home screen's own HomeOptionCard
 *  already established (see app/page.tsx) — just parameterized per-color
 *  here, since three different categories need three different accents
 *  instead of one shared brand teal.
 *
 *  The whole card is one <button>, not just the arrow — per the request
 *  that the entire tile be tappable, not only its arrow icon. */
export interface ServiceCategoryCardProps {
  title: string;
  subtitle: string;
  icon: ReactNode;
  accent: string;
  iconBg: string;
  onTap: () => void;
  className?: string;
}

function ArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

const ICON_SIZE = 48;
const ARROW_SIZE = 36;

export default function ServiceCategoryCard({
  title,
  subtitle,
  icon,
  accent,
  iconBg,
  onTap,
  className = "",
}: ServiceCategoryCardProps) {
  return (
    <button
      type="button"
      onClick={onTap}
      className={
        "relative flex w-full flex-col items-center gap-1.5 overflow-hidden rounded-2xl border bg-white px-3 py-5 text-center shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5 " +
        className
      }
      style={{ borderColor: "#e5eef0" }}
    >
      <svg aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-8 w-full" viewBox="0 0 200 32" preserveAspectRatio="none">
        <path d="M0,17 C50,31 150,3 200,16 L200,32 L0,32 Z" fill={iconBg} />
      </svg>
      <div
        className="relative z-10 flex items-center justify-center rounded-full"
        style={{ width: ICON_SIZE, height: ICON_SIZE, background: iconBg, color: accent }}
      >
        {icon}
      </div>
      <h3 className="relative z-10 text-base font-bold leading-snug" style={{ color: accent }}>
        {title}
      </h3>
      <p className="relative z-10 text-sm leading-snug text-gray-500">{subtitle}</p>
      <span
        className="relative z-10 mt-auto flex items-center justify-center rounded-full"
        style={{ width: ARROW_SIZE, height: ARROW_SIZE, background: accent }}
      >
        <ArrowIcon />
      </span>
    </button>
  );
}
