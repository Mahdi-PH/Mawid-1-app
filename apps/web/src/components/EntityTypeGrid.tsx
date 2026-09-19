"use client";

import type { ReactNode } from "react";
import ServiceCategoryCard from "./ServiceCategoryCard";
import { SERVICE_CATEGORY_META, SERVICE_CATEGORY_ORDER } from "../lib/serviceCategories";
import type { EntityType } from "../lib/firebase/types";

// The one shared "pick your center's type" grid — same icons, colors,
// wave/arrow-button cards, RTL order, and lone-row-two centering /find's
// own service-category filter step already established (see
// lib/serviceCategories.ts). Extracted out of app/find/page.tsx so the
// signup flow's own type-selection step (see SignupClient.tsx) renders
// from this exact same component instead of a second, drifting copy —
// per the explicit "لا تكرر الكود" requirement: /find and "إدارة
// المراكز" must look and behave identically here, not merely similarly.

function ClinicCategoryIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 9.5 12 4l8 5.5" />
      <rect x="5" y="9.5" width="14" height="11" rx="1" />
      <path d="M12 12.5v5M9.5 15h5" />
    </svg>
  );
}

function BeautyCategoryIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 4.5c1.6 0 2.8 1.4 2.8 3.1S13.6 10.7 12 10.7 9.2 9.3 9.2 7.6 10.4 4.5 12 4.5Z" />
      <path d="M19.5 12c0 1.6-1.4 2.8-3.1 2.8S13.3 13.6 13.3 12s1.4-2.8 3.1-2.8 3.1 1.2 3.1 2.8Z" />
      <path d="M12 19.5c-1.6 0-2.8-1.4-2.8-3.1s1.2-2.8 2.8-2.8 2.8 1.4 2.8 3.1-1.2 2.8-2.8 2.8Z" />
      <path d="M4.5 12c0-1.6 1.4-2.8 3.1-2.8s2.8 1.4 2.8 3.1-1.4 2.8-3.1 2.8S4.5 13.6 4.5 12Z" />
    </svg>
  );
}

function OtherCategoryIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  );
}

const CATEGORY_ICON: Record<EntityType, ReactNode> = {
  beauty: <BeautyCategoryIcon />,
  clinic: <ClinicCategoryIcon />,
  salon: <OtherCategoryIcon />,
};

export default function EntityTypeGrid({ onSelect }: { onSelect: (entityType: EntityType) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {SERVICE_CATEGORY_ORDER.map((entityType) => {
        const meta = SERVICE_CATEGORY_META[entityType];
        const isLoneRow = entityType === "salon"; // "أخرى" is the only row-two entry
        return (
          <div key={entityType} className={isLoneRow ? "col-span-2 flex justify-center" : ""}>
            <ServiceCategoryCard
              title={meta.title}
              subtitle={meta.subtitle}
              icon={CATEGORY_ICON[entityType]}
              accent={meta.accent}
              iconBg={meta.iconBg}
              onTap={() => onSelect(entityType)}
              className={isLoneRow ? "max-w-[calc(50%-0.375rem)]" : ""}
            />
          </div>
        );
      })}
    </div>
  );
}
