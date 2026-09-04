"use client";

// The patient's own side of the "Universal Patient Passport" QR-code
// medical archive: a lightweight text-only medical record (see
// lib/firebase/types.ts for the schema and its disclosed scope — no file
// uploads yet, and Patient_ID is the existing unverified anonymous-auth
// identity, not a phone-verified one; both were explicit, confirmed
// scoping decisions, not oversights) plus the QR code that lets a clinic
// request temporary, patient-approved read access to it in person.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import BackButton from "../../../components/BackButton";
import AppBackdrop from "../../../components/AppBackdrop";
import PatientAccountBar from "../../../components/PatientAccountBar";
import PatientGate from "../../../components/PatientGate";
import { ensurePatientSession } from "../../../lib/firebase/auth";
import {
  ACCESS_GRANT_MINUTES,
  addRecordEntrySelf,
  approveAccessRequest,
  createAccessRequest,
  denyAccessRequest,
  getOrCreatePatientRecord,
  isGrantActive,
  listGrantsForPatient,
  revokeAccessGrant,
  watchAccessRequest,
  watchRecordEntries,
} from "../../../lib/firebase/passport";
import { encodeQrPayload } from "../../../lib/qrPassport";
import type { AccessGrantDoc, AccessRequestDoc, PatientRecordDoc, RecordEntryDoc, RecordEntryType } from "../../../lib/firebase/types";
import { getPatientProfile, type PatientProfile } from "../../../lib/patientLocal";

export default function PatientPassportPage() {
  const [profile, setProfile] = useState<PatientProfile | null | undefined>(undefined);

  useEffect(() => {
    setProfile(getPatientProfile());
  }, []);

  if (profile === undefined) {
    return (
      <div className="relative min-h-screen">
        <AppBackdrop />
      </div>
    );
  }

  if (profile === null) {
    return <PatientGate backHref="/find" onDone={(p) => setProfile(p)} />;
  }

  return <Passport profile={profile} />;
}

function Passport({ profile }: { profile: PatientProfile }) {
  const [uid, setUid] = useState<string | null>(null);
  const [record, setRecord] = useState<PatientRecordDoc | null>(null);
  const [entries, setEntries] = useState<RecordEntryDoc[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensurePatientSession()
      .then((u) => setUid(u.uid))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (!uid) return;
    getOrCreatePatientRecord(uid, profile.name)
      .then(setRecord)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return watchRecordEntries(uid, setEntries);
  }, [uid, profile.name]);

  if (error) {
    return (
      <main dir="rtl" className="relative min-h-screen mx-auto max-w-md p-6">
        <AppBackdrop />
        <div className="relative">
          <BackButton fallbackHref="/find" className="mb-3 block text-sm text-brand-600 hover:underline" />
          <p className="text-red-600">{error}</p>
        </div>
      </main>
    );
  }

  if (!uid || !record) {
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
      <div className="relative">
        <BackButton fallbackHref="/find" className="mb-3 block text-sm text-brand-600 hover:underline" />
        <PatientAccountBar profile={profile} />

        <h1 className="mb-1 text-xl font-bold" style={{ color: "#0F7A6C" }}>
          بطاقة المراجع الصحية
        </h1>
        <p className="mb-6 text-sm text-gray-500">
          سجلّك الطبي الموحّد — أظهر رمز QR للطبيب في عيادته لمنحه إذناً مؤقتاً بقراءة سجلّك وإضافة وصفة أو تقرير جديد.
        </p>

        <QrPanel patientId={uid} />
        <GrantsPanel patientId={uid} />
        <RecordPanel entries={entries} onAddSelf={(type, text) => addRecordEntrySelf(uid, type, text)} />
      </div>
    </main>
  );
}

type QrState = "idle" | "showing" | "claimed" | "approved" | "denied" | "expired";

