"use client";

// "مسح سجل المراجع" — the clinic-side half of the Universal Patient
// Passport feature: scans a patient's QR code (camera + jsQR, with a
// manual-paste fallback for a device with no camera or blocked camera
// permission), claims the short-lived access_requests ticket it encodes,
// waits for the patient's own live approve/deny decision, then — once
// approved — shows that patient's medical record read-only and lets the
// doctor append a new prescription/report entry. See lib/firebase/
// passport.ts and firestore.rules for the actual access-control model;
// this component only drives the UI/camera loop around it.
import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { auth } from "../lib/firebase/config";
import {
  addRecordEntryByClinic,
  claimAccessRequest,
  getPatientRecord,
  isGrantActive,
  watchAccessGrant,
  watchAccessRequest,
  watchRecordEntries,
  AccessRequestError,
} from "../lib/firebase/passport";
import { decodeQrPayload, InvalidQrPayloadError } from "../lib/qrPassport";
import type { AccessGrantDoc, ClinicDoc, PatientRecordDoc, RecordEntryDoc, RecordEntryType } from "../lib/firebase/types";

type Phase =
  | { step: "scanning" }
  | { step: "waiting"; patientId: string; requestId: string }
  | { step: "denied" }
  | { step: "granted"; patientId: string; grant: AccessGrantDoc }
  | { step: "expired" };

export default function ScanPatientTab({ clinic }: { clinic: ClinicDoc }) {
  const [phase, setPhase] = useState<Phase>({ step: "scanning" });
  const [error, setError] = useState<string | null>(null);
  const unsubscribers = useRef<(() => void)[]>([]);

  const cleanupWatchers = useCallback(() => {
    unsubscribers.current.forEach((u) => u());
    unsubscribers.current = [];
  }, []);

  useEffect(() => () => cleanupWatchers(), [cleanupWatchers]);

  const handleDecoded = useCallback(
    async (raw: string) => {
      const ownerUid = auth.currentUser?.uid;
      if (!ownerUid) return;
      setError(null);
      try {
        const payload = decodeQrPayload(raw);
        await claimAccessRequest(payload.requestId, {
          ownerUid,
          slug: clinic.slug,
          clinicName: clinic.clinicName,
        });
        cleanupWatchers();
        setPhase({ step: "waiting", patientId: payload.patientId, requestId: payload.requestId });

        unsubscribers.current.push(
          watchAccessRequest(payload.requestId, (req) => {
            if (req?.status === "denied") setPhase({ step: "denied" });
          })
        );
        unsubscribers.current.push(
          watchAccessGrant(payload.patientId, ownerUid, (grant) => {
            if (grant && isGrantActive(grant)) setPhase({ step: "granted", patientId: payload.patientId, grant });
          })
        );
      } catch (err) {
        if (err instanceof InvalidQrPayloadError || err instanceof AccessRequestError) {
          setError(err.message);
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    },
    [clinic.slug, clinic.clinicName, cleanupWatchers]
  );

  function reset() {
    cleanupWatchers();
    setError(null);
    setPhase({ step: "scanning" });
  }

  return (
    <div className="mx-auto max-w-xl">
      {phase.step === "scanning" && <Scanner onDecoded={handleDecoded} error={error} />}

      {phase.step === "waiting" && (
        <div className="rounded-xl border bg-white p-6 text-center">
          <p className="mb-2 font-bold" style={{ color: "#0F7A6C" }}>
            بانتظار موافقة المراجع…
          </p>
          <p className="mb-4 text-sm text-gray-500">اطلب من المراجع تأكيد منح الوصول من شاشته.</p>
          <button onClick={reset} className="text-sm text-gray-400 hover:underline">
            إلغاء
          </button>
        </div>
      )}

      {phase.step === "denied" && (
        <div className="rounded-xl border bg-white p-6 text-center">
          <p className="mb-4 text-red-600">رفض المراجع طلب الوصول.</p>
          <button onClick={reset} className="text-sm text-brand-600 hover:underline">
            مسح رمز آخر
          </button>
        </div>
      )}

      {phase.step === "expired" && (
        <div className="rounded-xl border bg-white p-6 text-center">
          <p className="mb-4 text-gray-500">انتهت صلاحية الوصول لهذا السجل.</p>
          <button onClick={reset} className="text-sm text-brand-600 hover:underline">
            مسح رمز آخر
          </button>
        </div>
      )}

      {phase.step === "granted" && (
        <GrantedRecordView
          clinic={clinic}
          patientId={phase.patientId}
          grant={phase.grant}
          onExpired={() => setPhase({ step: "expired" })}
          onDone={reset}
        />
      )}
    </div>
  );
}

/** Camera-based decode loop (getUserMedia + jsQR on a hidden canvas), with
 *  a manual-paste fallback — a desktop dev machine or a browser that denies
 *  camera permission still needs some way to exercise this flow, and this
 *  keeps that path honestly labeled rather than hidden. */
function Scanner({ onDecoded, error }: { onDecoded: (raw: string) => void; error: string | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualValue, setManualValue] = useState("");
  const lastDecodedRef = useRef<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled || !videoRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        loop();
      } catch {
        setCameraError("تعذّر الوصول إلى الكاميرا — استخدم الإدخال اليدوي بالأسفل.");
      }
    }

    function loop() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code && code.data && code.data !== lastDecodedRef.current) {
            lastDecodedRef.current = code.data;
            onDecoded(code.data);
          }
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    }

    start();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="mb-3 font-bold">وجّه الكاميرا نحو رمز QR الخاص بالمراجع</div>
      <div className="relative mx-auto mb-3 aspect-square max-w-xs overflow-hidden rounded-lg bg-gray-900">
        <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
      </div>
      <canvas ref={canvasRef} className="hidden" />
      {cameraError && <p className="mb-3 text-sm text-amber-700">{cameraError}</p>}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <details className="text-sm">
        <summary className="cursor-pointer text-gray-500">إدخال يدوي (بديل عند تعذّر الكاميرا)</summary>
        <div className="mt-2 flex gap-2">
          <input
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
            dir="ltr"
            placeholder="نص الرمز"
            className="flex-1 rounded-lg border px-3 py-2 text-xs"
          />
          <button
            onClick={() => manualValue.trim() && onDecoded(manualValue.trim())}
            className="shrink-0 rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
          >
            تأكيد
          </button>
        </div>
      </details>
    </div>
  );
}

