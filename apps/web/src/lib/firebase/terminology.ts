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
  /** "لعيادتك" (clinic) / "لمركزك" (beauty, other commercial center) — the
   *  same noun, already inflected for "your ___" in the specific phrases
   *  that use it (Arabic possessive suffixes don't compose cleanly from a
   *  bare noun, so this is its own string rather than centerNoun + "ك").
   *  Beauty/other-commercial-center's own value is deliberately NOT
   *  derived from centerNoun ("الصالون أو المركز") — that longer phrase
   *  was leaking the literal word "صالون" ("salon") into
   *  ClinicAccountDrawer's own "رابط المركز" panel body text even for a
   *  center whose whole point (see the entity-rename section of
   *  CLAUDE.md) is that it's no longer barber-specific, so this reads a
   *  plain "مركزك" instead — never "صالونك" for either remaining type. */
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
  /** "رابط العيادة" — the settings-drawer menu row (and, once open, the
   *  drawer's own header) for the shareable public booking link. Its own
   *  fixed string per type rather than derived from centerNoun — a
   *  beauty center and a "مركز تجاري آخر" both read the exact same
   *  "رابط المركز" here, even though they'd otherwise share centerNoun's
   *  own longer "الصالون أو المركز" phrasing, which reads fine inline
   *  but was never meant to double as a short menu-row label. */
  centerLinkLabel: string;
  /** "اسم العيادة" / "اسم مركز التجميل" / "اسم المركز" — the signup
   *  form's own name-field label, swapped per entityType now that the
   *  type is chosen on its own step *before* this field is even shown
   *  (see SignupClient.tsx) rather than picked alongside it. Its own
   *  fixed string per type, not derived from centerNoun/ENTITY_TYPE_LABEL
   *  — Arabic's definite-article agreement ("العيادة" vs. plain
   *  "عيادة") isn't a mechanical concatenation. */
  clinicNameLabel: string;
  /** Placeholder for the signup form's "الوصف" textarea — the label
   *  itself stays the fixed word "الوصف" for every type (per the
   *  request's own explicit instruction), only the placeholder hint
   *  varies. */
  descriptionPlaceholder: string;
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
  centerLinkLabel: "رابط العيادة",
  clinicNameLabel: "اسم العيادة",
  descriptionPlaceholder: "أدخل وصف العيادة",
};

/** Every term "beauty" and "salon" share — everything except
 *  practitionerNoun/clinicNameLabel/descriptionPlaceholder, which each
 *  type sets on its own below (a beauty center's own name-field label
 *  reads "اسم مركز التجميل", genuinely different from "مركز تجاري
 *  آخر"'s plain "اسم المركز" — these two types no longer share every
 *  term the way they still do for the rest of this dictionary). */
const SALON_SHARED_TERMS: Omit<Terminology, "practitionerNoun" | "clinicNameLabel" | "descriptionPlaceholder"> = {
  centerNoun: "الصالون أو المركز",
  centerPossessive: "لمركزك",
  personNoun: "الزبون",
  visitorNoun: "زبون",
  visitorNounPlural: "زبائن",
  visitorPossessivePlural: "زبائنك",
  recordLabel: "سجل الخدمات",
  prescriptionNoun: "جلسة تجميل",
  noteNoun: "ملاحظات الخدمة",
  addEntryTitle: "إضافة جلسة أو ملاحظة خدمة جديدة",
  addEntryPlaceholder: "اكتب تفاصيل الجلسة أو الخدمة…",
  centerLinkLabel: "رابط المركز",
};

const BEAUTY_TERMS: Terminology = {
  ...SALON_SHARED_TERMS,
  practitionerNoun: "أخصائي التجميل",
  clinicNameLabel: "اسم مركز التجميل",
  descriptionPlaceholder: "أدخل وصف مركز التجميل",
};

const SALON_TERMS: Terminology = {
  ...SALON_SHARED_TERMS,
  practitionerNoun: "الموظف المختص",
  clinicNameLabel: "اسم المركز",
  descriptionPlaceholder: "أدخل وصف المركز",
};

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
