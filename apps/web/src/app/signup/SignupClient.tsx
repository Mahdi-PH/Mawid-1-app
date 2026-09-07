"use client";

// Unified entry point: one email field decides everything. Enter the
// configured admin address (see lib/firebase/auth.ts
// isConfiguredAdminEmail) and this becomes a plain sign-in; enter anything
// else and it becomes a new clinic/beauty-center signup, license upload
// included, landing in the admin dashboard's pending-approval queue. There
// is deliberately no separate "admin registration" flow anywhere — the one
// real admin account only ever comes from scripts/seed-admin.mjs.
//
// Center-type selection now happens on its own step BEFORE this form
// appears at all — Home's "إدارة المراكز" card still points straight at
// this same route, but this component's own default view is now the type
// grid (EntityTypeGrid, the exact same shared component /find's own
// service-category filter uses — see that file's own comment on why this
// is one component, not two drifting copies). Only after a type is picked
// does the actual account-creation form render, already knowing the type
// — the old in-form three-button selector is gone; nothing asks twice.
// A returning owner (or the admin) skips the type step entirely via the
// "لديك حساب بالفعل؟" link, or via the `?mode=login` query param a
// signed-out session redirect (admin/clinic layouts, /admin/login) now
// appends so an expired session lands straight back on a login-ready
// form, not an irrelevant type picker.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isConfiguredAdminEmail, signInWithEmail } from "../../lib/firebase/auth";
import { registerClinic, SlugTakenError } from "../../lib/firebase/firestore";
import { ENTITY_TYPE_LABEL, getTerminology } from "../../lib/firebase/terminology";
import type { EntityType } from "../../lib/firebase/types";
import { saveSignupAccountPdf } from "../../lib/pdf/saveAccountPdf";
import EntityTypeGrid from "../../components/EntityTypeGrid";
import BackButton from "../../components/BackButton";
import AppBackdrop from "../../components/AppBackdrop";
import { useLocalBackStep } from "../../lib/useLocalBackStep";

