#!/usr/bin/env node
// Creates (or promotes) the one primary admin account, from environment
// variables — never hardcoded, and never done client-side, because setting
// the "admin" custom claim requires the Firebase Admin SDK's elevated
// privileges (a signed-in browser user can never grant itself this claim;
// see firestore.rules' users/{uid} create/update rules).
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json \
//   ADMIN_EMAIL=admin@example.com \
//   ADMIN_PASSWORD='a-strong-password' \
//   node apps/web/scripts/seed-admin.mjs
//
// Where serviceAccountKey.json comes from Firebase Console → Project
// Settings → Service Accounts → Generate new private key. Keep it out of
// git (it is not one of the *_PUBLIC_* web config values — it's a secret).
import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) {
  console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD environment variables first.");
  process.exit(1);
}
if (password.length < 8) {
  console.error("ADMIN_PASSWORD must be at least 8 characters.");
  process.exit(1);
}

const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const credential = credentialPath
  ? cert(JSON.parse(readFileSync(credentialPath, "utf8")))
  : applicationDefault();

initializeApp({ credential });
const auth = getAuth();
const db = getFirestore();

async function main() {
  let user;
  try {
    user = await auth.getUserByEmail(email);
    console.log(`Found existing account for ${email} (${user.uid}) — promoting to admin.`);
    await auth.updateUser(user.uid, { password });
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
    user = await auth.createUser({ email, password, emailVerified: true });
    console.log(`Created new admin account for ${email} (${user.uid}).`);
  }

  await auth.setCustomUserClaims(user.uid, { admin: true });

  await db.collection("users").doc(user.uid).set(
    {
      uid: user.uid,
      email,
      role: "admin",
      displayName: "مدير موعد",
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log("Done. Sign in at /admin/login with this email/password.");
  console.log("Note: an already-open browser session must sign out and back in (or wait ~1h)");
  console.log("for the new custom claim to take effect — see auth.ts isAdminUser()'s forced refresh.");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
