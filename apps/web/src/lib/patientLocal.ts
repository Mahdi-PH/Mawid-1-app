// Local (per-browser) patient session convenience layer — NOT a real
// backend account. Patients still never get a password-based account (see
// lib/firebase/auth.ts ensurePatientSession(); CLAUDE.md's explicit,
// user-confirmed "anonymous forever" decision) - actual booking writes
// are still scoped by Firebase's persisted anonymous uid, unchanged. This
// file only saves the name/phone/PIN a patient already typed once so
// /find doesn't ask again on a return visit in the same browser, and
// remembers their most recent active booking so it can offer a fast way
// back into its waiting screen. The PIN has no server-side verification
// at all — it's a locally-stored field only, not a real credential.
export interface PatientProfile {
  name: string;
  phone: string;
  pin: string;
}

export interface ActiveBooking {
  clinicSlug: string;
  clinicName: string;
  apptId: string;
  date: string;
  startTime: string;
}

const PROFILE_KEY = "mawid_patient_profile";
const ACTIVE_BOOKING_KEY = "mawid_patient_active_booking";

export function getPatientProfile(): PatientProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.name === "string" && typeof parsed?.phone === "string" && typeof parsed?.pin === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function savePatientProfile(profile: PatientProfile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Private browsing / blocked storage: the gate will just show again
    // next visit — no crash, matching this app's usual fail-open pattern
    // for localStorage elsewhere (see app/page.tsx's splash flag).
  }
}

export function getActiveBooking(): ActiveBooking | null {
  try {
    const raw = localStorage.getItem(ACTIVE_BOOKING_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveActiveBooking(booking: ActiveBooking): void {
  try {
    localStorage.setItem(ACTIVE_BOOKING_KEY, JSON.stringify(booking));
  } catch {
    // ignore
  }
}

export function clearActiveBooking(): void {
  try {
    localStorage.removeItem(ACTIVE_BOOKING_KEY);
  } catch {
    // ignore
  }
}

/** Signing out clears both the profile and any remembered active booking —
 *  a fresh visit afterward is a genuinely new local session, matching the
 *  "امسح بيانات الجلسة المؤقتة" ask. */
export function clearPatientSession(): void {
  try {
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(ACTIVE_BOOKING_KEY);
  } catch {
    // ignore
  }
}
