"use client";

// The Center Profile card — reached the instant a patient enters a
// specific center (from /find's search results or a shared booking
// link), *before* anything else: the request's own explicit "فتح شاشة
// الملف التعريفي الخاص بالمركز حصرياً". Shows every field the request
// asks for, shared fields first (name, price, bio, hours, address,
// contact), then the one conditional field that actually applies to
// this center's own entityType — a plain sub-specialty/activity-nature
// line for a clinic/"مركز تجاري آخر", or a set of service-category tags
// for a beauty center (see ClinicDoc.specialty/serviceCategories' own
// comments in types.ts for why these are mutually exclusive, never both
// shown). Every field here is owner-edited exclusively through
// ClinicSettingsTools.tsx's ProfileForm — this component only ever
// reads, never writes. Visual language: teal accents + soft light-gray
// section backgrounds + clean 1px borders, no decorative clutter, per
// the request's own explicit style direction.
//
// Its own file, not a local function inside find/book/page.tsx: a
// Next.js App Router page.tsx may only export its default page
// component (the same constraint that already forced ScheduleForm/
// SubscriptionTab out of app/clinic/page.tsx into
// components/ClinicSettingsTools.tsx), and this component needed to be
// independently mountable for its own visual verification pass anyway.
import { ENTITY_TYPE_LABEL, getTerminology } from "../lib/firebase/terminology";
import type { ClinicDoc } from "../lib/firebase/types";

export default function ClinicProfileCard({ clinic }: { clinic: ClinicDoc }) {
  const terms = getTerminology(clinic.entityType);
  const address = [clinic.gov, clinic.district, clinic.street].filter(Boolean).join(" - ");

  return (
    <div className="mt-3 mb-6 overflow-hidden rounded-2xl bg-white ring-1 ring-black/5 shadow-sm">
      <div className="p-5" style={{ backgroundColor: "#F5F8F8" }}>
        <span
          className="mb-2 inline-block rounded-full px-3 py-1 text-xs font-bold"
          style={{ backgroundColor: "#EAF6F3", color: "#00ADB5" }}
        >
          {ENTITY_TYPE_LABEL[clinic.entityType] ?? ENTITY_TYPE_LABEL.clinic}
        </span>
        <h1 className="text-xl font-extrabold" style={{ color: "#00ADB5" }}>
          {clinic.clinicName}
        </h1>
        {clinic.description && <p className="mt-1 text-sm leading-6 text-gray-600">{clinic.description}</p>}
      </div>

      <div className="space-y-4 p-5">
        {clinic.entityType === "beauty" ? (
          clinic.serviceCategories && clinic.serviceCategories.length > 0 && (
            <ProfileRow icon="✨" label="فئات الخدمات المقدمة">
              <div className="flex flex-wrap gap-2">
                {clinic.serviceCategories.map((cat) => (
                  <span
                    key={cat}
                    className="rounded-full px-2.5 py-1 text-xs font-bold"
                    style={{ backgroundColor: "#EAF6F3", color: "#00ADB5" }}
                  >
                    {cat}
                  </span>
                ))}
              </div>
            </ProfileRow>
          )
        ) : (
          <ProfileRow icon="🏷️" label={terms.specialtyLabel}>
            <span className="font-bold text-gray-800">{clinic.specialty}</span>
          </ProfileRow>
        )}

        {clinic.priceInfo && (
          <ProfileRow icon="💳" label="مبلغ الحجز أو التكلفة الأساسية">
            <span className="font-bold text-gray-800">{clinic.priceInfo}</span>
          </ProfileRow>
        )}

        <ProfileRow icon="🕒" label="أوقات العمل">
          <span className="font-bold text-gray-800">
            {clinic.workStart} – {clinic.workEnd}
          </span>
        </ProfileRow>

        {address && (
          <ProfileRow icon="📍" label="العنوان">
            <span className="font-bold text-gray-800">{address}</span>
          </ProfileRow>
        )}

        {clinic.contactPhone && (
          <ProfileRow icon="📞" label="رقم التواصل">
            <a href={`tel:${clinic.contactPhone}`} dir="ltr" className="font-bold" style={{ color: "#00ADB5" }}>
              {clinic.contactPhone}
            </a>
          </ProfileRow>
        )}
      </div>
    </div>
  );
}

/** One labeled row inside the Center Profile card — a small teal-tinted
 *  icon circle + a muted label + the value, the same icon-circle/label
 *  visual language already established elsewhere in this app (e.g. the
 *  home screen's role cards, the settings drawers' menu rows) rather than
 *  a new pattern invented just for this card. */
function ProfileRow({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden
        className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-sm"
        style={{ backgroundColor: "#EAF6F3", color: "#00ADB5" }}
      >
        {icon}
      </span>
      <div>
        <div className="text-xs text-gray-400">{label}</div>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  );
}
