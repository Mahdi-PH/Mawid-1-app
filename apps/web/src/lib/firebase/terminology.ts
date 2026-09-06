// Dynamic Entity Specialization — one shared terminology dictionary keyed
// off ClinicDoc.entityType, so a clinic's own dashboard/reception/patient-
// facing screens all use medical wording, and a beauty-center/other-
// commercial-center's use customer wording, from this single source
// rather than each screen hardcoding its own copy. The underlying
// EntityType value "salon" is unchanged (no data migration needed for
// existing docs) — only its own display label was renamed, from "صالون
// حلاقة" (a barber salon specifically) to "مركز تجاري آخر" (a generic
// other commercial center), per the user's explicit ask to broaden it
// beyond just barbershops. "beauty" and "salon" share every term EXCEPT
// practitionerNoun — the user's original request grouped the two
// together for general wording ("إذا كان الاختيار مركز تجميل أو صالون:
// تتغير كافة المصطلحات إلى..."), but a later request asked specifically
// for "الحالي عند X" to read "أخصائي التجميل" for a beauty center and a
// distinct word for the other type rather than one shared phrase — so
// practitionerNoun alone has its own per-type value, while every other
// term still comes from one shared wordset (SALON_SHARED_TERMS) so the
// two constants can't drift apart on anything but that one field. Once
// "salon" stopped meaning "barber" specifically, its own practitionerNoun
// ("الحلاق") had to become generic too — see SALON_TERMS below.
import type { EntityType } from "./types";

export const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
  clinic: "عيادة",
  beauty: "مركز تجميل",
  salon: "مركز تجاري آخر",
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
  /** "الطبيب" (clinic) / "أخصائي التجميل" (beauty) / "الموظف المختص"
   *  (other commercial center) — who the patient/customer is waiting to
   *  see. The one field that differs between beauty and the other-
   *  center type; every other term is shared. */
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

const SALON_TERMS: Terminology = { ...SALON_SHARED_TERMS, practitionerNoun: "الموظف المختص" };

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

/** The "مسح السجل الطبي" tool (scanning a patient's Universal Patient
 *  Passport QR to read/append their medical record — see
 *  components/ScanPatientTab.tsx) only makes sense for a clinic or a
 *  beauty center; a "مركز تجاري آخر" account has no medical record to
 *  scan, so its own settings drawer never offers this tool at all —
 *  not just disabled, entirely absent from the menu. Centralized here
 *  rather than a raw `=== "salon"` check scattered at each call site. */
export function supportsMedicalRecordScan(entityType: EntityType | null | undefined): boolean {
  return entityType !== "salon";
}
