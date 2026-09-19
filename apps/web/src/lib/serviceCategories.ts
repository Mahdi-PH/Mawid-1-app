// Service-category metadata for /find's new category-selection step (see
// components/ServiceCategoryCard.tsx and app/find/page.tsx). Deliberately
// keyed by the EntityType a clinic already picks once, mandatorily, at
// signup (see firebase/types.ts and the Dynamic Entity Specialization
// feature in CLAUDE.md) rather than a new field — "مراكز تجميل" /
// "عيادات طبية" / "أخرى" map exactly onto "beauty" / "clinic" / "salon",
// so filtering the existing patient directory by category needs no schema
// change, no new Firestore query, and no backfill: it's the same
// entityType every clinic already has, just surfaced as a filter step
// before the search screen instead of only driving wording elsewhere in
// the app.
//
// Centralized here (mirroring lib/firebase/terminology.ts's own per-
// entityType dictionary pattern) so the three categories' copy/colors live
// in one place a future fourth category would extend, not duplicated
// across the selection screen and any other place that might reference
// them later.
import type { EntityType } from "./firebase/types";

export interface ServiceCategoryMeta {
  title: string;
  subtitle: string;
  /** Icon stroke, title, and arrow-button background — the category's own
   *  accent. Reuses the app's existing brand tokens for "clinic" (primary
   *  teal, already used everywhere) and "salon"/"أخرى" (the existing
   *  lighter "light" brand token, already used app-wide for accents that
   *  need to read as teal but visually distinct from the primary) rather
   *  than inventing new colors for either — only "beauty" needed a
   *  genuinely new token, since the app's existing palette has no pink. */
  accent: string;
  /** Icon-circle and bottom-wave fill — a soft tint of `accent`. */
  iconBg: string;
}

export const SERVICE_CATEGORY_META: Record<EntityType, ServiceCategoryMeta> = {
  beauty: {
    title: "مراكز تجميل",
    subtitle: "خدمات التجميل والعناية",
    accent: "#E38AA6",
    iconBg: "#FCEEF3",
  },
  clinic: {
    title: "عيادات طبية",
    subtitle: "جميع التخصصات الطبية",
    accent: "#00ADB5",
    iconBg: "#EAF6F3",
  },
  salon: {
    title: "أخرى",
    subtitle: "خدمات متنوعة أخرى",
    accent: "#2DD6DC",
    iconBg: "#E7FBFA",
  },
};

// Render order for the selection grid — deliberately NOT alphabetical or
// declaration order: this page is dir="rtl", where a plain CSS grid's
// first item lands at the *right* edge (see the identical note in
// app/page.tsx's own ROLE_CARDS). "beauty" first puts "مراكز تجميل" on the
// right and "عيادات طبية" on the left in row one, matching the reference
// design; "salon" ("أخرى") is listed last so it naturally falls alone into
// row two of a two-column grid.
export const SERVICE_CATEGORY_ORDER: EntityType[] = ["beauty", "clinic", "salon"];

/** Same fallback `getTerminology()` already uses: a clinic doc from before
 *  `entityType` existed (or any unrecognized value) reads as "clinic"
 *  rather than being silently dropped from every category's results. */
export function resolveEntityType(entityType: EntityType | null | undefined): EntityType {
  if (entityType === "beauty" || entityType === "salon") return entityType;
  return "clinic";
}