function GrantedRecordView({
  clinic,
  patientId,
  grant,
  onExpired,
  onDone,
}: {
  clinic: ClinicDoc;
  patientId: string;
  grant: AccessGrantDoc;
  onExpired: () => void;
  onDone: () => void;
}) {
  const [record, setRecord] = useState<PatientRecordDoc | null | undefined>(undefined);
  const [entries, setEntries] = useState<RecordEntryDoc[]>([]);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [newType, setNewType] = useState<RecordEntryType>("prescription");
  const [newText, setNewText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPatientRecord(patientId).then(setRecord);
    return watchRecordEntries(patientId, setEntries);
  }, [patientId]);

  useEffect(() => {
    const tick = () => {
      const left = Math.round((grant.expiresAt.toMillis() - Date.now()) / 1000);
      setSecondsLeft(Math.max(0, left));
      if (left <= 0) onExpired();
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [grant, onExpired]);

  async function handleAdd() {
    if (!newText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addRecordEntryByClinic(
        patientId,
        { ownerUid: auth.currentUser!.uid, slug: clinic.slug, clinicName: clinic.clinicName },
        newType,
        newText.trim()
      );
      setNewText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border bg-white p-4">
        <div>
          <div className="font-bold">{record === undefined ? "…" : record?.fullName ?? "—"}</div>
          <div className="text-xs text-gray-400">وصول للقراءة فقط + إضافة سجلات جديدة — ينتهي خلال {secondsLeft} ثانية</div>
        </div>
        <button onClick={onDone} className="text-sm text-gray-400 hover:underline">
          إنهاء
        </button>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="mb-3 font-bold">السجل الطبي (للقراءة فقط)</div>
        {entries.length === 0 && <p className="text-sm text-gray-400">لا يوجد سجل طبي سابق لهذا المراجع.</p>}
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

      <div className="rounded-xl border bg-white p-4">
        <div className="mb-3 font-bold">إضافة وصفة أو تقرير جديد</div>
        <div className="mb-2 flex gap-2 text-sm">
          <button
            onClick={() => setNewType("prescription")}
            className={"flex-1 rounded-lg border px-3 py-2 " + (newType === "prescription" ? "border-brand-600 bg-brand-50 text-brand-700" : "")}
          >
            وصفة طبية
          </button>
          <button
            onClick={() => setNewType("history")}
            className={"flex-1 rounded-lg border px-3 py-2 " + (newType === "history" ? "border-brand-600 bg-brand-50 text-brand-700" : "")}
          >
            ملاحظة/تقرير
          </button>
        </div>
        <textarea
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          rows={3}
          className="mb-2 w-full rounded-lg border px-3 py-2 text-sm"
          placeholder="اكتب تفاصيل الوصفة أو الملاحظة…"
        />
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <button
          onClick={handleAdd}
          disabled={busy || !newText.trim()}
          className="w-full rounded-lg bg-brand-500 px-4 py-2 font-bold text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {busy ? "جارٍ الحفظ…" : "إضافة إلى السجل"}
        </button>
      </div>
    </div>
  );
}
