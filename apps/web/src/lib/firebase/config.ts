// Firebase app initialization. Values come from NEXT_PUBLIC_FIREBASE_* env
// vars (see apps/web/.env.local.example) — this is the Web SDK config
// object, which is NOT a secret (it's safe to ship in client JS; access
// control lives entirely in firestore.rules, not in hiding these values).
// It is a different artifact from google-services.json/GoogleService-Info.plist,
// which are for native Android/iOS apps — see docs/firebase-setup.md.
import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function requireConfig(): FirebaseOptions {
  const missing = Object.entries(firebaseConfig)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `Missing Firebase config env vars: ${missing.join(", ")}. ` +
        "Copy apps/web/.env.local.example to .env.local and fill in your Firebase project's web config."
    );
  }
  return firebaseConfig;
}

export const firebaseApp = getApps().length ? getApp() : initializeApp(requireConfig());
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
