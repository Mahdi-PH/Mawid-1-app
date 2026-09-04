"use client";

// Public patient directory - no login, ever (see lib/firebase/auth.ts
// ensurePatientSession(), only called once a visitor actually books).
// Lists only clinics/{slug}.status === "approved" (listApprovedClinics())
// so a still-pending or rejected signup stays invisible here exactly like
// the demo artifact's directoryClinics(), just against real Firestore data
// instead of localStorage. Search matches clinic name + governorate/
// district text, same fields the demo's single search box matches - no
// GPS, per the same product decision already made for the artifact.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { listApprovedClinics } from "../../lib/firebase/firestore";
import type { ClinicDoc } from "../../lib/firebase/types";
import BackButton from "../../components/BackButton";
import AppBackdrop from "../../components/AppBackdrop";
import PatientAccountBar from "../../components/PatientAccountBar";
import PatientGate from "../../components/PatientGate";
import {
  getActiveBooking,
  getPatientProfile,
  type ActiveBooking,
  type PatientProfile,
} from "../../lib/patientLocal";

export default function FindClinicPage() {
  // undefined = hasn't checked localStorage yet (avoids a flash of the
  // gate before we know a saved profile exists, same reasoning as the
  // home screen's own localStorage-gated splash check).
  const [profile, setProfile] = useState<PatientProfile | null | undefined>(undefined);
  const [activeBooking, setActiveBooking] = useState<ActiveBooking | null>(null);

  useEffect(() => {
    setProfile(getPatientProfile());
    setActiveBooking(getActiveBooking());
  }, []);

  if (profile === undefined) {
    return (
      <div className="relative min-h-screen">
        <AppBackdrop />
      </div>
    );
  }

  if (profile === null) {
    return (
      <PatientGate
        onDone={(p) => {
          setProfile(p);
          setActiveBooking(getActiveBooking());
        }}
      />
    );
  }

  return (
    <FindClinicSearch profile={profile} activeBooking={activeBooking} />
  );
}

function FindClinicSearch({
  profile,
  activeBooking,
}: {
  profile: PatientProfile;
  activeBooking: ActiveBooking | null;
}) {
  const [clinics, setClinics] = useState<ClinicDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    listApprovedClinics()
      .then(setClinics)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim();
    if (!needle) return clinics;
    return clinics.filter((c) => {
      const haystack = `${c.clinicName} - ${c.district ?? ""} ${c.gov ?? ""}`;
      return haystack.includes(needle);
    });
  }, [clinics, q]);

  return (
    <main dir="rtl" className="relative min-h-screen mx-auto max-w-2xl p-6">
      <AppBackdrop />
      <div className="relative">
      <BackButton fallbackHref="/" className="mb-3 block text-sm text-brand-600 hover:underline" />

      <PatientAccountBar profile={profile} />

      {activeBooking && (
        <Link
          href={`/find/wait?clinic=${encodeURIComponent(activeBooking.clinicSlug)}&appt=${encodeURIComponent(activeBooking.apptId)}`}
          className="mb-6 block rounded-xl border-2 p-4 transition hover:-translate-y-0.5"
          style={{ borderColor: "#0F7A6C", background: "#EEF7F6" }}
        >
          <div className="text-sm text-gray-500">موعدك الحالي</div>
          <div className="font-bold" style={{ color: "#0F7A6C" }}>
            {activeBooking.clinicName} — {activeBooking.startTime}
          </div>
          <div className="mt-1 text-xs text-brand-600">فتح شاشة الانتظار ‹</div>
        </Link>
      )}

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: "#0F7A6C" }}>
          ابحث عن مركزك
        </h1>
        <Link href="/find/requests" className="text-sm text-brand-600 hover:underline">
          طلباتي
        </Link>
      </div>

      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ابحث باسم العيادة أو الحي"
        className="mb-6 w-full rounded-lg border px-3 py-2"
      />

      {loading && <p className="text-gray-500">جارٍ التحميل…</p>}
      {error && <p className="text-red-600">{error}</p>}

      {!loading && !error && filtered.length === 0 && (
        <p className="text-gray-400">لا توجد عيادة مطابقة.</p>
      )}

      <div className="space-y-3">
        {filtered.map((c) => (
          <Link
            key={c.slug}
            href={`/find/book?clinic=${encodeURIComponent(c.slug)}`}
            className="block rounded-xl border bg-white p-4 shadow-sm transition hover:-translate-y-0.5"
          >
            <div className="font-bold">{c.clinicName}</div>
            <div className="text-sm text-gray-500">
              {c.specialty} · {c.doctorName}
              {c.gov && ` · ${c.gov}${c.district ? " - " + c.district : ""}`}
            </div>
          </Link>
        ))}
      </div>
      </div>
    </main>
  );
}
