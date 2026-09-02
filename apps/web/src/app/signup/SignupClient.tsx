"use client";

// Unified entry point: one email field decides everything. Enter the
// configured admin address (see lib/firebase/auth.ts
// isConfiguredAdminEmail) and this becomes a plain sign-in; enter anything
// else and it becomes a new clinic/beauty-center signup, license upload
// included, landing in the admin dashboard's pending-approval queue. There
// is deliberately no separate "admin registration" flow anywhere — the one
// real admin account only ever comes from scripts/seed-admin.mjs.
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isConfiguredAdminEmail, signInWithEmail } from "../../lib/firebase/auth";
import { registerClinic, SlugTakenError } from "../../lib/firebase/firestore";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [clinicName, setClinicName] = useState("");
  const [gov, setGov] = useState("");
  const [district, setDistrict] = useState("");
  const [street, setStreet] = useState("");
  const [workStart, setWorkStart] = useState("09:00");
  const [workEnd, setWorkEnd] = useState("17:00");
  const [slotMin, setSlotMin] = useState<5 | 10 | 15 | 20>(15);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingSubmitted, setPendingSubmitted] = useState(false);
  // "signup" (new clinic) vs "login" (returning owner, /clinic dashboard)
  // — there was no way back into an existing account before this: the
  // form only ever tried registerClinic(), which fails with
  // auth/email-already-in-use for a returning owner and left them stuck.
  const [clinicMode, setClinicMode] = useState<"signup" | "login">("signup");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdminEmail = useMemo(() => isConfiguredAdminEmail(email), [email]);
  const isClinicLogin = !isAdminEmail && clinicMode === "login";

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

    if (!clinicName.trim()) return setError("أدخل اسم العيادة أو مركز التجميل");
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
      await registerClinic({
        email: email.trim(),
        password,
        clinicName: clinicName.trim(),
        licenseImageFile: licenseFile,
        gov: gov.trim() || null,
        district: gov.trim() ? district.trim() : null,
        street: street.trim() || null,
        workStart,
        workEnd,
        slotMin,
      });
      setPendingSubmitted(true);
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

  if (pendingSubmitted) {
    return (
      <div dir="rtl" className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-sm rounded-xl border bg-white p-6 text-center shadow-sm">
          <h1 className="mb-2 text-lg font-bold text-brand-700">تم إرسال طلبك</h1>
          <p className="text-sm text-gray-600">
            طلب تسجيل &quot;{clinicName}&quot; قيد المراجعة من قبل الإدارة، وسيتم تفعيل حسابك بعد الموافقة على
            الإجازة المرفوعة.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <form
        onSubmit={isAdminEmail ? handleAdminSubmit : isClinicLogin ? handleClinicLogin : handleClinicSubmit}
        className="w-full max-w-sm rounded-xl border bg-white p-6 shadow-sm"
      >
        <h1 className="mb-1 text-lg font-bold text-brand-700">عيادة أو مركز تجميل</h1>
        <p className="mb-4 text-sm text-gray-500">أنشئ حساباً جديداً، أو سجّل دخولك إذا كان حسابك موجوداً.</p>

        {!isAdminEmail && (
          <button
            type="button"
            onClick={() => {
              setClinicMode(clinicMode === "signup" ? "login" : "signup");
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
            اسم العيادة أو مركز التجميل
            <input
              type="text"
              value={clinicName}
              onChange={(e) => setClinicName(e.target.value)}
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
              كتابة المحافظة والحي تجعل عيادتك قابلة للبحث من صفحة «مراجع» أيضاً، وليس فقط عبر رابطك المباشر —
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
