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
