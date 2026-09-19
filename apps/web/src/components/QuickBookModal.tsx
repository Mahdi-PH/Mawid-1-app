"use client";

import { useState } from "react";
import type { Patient } from "@mawid/shared";
import { bookAppointmentLocal, findOrCreatePatient, searchPatients, SlotTakenLocallyError } from "../lib/api/client";

interface Props {
  clinicId: string;
  doctorId: string;
  date: string;
  startTime: string;
  onClose: () => void;
  onBooked: () => void;
}

/**
 * The whole "add patient + book" flow in as few clicks as possible:
 *   click 1 -> open this modal (clicking an empty slot on the timeline)
 *   (type phone; matching existing patients appear - clicking one is optional)
 *   click 2 -> "تأكيد الحجز" - creates the patient if new, then books the slot.
 */
export function QuickBookModal({ clinicId, doctorId, date, startTime, onClose, onBooked }: Props) {
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [matches, setMatches] = useState<Patient[]>([]);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onPhoneChange(value: string) {
    setPhone(value);
    setSelected(null);
    if (value.length >= 3) {
      setMatches(await searchPatients(clinicId, value));
    } else {
      setMatches([]);
    }
  }

  function pickMatch(p: Patient) {
    setSelected(p);
    setPhone(p.phone);
    setFullName(p.fullName);
    setMatches([]);
  }

  async function confirm() {
    setError(null);
    if (!phone || (!fullName && !selected)) {
      setError("الرجاء إدخال اسم المريض ورقم الهاتف");
      return;
    }
    setSubmitting(true);
    try {
      const patient = selected ?? (await findOrCreatePatient({ clinicId, fullName, phone }));
      await bookAppointmentLocal({ clinicId, doctorId, patientId: patient.id, date, startTime });
      onBooked();
    } catch (err) {
      setError(err instanceof SlotTakenLocallyError ? err.message : "تعذر إتمام الحجز، حاول مرة أخرى");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <h2 className="mb-1 text-lg font-bold text-neutral-800">حجز موعد جديد</h2>
        <p className="mb-4 text-sm text-neutral-500">
          {date} — الساعة {startTime}
        </p>

        <label className="mb-1 block text-sm font-medium text-neutral-700">رقم الهاتف</label>
        <input
          autoFocus
          type="tel"
          dir="ltr"
          value={phone}
          onChange={(e) => onPhoneChange(e.target.value)}
          placeholder="05xxxxxxxx"
          className="mb-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-left focus:border-brand-500 focus:outline-none"
        />

        {matches.length > 0 && (
          <div className="mb-3 max-h-32 overflow-y-auto rounded-lg border border-neutral-200">
            {matches.map((m) => (
              <button
                key={m.id}
                onClick={() => pickMatch(m)}
                className="block w-full border-b border-neutral-100 px-3 py-2 text-right text-sm hover:bg-brand-50 last:border-0"
              >
                {m.fullName} — <span dir="ltr">{m.phone}</span>
              </button>
            ))}
          </div>
        )}

        {!selected && (
          <>
            <label className="mb-1 block text-sm font-medium text-neutral-700">اسم المريض</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="الاسم الكامل"
              className="mb-3 w-full rounded-lg border border-neutral-300 px-3 py-2 focus:border-brand-500 focus:outline-none"
            />
          </>
        )}

        {selected && (
          <p className="mb-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">
            مريض حالي: <strong>{selected.fullName}</strong>
          </p>
        )}

        {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={confirm}
            disabled={submitting}
            className="flex-1 rounded-lg bg-brand-500 py-2 font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {submitting ? "جارٍ الحجز..." : "تأكيد الحجز"}
          </button>
          <button onClick={onClose} className="rounded-lg border border-neutral-300 px-4 py-2 text-neutral-600">
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