function QrPanel({ patientId }: { patientId: string }) {
  const [state, setState] = useState<QrState>("idle");
  const [req, setReq] = useState<AccessRequestDoc | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => () => unsubscribeRef.current?.(), []);

  useEffect(() => {
    if (!req || state !== "showing") return;
    const tick = () => setSecondsLeft(Math.max(0, Math.round((req.expiresAt.toMillis() - Date.now()) / 1000)));
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [req, state]);

  useEffect(() => {
    if (state === "showing" && secondsLeft === 0) setState("expired");
  }, [state, secondsLeft]);

  async function handleShowQr() {
    setError(null);
    setBusy(true);
    try {
      unsubscribeRef.current?.();
      const created = await createAccessRequest(patientId);
      setReq(created);
      const payload = encodeQrPayload({
        kind: "mawid_patient_passport",
        patientId,
        requestId: created.id,
        exp: created.expiresAt.toMillis(),
      });
      setQrImage(await QRCode.toDataURL(payload, { width: 260, margin: 1 }));
      setState("showing");
      unsubscribeRef.current = watchAccessRequest(created.id, (updated) => {
        if (!updated) return;
        setReq(updated);
        if (updated.status === "claimed") setState("claimed");
        if (updated.status === "approved") setState("approved");
        if (updated.status === "denied") setState("denied");
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    if (!req) return;
    setBusy(true);
    try {
      await approveAccessRequest(req);
      setState("approved");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeny() {
    if (!req) return;
    setBusy(true);
    try {
      await denyAccessRequest(req.id);
      setState("denied");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    unsubscribeRef.current?.();
    setReq(null);
    setQrImage(null);
    setState("idle");
  }

  return (
    <div className="mb-6 rounded-2xl border-2 bg-white p-6 text-center" style={{ borderColor: "#0F7A6C" }}>
      {state === "idle" && (
        <button
          onClick={handleShowQr}
          disabled={busy}
          className="w-full rounded-lg bg-brand-500 px-4 py-3 font-bold text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {busy ? "جارٍ التحضير…" : "إظهار رمز الدخول للطبيب"}
        </button>
      )}

      {state === "showing" && qrImage && (
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrImage} alt="QR" className="mx-auto mb-3 h-64 w-64" />
          <p className="text-sm text-gray-500">أظهر هذا الرمز لموظف الاستقبال أو الطبيب ليقوم بمسحه.</p>
          <p className="mt-1 text-xs text-gray-400">صالح لمدة {secondsLeft} ثانية — بانتظار المسح…</p>
          <button onClick={reset} className="mt-3 text-sm text-gray-400 hover:underline">
            إلغاء
          </button>
        </div>
      )}

      {state === "claimed" && req && (
        <div>
          <p className="mb-1 font-bold" style={{ color: "#0F7A6C" }}>
            طلب وصول
          </p>
          <p className="mb-4 text-sm text-gray-600">
            {req.claimedByClinicName} يطلب إذناً مؤقتاً ({ACCESS_GRANT_MINUTES} دقيقة) لقراءة سجلّك الطبي وإضافة وصفة/تقرير جديد إليه.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleDeny}
              disabled={busy}
              className="flex-1 rounded-lg border border-red-300 px-4 py-2 text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              رفض
            </button>
            <button
              onClick={handleApprove}
              disabled={busy}
              className="flex-1 rounded-lg bg-brand-500 px-4 py-2 font-bold text-white hover:bg-brand-600 disabled:opacity-50"
            >
              موافقة
            </button>
          </div>
        </div>
      )}

      {state === "approved" && req && (
        <div>
          <p className="mb-3 text-green-700">
            تم منح {req.claimedByClinicName} وصولاً مؤقتاً لمدة {ACCESS_GRANT_MINUTES} دقيقة.
          </p>
          <button onClick={reset} className="text-sm text-brand-600 hover:underline">
            إغلاق
          </button>
        </div>
      )}

      {state === "denied" && (
        <div>
          <p className="mb-3 text-gray-600">تم رفض طلب الوصول.</p>
          <button onClick={reset} className="text-sm text-brand-600 hover:underline">
            إغلاق
          </button>
        </div>
      )}

      {state === "expired" && (
        <div>
          <p className="mb-3 text-gray-500">انتهت صلاحية الرمز.</p>
          <button onClick={reset} className="text-sm text-brand-600 hover:underline">
            إظهار رمز جديد
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}

function GrantsPanel({ patientId }: { patientId: string }) {
  const [grants, setGrants] = useState<AccessGrantDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    listGrantsForPatient(patientId).then((g) => {
      setGrants(g);
      setLoading(false);
    });
  }, [patientId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const active = useMemo(() => grants.filter(isGrantActive), [grants]);

  if (loading || active.length === 0) return null;

  return (
    <div className="mb-6 rounded-xl border bg-white p-4">
      <div className="mb-3 font-bold">جهات لديها وصول مؤقت لسجلّك الآن</div>
      <div className="space-y-2">
        {active.map((g) => (
          <div key={g.clinicOwnerUid} className="flex items-center justify-between rounded-lg border p-3 text-sm">
            <div>
              <div className="font-bold">{g.clinicName}</div>
              <div className="text-xs text-gray-400">
                ينتهي {g.expiresAt.toDate().toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
            <button
              onClick={() => revokeAccessGrant(patientId, g.clinicOwnerUid).then(reload)}
              className="rounded-lg border border-red-300 px-3 py-1 text-red-600 hover:bg-red-50"
            >
              إلغاء الوصول
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecordPanel({
  entries,
  onAddSelf,
}: {
  entries: RecordEntryDoc[];
  onAddSelf: (type: RecordEntryType, text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleAdd() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await onAddSelf("history", text.trim());
      setText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="mb-3 font-bold">سجلّي الطبي</div>

      <div className="mb-4 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="أضف ملاحظة إلى سجلّك (مثال: حساسية من البنسلين)"
          className="flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <button
          onClick={handleAdd}
          disabled={busy || !text.trim()}
          className="shrink-0 rounded-lg border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          إضافة
        </button>
      </div>

      {entries.length === 0 && <p className="text-sm text-gray-400">لا يوجد سجل طبي حتى الآن.</p>}

      <div className="space-y-2">
        {entries.map((e) => (
          <div key={e.id} className="rounded-lg border p-3 text-sm">
            <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
              <span>{e.type === "prescription" ? "وصفة طبية" : "ملاحظة/تقرير"}</span>
              <span>{e.createdAt?.toDate().toLocaleDateString("ar")}</span>
            </div>
            <p>{e.text}</p>
            {e.authorType === "clinic" && <p className="mt-1 text-xs text-brand-600">أضافها: {e.clinicName}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
