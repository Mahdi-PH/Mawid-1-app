// Dynamic Entity Specialization — one shared terminology dictionary keyed
// off ClinicDoc.entityType, so a clinic's own dashboard/reception/patient-
// facing screens all use medical wording, and a beauty-center/salon's use
// salon wording, from this single source rather than each screen
// hardcoding its own copy. "beauty" and "salon" share every term EXCEPT
// practitionerNoun — the user's original request grouped the two
// together for general wording ("إذا كان الاختيار مركز تجميل أو صالون:
// تتغير كافة المصطلحات إلى..."), but a later request asked specifically
// for "الحالي عند X" to read "أخصائي التجميل" for a beauty center and
// "الحلاق" for a barber salon rather than the one shared "الحلاق أو
// أخصائي التجميل" phrase — so practitionerNoun alone now has its own
// per-type value, while every other term still comes from one shared
// wordset (SALON_SHARED_TERMS) so the two constants can't drift apart on
// anything but that one field.
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
  /** "الطبيب" (clinic) / "أخصائي التجميل" (beauty) / "الحلاق" (salon) —
   *  who the patient/customer is waiting to see. The one field that
   *  differs between beauty and salon; every other term is shared. */
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

/** Every term "beauty" and "salon" share — everything except
 *  practitionerNoun, which each type sets on its own below. */
const SALON_SHARED_TERMS: Omit<Terminology, "practitionerNoun"> = {
  centerNoun: "الصالون أو المركز",
  centerPossessive: "لصالونك أو مركزك",
  personNoun: "الزبون",
  visitorNoun: "زبون",
  visitorNounPlural: "زبائن",
  visitorPossessivePlural: "زبائنك",
  recordLabel: "سجل الخدمات",
  prescriptionNoun: "جلسة تجميل",
  noteNoun: "ملاحظات الخدمة",
  addEntryTitle: "إضافة جلسة أو ملاحظة خدمة جديدة",
  addEntryPlaceholder: "اكتب تفاصيل الجلسة أو الخدمة…",
};

const BEAUTY_TERMS: Terminology = { ...SALON_SHARED_TERMS, practitionerNoun: "أخصائي التجميل" };

const SALON_TERMS: Terminology = { ...SALON_SHARED_TERMS, practitionerNoun: "الحلاق" };

/** The one place every screen resolves entityType -> wording. A
 *  missing/unrecognized value (an old clinic doc from before this field
 *  existed, or bad data) quietly falls back to CLINIC_TERMS rather than
 *  throwing or rendering "undefined" — see EntityType's own comment in
 *  types.ts for why that gap can exist at all. */
export function getTerminology(entityType: EntityType | null | undefined): Terminology {
  if (entityType === "beauty") return BEAUTY_TERMS;
  if (entityType === "salon") return SALON_TERMS;
  return CLINIC_TERMS;
}