// Sanity cap on the raw upload before client-side compression kicks in
// (see registerClinic() -> compressLicenseImageToDataUrl()), not the
// final stored size — a huge original just takes longer to decode/resize.
const MAX_LICENSE_UPLOAD_BYTES = 15 * 1024 * 1024;

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export default function SignupClient() {
  const router = useRouter();
  // "type" (the new entry step — pick a center type, reusing /find's own
  // EntityTypeGrid) or "form" (the actual account-creation/login form).
  // Defaults to "type" — the correct state to prerender for the common
  // case (a fresh visitor from Home's "إدارة المراكز" card or /subscribe's
  // "ابدأ مجاناً"), matching this project's own established rule of never
  // defaulting to a state that then flashes into the right one (see
  // app/page.tsx's own "phase defaults to home, not null" fix in
  // CLAUDE.md). The one exception — a signed-out session redirect that
  // needs the login form directly, not this type step — is handled below
  // via a pre-paint effect, not a different default.
  const [view, setView] = useState<"type" | "form">("type");
  const decidedInitialView = useRef(false);
  // See lib/useLocalBackStep.ts: picking a type (or the "لديك حساب
  // بالفعل؟" login link) from the "type" screen is a plain useState step
  // with no history entry of its own, so a real back press/gesture used
  // to skip straight past "type" to whatever preceded /signup entirely
  // (e.g. Home). Entering "form" now also pushes a same-URL history
  // marker, so a real back returns to "type" first — the exact same one
  // step the in-page "‹ رجوع لاختيار نوع المركز" link already performs,
  // and (via the physical BackButton's own existing router.back() smart
  // default on the login/admin branch) the same step that control now
  // gets too, with no changes to it at all. The `?mode=login` bypass
  // below deliberately never calls enter() — there's no "type" screen in
  // that visitor's own flow to return to, so a real back correctly keeps
  // leaving /signup entirely.
  const { enter: enterFormView, leave: leaveFormView } = useLocalBackStep(() => setView("type"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [clinicName, setClinicName] = useState("");
  const [description, setDescription] = useState("");
  // Required, no default — "Dynamic Entity Specialization" still needs
  // every new account to make this choice explicitly, since it's what
  // every later terminology swap (see lib/firebase/terminology.ts) keys
  // off — it's just chosen one step earlier now, on its own screen,
  // before this form ever renders.
  const [entityType, setEntityType] = useState<EntityType | "">("");
  const [gov, setGov] = useState("");
  const [district, setDistrict] = useState("");
  const [street, setStreet] = useState("");
  const [workStart, setWorkStart] = useState("09:00");
  const [workEnd, setWorkEnd] = useState("17:00");
  const [slotMin, setSlotMin] = useState<5 | 10 | 15 | 20>(15);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // "signup" (new clinic) vs "login" (returning owner, /clinic dashboard)
  // — there was no way back into an existing account before this: the
  // form only ever tried registerClinic(), which fails with
  // auth/email-already-in-use for a returning owner and left them stuck.
  const [clinicMode, setClinicMode] = useState<"signup" | "login">("signup");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Same `?query=` pre-paint-bypass technique app/page.tsx already
  // established for `?intro=1` — reads window.location.search directly
  // (not useSearchParams(), so no <Suspense> boundary is needed just for
  // this) inside a pre-paint effect guarded by a ref so it only ever
  // runs once. admin/layout.tsx, clinic/layout.tsx, and /admin/login now
  // append `?mode=login` when redirecting a signed-out session back here
  // — that visitor already had (or was trying to reach) an existing
  // account, so they need the login-ready form immediately, not an
  // irrelevant "which type of center is this" question a signup-only
  // step exists to ask.
  useLayoutEffect(() => {
    if (decidedInitialView.current) return;
    decidedInitialView.current = true;
    if (typeof window !== "undefined" && window.location.search.includes("mode=login")) {
      setClinicMode("login");
      setView("form");
    }
  }, []);

  const isAdminEmail = useMemo(() => isConfiguredAdminEmail(email), [email]);
  const isClinicLogin = !isAdminEmail && clinicMode === "login";
  // The free-plan subscription info shown only while actually creating a
  // new account — a returning owner (login mode) or the admin sign-in
  // don't need "أول شهر مجاناً" repeated at them. Per the user's explicit
  // ask, this is now merged into the top of this same card instead of a
  // separate /subscribe screen before it; the payment-account number moved
  // the other direction, into /clinic's own "خطة الاشتراك" tab, since it's
  // only useful after the account exists and is signed in.
  const showPlanInfo = !isAdminEmail && !isClinicLogin;

  async function handleAdminSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signInWithEmail(email, password);
      router.push("/admin");
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      setError(
        code.startsWith("auth/")
          ? "بيانات الدخول غير صحيحة."
          : `تعذّر تسجيل الدخول: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleClinicLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signInWithEmail(email, password);
      router.push("/clinic");
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      setError(
        code.startsWith("auth/")
          ? "بيانات الدخول غير صحيحة."
          : `تعذّر تسجيل الدخول: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleClinicSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!entityType) {
      // Shouldn't be reachable through the real UI flow (the form only
      // ever renders once a type is picked), but defensively sends the
      // visitor back to that step rather than showing a dead-end error
      // for a field this screen no longer has any control for — covers
      // the request's own explicit "لم يختر أي نوع، لا تسمح له بالانتقال"
      // case.
      setView("type");
      return setError("يرجى اختيار نوع المركز أولاً");
    }
    const terms = getTerminology(entityType);
    if (!clinicName.trim()) return setError(`أدخل ${terms.clinicNameLabel}`);
    if (!/^[^\s@]+@gmail\.com$/i.test(email.trim())) return setError("أدخل عنوان Gmail صحيحاً (example@gmail.com)");
    if (password.length < 8) return setError("كلمة المرور 8 أحرف على الأقل");
    if (password !== password2) return setError("كلمتا المرور غير متطابقتين");
    if (!licenseFile) return setError("ارفع صورة الإجازة الرسمية للعيادة أو مركز التجميل");
    if (!licenseFile.type.startsWith("image/")) return setError("صورة الإجازة يجب أن تكون ملف صورة");
    if (licenseFile.size > MAX_LICENSE_UPLOAD_BYTES) return setError("حجم صورة الإجازة يجب ألا يتجاوز 15 ميجابايت");
    if (gov.trim() && !district.trim()) return setError("اكتب اسم الحي، أو اترك المحافظة فارغة");
    if (!workStart || !workEnd) return setError("حدّد بداية الدوام ونهايته");
    if (toMinutes(workEnd) - toMinutes(workStart) < slotMin) {
      return setError("ساعات الدوام يجب أن تتسع لموعد واحد على الأقل بالمدة المختارة");
    }

    setBusy(true);
    try {
      const { slug } = await registerClinic({
        email: email.trim(),
        password,
        clinicName: clinicName.trim(),
        entityType,
        description: description.trim() || null,
        licenseImageFile: licenseFile,
        gov: gov.trim() || null,
        district: gov.trim() ? district.trim() : null,
        street: street.trim() || null,
        workStart,
        workEnd,
        slotMin,
      });
      // Auto-save a local PDF backup of exactly what was submitted, right
      // after the account is created — a professional safeguard against
      // losing this data, per the user's explicit ask. Best-effort: a
      // failure here (e.g. a browser blocking the download) must never
      // block the signup itself, which already succeeded.
      try {
        await saveSignupAccountPdf({
          clinicName: clinicName.trim(),
          email: email.trim(),
          description: description.trim() || null,
          gov: gov.trim() || null,
          district: gov.trim() ? district.trim() : null,
          street: street.trim() || null,
          workStart,
          workEnd,
          slotMin,
          bookingSlug: slug,
        });
      } catch (pdfErr) {
        console.error("saveSignupAccountPdf failed (non-fatal):", pdfErr);
      }
      router.push(`/subscribe?registered=1&slug=${encodeURIComponent(slug)}&name=${encodeURIComponent(clinicName.trim())}`);
    } catch (err) {
      if (err instanceof SlugTakenError) {
        setError("تعذّر إنشاء رابط حجز فريد لهذا البريد — حاول مرة أخرى.");
      } else {
        const code = (err as { code?: string })?.code ?? "";
        setError(
          code === "auth/email-already-in-use"
            ? "هذا البريد مسجَّل بالفعل — إذا كان حسابك، سجّل الدخول بدلاً من إنشاء حساب جديد."
            : `تعذّر إنشاء الحساب: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    } finally {
      setBusy(false);
    }
  }

  // The signup-only fields (name/description/license/etc.) key their own
  // dynamic labels off whichever type was picked on the "type" step —
  // getTerminology() already falls back to "clinic" wording for a null/
  // empty value, so this stays safe even before a type is chosen.
  const terms = useMemo(() => getTerminology(entityType || null), [entityType]);

  if (view === "type") {
    return (
      <div dir="rtl" className="relative flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <AppBackdrop />
        <div className="relative w-full max-w-sm rounded-xl border bg-white p-6 shadow-sm">
          <BackButton fallbackHref="/" className="mb-3 block text-sm text-brand-600 hover:underline" />

          <h1 className="mb-1 text-lg font-bold text-brand-700">إدارة المراكز</h1>
          <p className="mb-4 text-sm text-gray-500">اختر نوع مركزك للمتابعة إلى إنشاء الحساب.</p>

          <EntityTypeGrid
            onSelect={(t) => {
              enterFormView();
              setEntityType(t);
              // Defensive reset: a visitor who once toggled to "login"
              // mode (see the toggle inside the form below), then came
              // back here and picked a type, clearly wants a fresh
              // signup for that type — not to have the form silently
              // stay in login mode (which would hide the clinicName/
              // description fields and submit as a sign-in attempt,
              // ignoring the type they just picked).
              setClinicMode("signup");
              setError(null);
              setView("form");
            }}
          />

          <button
            type="button"
            onClick={() => {
              enterFormView();
              setClinicMode("login");
              setError(null);
              setView("form");
            }}
            className="mt-5 block w-full text-center text-sm text-brand-600 hover:underline"
          >
            لديك حساب بالفعل؟ سجّل الدخول
          </button>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="relative flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <AppBackdrop />
      <form
        onSubmit={isAdminEmail ? handleAdminSubmit : isClinicLogin ? handleClinicLogin : handleClinicSubmit}
        className="relative w-full max-w-sm rounded-xl border bg-white p-6 shadow-sm"
      >
        {!isAdminEmail && clinicMode === "signup" ? (
          // Fresh signup, type already chosen on the previous step — "back"
          // here returns to that step (an in-page state change, matching
          // /find/book's own "‹ رجوع لقائمة العيادة" pattern), not literally
          // out of the flow.
          <button
            type="button"
            onClick={() => {
              leaveFormView();
              setError(null);
            }}
            className="mb-3 block text-sm text-brand-600 hover:underline"
          >
            ‹ رجوع لاختيار نوع المركز
          </button>
        ) : (
          <BackButton fallbackHref="/" className="mb-3 block text-sm text-brand-600 hover:underline" />
        )}

        {showPlanInfo && (
          <div className="mb-4 rounded-xl border-2 bg-brand-50/40 p-4" style={{ borderColor: "#00ADB5" }}>
            <div className="mb-1 text-sm font-bold" style={{ color: "#00ADB5" }}>
              أول شهر مجاناً
            </div>
            <p className="text-xs leading-6 text-gray-600">
              إدارة كاملة للحجوزات، الاستقبال، وشاشة صالة الانتظار — بلا أي رسوم خلال الشهر الأول. السعر بعد
              الشهر الأول <span className="font-bold">لم يُحدَّد بعد</span> وسيُعلن لاحقاً.
            </p>
          </div>
        )}

        {showPlanInfo ? (
          <>
            <h1 className="mb-1 text-lg font-bold text-brand-700">إنشاء حساب جديد</h1>
            <p className="mb-4 text-sm text-gray-500">
              النوع المختار: <span className="font-bold" style={{ color: "#00ADB5" }}>{ENTITY_TYPE_LABEL[entityType as EntityType]}</span>
            </p>
          </>
        ) : (
          <>
            <h1 className="mb-1 text-lg font-bold text-brand-700">إدارة المراكز (عيادات، مراكز تجميل ومراكز أخرى)</h1>
            <p className="mb-4 text-sm text-gray-500">سجّل دخولك إذا كان حسابك موجوداً.</p>
          </>
        )}

        {!isAdminEmail && (
          <button
            type="button"
            onClick={() => {
              if (clinicMode === "signup") {
                // Leaving signup mode from here has no type-selection step
                // behind it to return to — treat it the same as arriving
                // via the login link on the "type" screen.
                setClinicMode("login");
              } else {
                // Same one step as the "‹ رجوع لاختيار نوع المركز" link —
                // this toggle is just a second door to it, so it goes
                // through the identical leave() path (pops this view's
                // own history marker rather than only resetting React
                // state), keeping the browser's back stack honest either
                // way this step is left.
                setClinicMode("signup");
                leaveFormView();
              }
              setError(null);
            }}
            className="mb-4 text-sm text-brand-600 hover:underline"
          >
            {clinicMode === "signup" ? "لديك حساب بالفعل؟ سجّل الدخول" : "ليس لديك حساب؟ أنشئ حساباً جديداً"}
          </button>
        )}

        <label className="mb-3 block text-sm">
          Gmail
          <input
            type="email"
            required
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="clinic@gmail.com"
            className="mt-1 w-full rounded-lg border px-3 py-2"
          />
        </label>

        {!isAdminEmail && !isClinicLogin && (
          <label className="mb-3 block text-sm">
            {terms.clinicNameLabel}
            <input
              type="text"
              value={clinicName}
              onChange={(e) => setClinicName(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2"
            />
          </label>
        )}

        {!isAdminEmail && !isClinicLogin && (
          <label className="mb-4 block text-sm">
            الوصف
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={terms.descriptionPlaceholder}
              rows={3}
              className="mt-1 w-full rounded-lg border px-3 py-2"
            />
          </label>
        )}

        <label className="mb-3 block text-sm">
          كلمة المرور
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2"
          />
        </label>

        {!isAdminEmail && !isClinicLogin && (
          <>
            <label className="mb-3 block text-sm">
              تأكيد كلمة المرور
              <input
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2"
              />
            </label>

            <label className="mb-4 block text-sm">
              صورة الإجازة الرسمية
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => setLicenseFile(e.target.files?.[0] ?? null)}
                className="mt-1 w-full text-sm"
              />
              <span className="mt-1 block text-xs text-gray-400">
                تُستخدم فقط للمراجعة من قبل الإدارة قبل تفعيل الحساب.
              </span>
            </label>

            <div className="mb-3 grid grid-cols-2 gap-3">
              <label className="block text-sm">
                المحافظة (اختياري)
                <input
                  type="text"
                  value={gov}
                  onChange={(e) => setGov(e.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                الحي
                <input
                  type="text"
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                />
              </label>
            </div>
            <label className="mb-3 block text-sm">
              الشارع (اختياري)
              <input
                type="text"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2"
              />
            </label>
            <p className="mb-4 -mt-2 text-xs text-gray-400">
              كتابة المحافظة والحي تجعل عيادتك قابلة للبحث من صفحة «البحث عن خدمة أو حجز موعد» أيضاً، وليس فقط عبر
              رابطك المباشر —
              بعد موافقة الإدارة.
            </p>

            <div className="mb-3 grid grid-cols-2 gap-3">
              <label className="block text-sm">
                بداية الدوام
                <input
                  type="time"
                  value={workStart}
                  onChange={(e) => setWorkStart(e.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                نهاية الدوام
                <input
                  type="time"
                  value={workEnd}
                  onChange={(e) => setWorkEnd(e.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                />
              </label>
            </div>
            <label className="mb-4 block text-sm">
              مدة الموعد الواحد
              <select
                value={slotMin}
                onChange={(e) => setSlotMin(Number(e.target.value) as 5 | 10 | 15 | 20)}
                className="mt-1 w-full rounded-lg border px-3 py-2"
              >
                <option value={5}>5 دقائق</option>
                <option value={10}>10 دقائق</option>
                <option value={15}>15 دقيقة</option>
                <option value={20}>20 دقيقة</option>
              </select>
            </label>
          </>
        )}

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-brand-600 py-2 font-bold text-white disabled:opacity-60"
        >
          {busy ? "…" : isAdminEmail || isClinicLogin ? "دخول" : "إنشاء الحساب"}
        </button>
      </form>
    </div>
  );
}
