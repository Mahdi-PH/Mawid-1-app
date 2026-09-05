// Dynamic Entity Specialization — one shared terminology dictionary keyed
// off ClinicDoc.entityType, so a clinic's own dashboard/reception/patient-
// facing screens all use medical wording, and a beauty-center/salon's use
// salon wording, from this single source rather than each screen
// hardcoding its own copy. "beauty" and "salon" deliberately share one
// wording set (SALON_TERMS) — the user's own request grouped them
// together ("إذا كان الاختيار مركز تجميل أو صالون: تتغير كافة المصطلحات
// إلى..."), so only their own display label (ENTITY_TYPE_LABEL) tells them
// apart, not separate terminology.
import type { EntityType } from "./types";

export const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
  clinic: "عيادة",
  beauty: "مركز تجميل",
  salon: "صالون حلاقة",
};

export interface Terminology {
  /** "العيادة" — used e.g. in headings that name the place itself. */
  centerNoun: string;
  /** "لعيادتك" — the same noun, already inflected for "your ___" in the
   *  specific phrases that use it (Arabic possessive suffixes don't
   *  compose cleanly from a bare noun, so this is its own string rather
   *  than centerNoun + "ك"). */
  centerPossessive: string;
  /** "المريض" — the reception table's own column header. */
  personNoun: string;
  /** "مراجع" — singular, e.g. "أمامك 3 مراجع". */
  visitorNoun: string;
  /** "مراجعون" — plural, e.g. "لا يوجد مراجعون بالانتظار حالياً". */
  visitorNounPlural: string;
  /** "مراجعيك" — plural + possessive, e.g. "شارك هذا الرابط مع مراجعيك". */
  visitorPossessivePlural: string;
  /** "الطبيب" — who the patient/customer is waiting to see. */
  practitionerNoun: string;
  /** "السجل الطبي" — the Patient Passport's own read-only archive label. */
  recordLabel: string;
  /** "وصفة طبية" — one of the two record-entry types a clinic can add. */
  prescriptionNoun: string;
  /** "ملاحظة أو تقرير" — the other record-entry type. */
  noteNoun: string;
  /** Heading over the "add a new entry" form. */
  addEntryTitle: string;
  /** Placeholder text for that form's textarea. */
  addEntryPlaceholder: string;
}

const CLINIC_TERMS: Terminology = {
  centerNoun: "العيادة",
  centerPossessive: "لعيادتك",
  personNoun: "المريض",
  visitorNoun: "مراجع",
  visitorNounPlural: "مراجعون",
  visitorPossessivePlural: "مراجعيك",
  practitionerNoun: "الطبيب",
  recordLabel: "السجل الطبي",
  prescriptionNoun: "وصفة طبية",
  noteNoun: "ملاحظة أو تقرير",
  addEntryTitle: "إضافة وصفة أو تقرير جديد",
  addEntryPlaceholder: "اكتب تفاصيل الوصفة أو الملاحظة…",
};

const SALON_TERMS: Terminology = {
  centerNoun: "الصالون أو المركز",
  centerPossessive: "لصالونك أو مركزك",
  personNoun: "الزبون",
  visitorNoun: "زبون",
  visitorNounPlural: "زبائن",
  visitorPossessivePlural: "زبائنك",
  practitionerNoun: "الحلاق أو أخصائي التجميل",
  recordLabel: "سجل الخدمات",
  prescriptionNoun: "جلسة تجميل",
  noteNoun: "ملاحظات الخدمة",
  addEntryTitle: "إضافة جلسة أو ملاحظة خدمة جديدة",
  addEntryPlaceholder: "اكتب تفاصيل الجلسة أو الخدمة…",
};

/** The one place every screen resolves entityType -> wording. A
 *  missing/unrecognized value (an old clinic doc from before this field
 *  existed, or bad data) quietly falls back to CLINIC_TERMS rather than
 *  throwing or rendering "undefined" — see EntityType's own comment in
 *  types.ts for why that gap can exist at all. */
export function getTerminology(entityType: EntityType | null | undefined): Terminology {
  return entityType === "beauty" || entityType === "salon" ? SALON_TERMS : CLINIC_TERMS;
}
