"use client";

// Query-param route (?clinic=slug), same reason as /admin/user: a static
// export can't enumerate every clinic slug as a dynamic segment at build
// time. Shows today's slot grid only (matching the demo artifact's
// "today's live slot grid" - no multi-day picker) and lets an anonymous
// patient request a slot with just name + phone, via the same
// ensurePatientSession()/bookSlot() the Firebase backend has had since
// the accounts track was first built - this page is the missing UI in
// front of it.
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BackButton from "../../../components/BackButton";
import AppBackdrop from "../../../components/AppBackdrop";
import PatientGate from "../../../components/PatientGate";
import { ensurePatientSession } from "../../../lib/firebase/auth";
import { useLocalBackStep } from "../../../lib/useLocalBackStep";
import {
  bookSlot,
  getAppointmentId,
  getClinic,
  getSlotAvailability,
  isSubscriptionActive,
  SlotExpiredError,
  SlotTakenError,
} from "../../../lib/firebase/firestore";
import { filterBookableSlots, generateDaySlots, isSlotBookable } from "../../../lib/firebase/slotEngine";
import { useReliableNow } from "../../../lib/time/useReliableNow";
import { now as reliableNow } from "../../../lib/time/timeService";
import type { ClinicDoc } from "../../../lib/firebase/types";
import { getActiveBooking, getPatientProfile, saveActiveBooking, type PatientProfile } from "../../../lib/patientLocal";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function BookClinicPage() {
  return (
    <Suspense
      fallback={
        <div className="relative min-h-screen">
          <AppBackdrop />
          <p className="relative p-6 text-gray-500">جارٍ التحميل…</p>
        </div>
      }
    >
      <BookClinic />
    </Suspense>
  );
}

