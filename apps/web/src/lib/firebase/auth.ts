"use client";

// Auth helpers. Three account shapes share one Firebase Auth user pool:
//   - admin:   email/password, custom claim { admin: true } (seed script only)
//   - clinic:  email/password, users/{uid}.role === "clinic"
//   - patient: anonymous auth — no email/password ever prompted, so the
//              "no account needed" patient flow from the demo artifact
//              carries over unchanged; Firestore still sees a stable uid
//              per device to attribute bookings to and enforce in rules.
import {
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { auth } from "./config";

export function onAuthChange(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb);
}

/** Admin/clinic login. Throws Firebase's own auth/* error on bad credentials. */
export async function signInWithEmail(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

/** Set right before a deliberate sign-out action (e.g. the "تسجيل خروج من
 *  الحساب" button on /clinic) and consumed by clinic/admin layout.tsx's own
 *  auth-effect, which otherwise can't tell a user-initiated sign-out apart
 *  from a session simply expiring — both look identical as an auth-state
 *  change to `null`. Without this, that effect's own signed-out redirect
 *  (-> /signup) races the sign-out button's own navigate-home call, and
 *  which one wins is a timing accident, not a guarantee. A plain module-level
 *  flag is enough: it's read once, synchronously, by the same tab that set
 *  it, with no window for another action to land in between. */
let intentionalSignOut = false;
export function markIntentionalSignOut(): void {
  intentionalSignOut = true;
}
export function consumeIntentionalSignOut(): boolean {
  const was = intentionalSignOut;
  intentionalSignOut = false;
  return was;
}

/** Ensures the current visitor has *some* Firebase Auth identity before a
 *  patient-side write (booking, request) — signs in anonymously if needed.
 *  Safe to call on every page load; it's a no-op once a session exists. */
export async function ensurePatientSession(): Promise<User> {
  if (auth.currentUser) return auth.currentUser;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

/** Custom claims only refresh on the ID token, not the User object, so this
 *  force-refreshes (forceRefresh=true) — needed right after the seed script
 *  grants admin, or the claim wouldn't show up until the next natural token
 *  refresh (~1h later). */
export async function isAdminUser(user: User | null): Promise<boolean> {
  if (!user) return false;
  const token = await user.getIdTokenResult(true);
  return token.claims.admin === true;
}

/** The one address /signup treats as "this is the admin, try signing in"
 *  rather than "this is a new clinic, run the signup flow". Not a secret
 *  and not itself a security boundary — it's a UX routing hint only. The
 *  real gate is always isAdminUser() above (the unforgeable custom claim),
 *  so even a signup attempt using this exact email can't grant admin
 *  access: Firebase Auth already rejects a second account on the same
 *  address, and the claim is only ever set by scripts/seed-admin.mjs. */
export function isConfiguredAdminEmail(email: string): boolean {
  const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL;
  return !!adminEmail && email.trim().toLowerCase() === adminEmail.trim().toLowerCase();
}
