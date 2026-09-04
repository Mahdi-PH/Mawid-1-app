// Local (per-browser) patient session convenience layer — NOT a real
// backend account. Patients still never get a password-based account (see
// lib/firebase/auth.ts ensurePatientSession(); CLAUDE.md's explicit,
// user-confirmed "anonymous forever" decision) - actual booking writes
// are still scoped by Firebase's persisted anonymous uid, unchanged. This
// file only saves the name/phone/PIN a patient already typed once so
// /find doesn't ask again on a return visit in the same browser, and
// remembers their most recent active booking so it can offer a fast way
// back into its waiting screen. The PIN has no server-side verification —
// it's a locally-stored field, matched client-side only (see
// beginSession()) — not a real credential.
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
const SESSION_ACTIVE_KEY = "mawid_patient_session_active";
const ACTIVE_BOOKING_KEY = "mawid_patient_active_booking";

function readStoredProfile(): PatientProfile | null {
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

function isSessionActive(): boolean {
  try {
    return localStorage.getItem(SESSION_ACTIVE_KEY) === "1";
  } catch {
    return false;
  }
}

/** What the UI should treat as "currently signed in" — the stored profile,
 *  but only once a session has actually been started via beginSession().
 *  Sign-out (signOutPatient()) clears just the active flag, never the
 *  stored profile itself, so the data survives and a matching re-entry
 *  restores it exactly — see beginSession(). */
export function getPatientProfile(): PatientProfile | null {
  return isSessionActive() ? readStoredProfile() : null;
}

/** Called when the entry gate on /find is submitted. If the typed name/
 *  phone/PIN match an already-stored profile, this resumes that same
 *  local account — its remembered active booking, if any, stays intact —
 *  instead of overwriting it, which is the whole reason the PIN exists.
 *  A non-matching submission (or no stored profile yet) starts a fresh
 *  local profile and clears any previous one's active booking, since that
 *  booking belonged to a different identity on this device. Returns the
 *  profile now in effect (the restored one, on a match). */
export function beginSession(input: PatientProfile): PatientProfile {
  const existing = readStoredProfile();
  const matches = !!existing && existing.name === input.name && existing.phone === input.phone && existing.pin === input.pin;
  try {
    if (!matches) {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(input));
      localStorage.removeItem(ACTIVE_BOOKING_KEY);
    }
    localStorage.setItem(SESSION_ACTIVE_KEY, "1");
  } catch {
    // Private browsing / blocked storage: the gate will just show again
    // next visit — no crash, matching this app's usual fail-open pattern
    // for localStorage elsewhere (see app/page.tsx's splash flag).
  }
  return matches ? existing! : input;
}

/** Sign-out — clears only the "currently active" marker. The saved
 *  profile and active-booking data are left untouched, so signing back in
 *  with the same name/phone/PIN (see beginSession()) brings the same
 *  account back rather than starting over. */
export function signOutPatient(): void {
  try {
    localStorage.removeItem(SESSION_ACTIVE_KEY);
  } catch {
    // ignore
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

/** Cleared once an appointment reaches a terminal status (see
 *  find/wait/page.tsx) — a legitimate business-logic clear, unrelated to
 *  sign-out, which never touches this on its own. */
export function clearActiveBooking(): void {
  try {
    localStorage.removeItem(ACTIVE_BOOKING_KEY);
  } catch {
    // ignore
  }
}