function BookClinic() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = searchParams.get("clinic") ?? "";
  const date = todayISO();

  // Carried over from /find's own search-results view (see that page's
  // FindClinicSearch, which appends these to this page's own link) so
  // "back" can restore the exact prior category/query state instead of
  // landing on /find's default (the category-selection screen) — the
  // literal "تفاصيل المركز -> رجوع -> نتائج البحث بنفس الحالة" example
  // from the navigation-audit request this page's own back logic below
  // was rewritten for. Absent entirely for a clinic's own shared direct
  // link (no /find visit preceded this one), which is exactly when
  // falling back to plain /find is correct anyway.
  const backCategory = searchParams.get("category") ?? "";
  const backQuery = searchParams.get("q") ?? "";
  const backToFindHref =
    "/find" +
    (backCategory
      ? `?category=${encodeURIComponent(backCategory)}${backQuery ? `&q=${encodeURIComponent(backQuery)}` : ""}`
      : "");

  const [clinic, setClinic] = useState<ClinicDoc | null | undefined>(undefined); // undefined = loading
  // "menu" = the clinic landing page (تثبيت حجز / شاشة الانتظار); "book"
  // = the existing slot-grid flow, now reached only from that menu. A
  // plain useState step like this has no history entry of its own, so a
  // real back button/gesture used to skip straight past "menu" to /find
  // even while "book" was open — see lib/useLocalBackStep.ts for why and
  // how this is fixed: entering "book" now also pushes a same-URL history
  // marker, so a real back press returns to "menu" first, matching the
  // in-page "‹ رجوع لقائمة العيادة" link's own one-step behavior exactly.
  const [view, setView] = useState<"menu" | "book">("menu");
  const { enter: enterBookView, leave: leaveBookView } = useLocalBackStep(() => setView("menu"));
  const [activeBooking, setActiveBooking] = useState<ReturnType<typeof getActiveBooking> | undefined>(undefined);
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null); // startTime of the confirmed request
  const [confirmedApptId, setConfirmedApptId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const leaveTimers = useRef<number[]>([]);
  // undefined = hasn't checked localStorage yet (avoids a flash of the
  // gate before we know a saved profile exists, same reasoning as /find).
  const [profile, setProfile] = useState<PatientProfile | null | undefined>(undefined);

  useEffect(
    () => () => {
      leaveTimers.current.forEach((t) => window.clearTimeout(t));
    },
    []
  );

  // A clinic's own shared public booking link (?clinic=slug) used to skip
  // straight to the slot grid with no account at all — now it gates on
  // the same patient identity as /find, prefilling name/phone from
  // whatever's saved (still editable, in case this booking is for
  // someone else) rather than asking again if a session is already active.
  useEffect(() => {
    const p = getPatientProfile();
    setProfile(p);
    if (p) {
      setName(p.name);
      setPhone(p.phone);
    }
    setActiveBooking(getActiveBooking());
  }, []);

  // The one live "what time is it, really?" this whole page hangs off —
  // see lib/time/useReliableNow.ts. Recomputes on mount, once per real
  // wall-clock minute, and again the instant this tab/app comes back to
  // the foreground — never a raw `new Date()`/polling loop.
  const nowMs = useReliableNow();

  // Today's full grid, narrowed to what's still bookable AT ALL right now
  // — a slot whose own start has already passed never appears here, per
  // the user's own explicit "الأفضل إخفاؤه من قائمة الاختيار" ask, not
  // merely greyed out. Booked-vs-free (a completely separate axis, see
  // `availability` below) is what actually disables one of these.
  const slots = clinic ? filterBookableSlots(clinic, date, generateDaySlots(clinic), nowMs) : [];

  const reloadAvailability = useCallback(
    async (c: ClinicDoc) => {
      setAvailabilityLoading(true);
      // Read availability only for slots that are still bookable right
      // now — an already-expired slot is hidden from the grid regardless
      // of whether it was ever booked, so checking its booked/free state
      // would just be a wasted Firestore read.
      const bookableNow = filterBookableSlots(c, date, generateDaySlots(c), reliableNow());
      const map = await getSlotAvailability(c.slug, date, bookableNow.map((s) => s.startTime));
      setAvailability(map);
      setAvailabilityLoading(false);
    },
    [date]
  );

  // Re-run the same reload on every minute tick (not just on mount) so a
  // slot that crosses from "bookable" to "expired" while this screen sits
  // open disappears on its own — no manual refresh, no full page reload,
  // matching the same minute-tick nowMs already drives for the grid
  // filter above. Also the moment `useReliableNow`'s own resync-on-resume
  // fires (backgrounding the app for 20 minutes and coming back), so a
  // stale grid from before the gap never lingers.
  useEffect(() => {
    if (clinic) reloadAvailability(clinic);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowMs, clinic?.slug]);

  // A slot the patient already picked can itself expire while they're
  // still looking at the confirm form (e.g. selected 18:30, then sat on
  // the form past 18:30) — clear the stale selection instead of letting
  // "تأكيد طلب الموعد" be pressed against a slot that's no longer valid.
  useEffect(() => {
    if (selected && clinic && !isSlotBookable(clinic, date, selected, nowMs)) {
      setSelected(null);
      setError("انتهى وقت هذا الموعد — اختر وقتاً آخر.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowMs]);

  useEffect(() => {
    if (!slug) {
      setClinic(null);
      return;
    }
    // getSlotAvailability()'s per-slot reads rely on firestore.rules' "does
    // this doc exist" clause, which requires isSignedIn() — a visitor who
    // has never booked anything yet (no anonymous session established)
    // would otherwise have every single slot check denied and misread as
    // "taken", showing a fully-booked grid that's actually just fully
    // signed-out. ensurePatientSession() is idempotent, so this is a no-op
    // for a returning visitor who already has one.
    ensurePatientSession()
      .catch(() => {})
      .then(() =>
        getClinic(slug).then((c) => {
          const live = c && c.status === "approved" && isSubscriptionActive(c);
          // Availability loads itself once `clinic` actually changes —
          // see the effect keyed on `[nowMs, clinic?.slug]` above — so
          // this doesn't also need to call reloadAvailability() directly.
          setClinic(live ? c : null);
        })
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function handleConfirm() {
    if (!clinic || !selected) return;
    if (!name.trim()) return setError("أدخل اسمك");
    if (!phone.trim()) return setError("أدخل رقم هاتفك");
    setError(null);
    setBusy(true);
    try {
      const uid = (await ensurePatientSession()).uid;
      await bookSlot({
        clinicSlug: clinic.slug,
        date,
        startTime: selected,
        patientUid: uid,
        patientName: name.trim(),
        patientPhone: phone.trim(),
      });
      const apptId = getAppointmentId(clinic.slug, date, selected);
      const waitUrl = `/find/wait?clinic=${encodeURIComponent(clinic.slug)}&appt=${encodeURIComponent(apptId)}`;
      const active = { clinicSlug: clinic.slug, clinicName: clinic.clinicName, apptId, date, startTime: selected };
      saveActiveBooking(active);
      setActiveBooking(active);
      setConfirmed(selected);
      setConfirmedApptId(apptId);
      setSelected(null);
      // Best-effort bonus: try a second window too. Some browsers (Safari
      // especially, and most in-app/PWA webviews) drop the "triggered by a
      // real click" grace period after an await, so this routinely gets
      // popup-blocked — a nice-to-have on desktop, not what this flow
      // actually depends on.
      window.open(waitUrl, "_blank", "noopener,noreferrer");
      // The reliable, guaranteed path: this same tab shows the
      // confirmation for a moment, fades out, then moves on to the
      // waiting screen itself — no popup permission, no extra click.
      leaveTimers.current.push(
        window.setTimeout(() => {
          setLeaving(true);
          leaveTimers.current.push(window.setTimeout(() => router.push(waitUrl), 320));
        }, 1400)
      );
    } catch (err) {
      if (err instanceof SlotTakenError) {
        setError("هذا الموعد حُجز للتو من شخص آخر — اختر وقتاً آخر.");
        setAvailability((prev) => ({ ...prev, [selected]: false }));
        setSelected(null);
      } else if (err instanceof SlotExpiredError) {
        // Re-validated fresh at the exact moment of confirming (see
        // bookSlot()'s own pre-check) rather than trusting whatever the
        // grid showed when the patient first tapped this slot — this is
        // the honest rejection message for that case, not a raw
        // Firestore/rules error string.
        setError("انتهى وقت هذا الموعد — اختر وقتاً آخر.");
        setSelected(null);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

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
        backHref="/"
        onDone={(p) => {
          setProfile(p);
          setName(p.name);
          setPhone(p.phone);
        }}
      />
    );
  }

  if (!slug || clinic === null) {
    return (
      <main dir="rtl" className="relative min-h-screen mx-auto max-w-md p-6 text-center">
        <AppBackdrop />
        <div className="relative">
          <p className="text-red-600">هذه العيادة غير موجودة أو غير متاحة للحجز حالياً.</p>
          <BackButton fallbackHref={backToFindHref} label="رجوع للبحث" alwaysUseFallback className="mt-4 inline-block text-brand-600 hover:underline" />
        </div>
      </main>
    );
  }

  if (clinic === undefined) {
    return (
      <div className="relative min-h-screen">
        <AppBackdrop />
        <p className="relative p-6 text-gray-500">جارٍ التحميل…</p>
      </div>
    );
  }

  return (
    <main dir="rtl" className="relative min-h-screen mx-auto max-w-2xl p-6">
      <AppBackdrop />
      <div className={"relative transition-opacity duration-300 " + (leaving ? "opacity-0" : "opacity-100")}>
      {view === "book" ? (
        // One step at a time: while the booking sub-view is open, the
        // physical corner control returns to this clinic's own menu
        // first — same destination and behavior as the in-page "‹ رجوع
        // لقائمة العيادة" link below, just reachable from the fixed
        // corner control too, and from a real back press/gesture (see
        // useLocalBackStep).
        <BackButton label="رجوع" overrideOnClick={leaveBookView} />
      ) : (
        <BackButton fallbackHref={backToFindHref} label="رجوع للبحث" alwaysUseFallback />
      )}

      <h1 className="mt-3 text-xl font-bold" style={{ color: "#00ADB5" }}>
        {clinic.clinicName}
      </h1>
      <p className="mb-6 text-sm text-gray-500">
        {clinic.specialty} · {clinic.doctorName}
        {clinic.gov && ` · ${clinic.gov}${clinic.district ? " - " + clinic.district : ""}`}
      </p>

      {view === "menu" && (
        <ClinicMenu
          clinic={clinic}
          activeBooking={activeBooking}
          onBook={() => {
            enterBookView();
            setView("book");
          }}
          onWait={(waitUrl) => router.push(waitUrl)}
        />
      )}

      {view === "book" && (
        <>
          <button
            type="button"
            onClick={leaveBookView}
            className="mb-4 block text-sm text-brand-600 hover:underline"
          >
            ‹ رجوع لقائمة العيادة
          </button>

          {confirmed && (
            <div className="mb-6 space-y-3 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800">
              <p>تم إرسال طلبك للموعد الساعة {confirmed} — بانتظار تأكيد العيادة.</p>
              <p className="text-sm text-green-700">جارٍ الانتقال إلى شاشة الانتظار…</p>
              {confirmedApptId && (
                <button
                  onClick={() =>
                    router.push(
                      `/find/wait?clinic=${encodeURIComponent(clinic.slug)}&appt=${encodeURIComponent(confirmedApptId)}`
                    )
                  }
                  className="inline-block rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700"
                >
                  الانتقال الآن
                </button>
              )}
            </div>
          )}

          <h2 className="mb-3 font-bold">مواعيد اليوم المتاحة</h2>
          {availabilityLoading && <p className="text-gray-500">جارٍ تحميل الأوقات…</p>}
          {!availabilityLoading && slots.length === 0 && (
            <p className="text-gray-400">لا توجد مواعيد متاحة اليوم.</p>
          )}

          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {slots.map((s) => {
              const free = availability[s.startTime] ?? false;
              const isSelected = selected === s.startTime;
              return (
                <button
                  key={s.startTime}
                  disabled={!free || availabilityLoading}
                  onClick={() => {
                    setSelected(s.startTime);
                    setConfirmed(null);
                    setError(null);
                  }}
                  className={
                    "rounded-lg border px-2 py-2 text-sm " +
                    (isSelected
                      ? "border-brand-600 bg-brand-500 text-white"
                      : free
                        ? "border-brand-200 bg-white text-brand-700 hover:bg-brand-50"
                        : "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400 line-through")
                  }
                >
                  {s.startTime}
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="mt-6 space-y-3 rounded-xl border bg-white p-4">
              <div className="font-bold">تأكيد الحجز — {selected}</div>
              <label className="block text-sm">
                الاسم
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                رقم الهاتف
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  dir="ltr"
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                />
              </label>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                onClick={handleConfirm}
                disabled={busy}
                className="w-full rounded-lg bg-brand-500 px-4 py-2 text-white hover:bg-brand-600 disabled:opacity-50"
              >
                {busy ? "جارٍ الإرسال…" : "تأكيد طلب الموعد"}
              </button>
            </div>
          )}
        </>
      )}
      </div>
    </main>
  );
}

/** The clinic's own landing menu — reached the moment a patient enters a
 *  specific clinic (from /find's search results or a shared booking
 *  link), before anything else: two clear entry points, "تثبيت حجز" (the
 *  existing slot-grid booking flow, unchanged, now one step behind this
 *  menu instead of the immediate first thing shown) and "شاشة الانتظار"
 *  (the patient's live queue screen for THIS clinic specifically — only
 *  enabled when the local ActiveBooking pointer actually points at a
 *  booking with this same clinic, so it can't offer a queue screen for a
 *  booking that doesn't exist here). */
function ClinicMenu({
  clinic,
  activeBooking,
  onBook,
  onWait,
}: {
  clinic: ClinicDoc;
  activeBooking: ReturnType<typeof getActiveBooking> | undefined;
  onBook: () => void;
  onWait: (waitUrl: string) => void;
}) {
  const hasActiveBookingHere = !!activeBooking && activeBooking.clinicSlug === clinic.slug;
  const waitUrl = hasActiveBookingHere
    ? `/find/wait?clinic=${encodeURIComponent(clinic.slug)}&appt=${encodeURIComponent(activeBooking!.apptId)}`
    : "";

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBook}
        className="w-full rounded-xl bg-brand-500 px-4 py-4 text-right text-lg font-bold text-white hover:bg-brand-600"
      >
        تثبيت حجز
        <div className="text-sm font-normal text-white/80">اختر موعداً اليوم وأدخل بياناتك</div>
      </button>

      <button
        type="button"
        disabled={!hasActiveBookingHere}
        onClick={() => hasActiveBookingHere && onWait(waitUrl)}
        className={
          "w-full rounded-xl border-2 px-4 py-4 text-right text-lg font-bold " +
          (hasActiveBookingHere
            ? "border-brand-500 text-brand-700 hover:bg-brand-50"
            : "cursor-not-allowed border-gray-200 text-gray-300")
        }
        style={hasActiveBookingHere ? { borderColor: "#00ADB5", color: "#00ADB5" } : undefined}
      >
        شاشة الانتظار
        <div className={"text-sm font-normal " + (hasActiveBookingHere ? "text-brand-600/80" : "text-gray-300")}>
          {hasActiveBookingHere ? "تابع دورك وحالة موعدك مباشرة" : "لا يوجد حجز نشط لديك في هذه العيادة اليوم"}
        </div>
      </button>
    </div>
  );
}
