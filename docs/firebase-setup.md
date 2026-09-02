# Firebase backend (Spark plan) — setup

This is a second, additive backend track living alongside the existing
Postgres/Prisma one in `apps/server` — nothing here touches or replaces it.
See **"How this relates to `apps/server`"** at the bottom before you decide
whether to keep both, or drop one.

## What's here

- `firestore.rules` / `firestore.indexes.json` / `firebase.json` (repo root)
- `apps/web/src/lib/firebase/` — client SDK init, auth helpers, data access
  (`config.ts`, `auth.ts`, `firestore.ts`, `slotEngine.ts`, `types.ts`)
- `apps/web/src/app/admin/` — the admin dashboard (`/admin`, `/admin/login`,
  `/admin/users/[uid]`)
- `apps/web/scripts/seed-admin.mjs` — creates/promotes the one primary admin
  account (never done client-side — see the script's own comments for why)

## Schema

```
users/{uid}                 — admin & clinic accounts only (role: "admin" | "clinic")
clinics/{slug}               — slug IS the doc id = the public booking username
appointments/{clinicSlug}_{date}_{startTime}  — deterministic id = the double-booking guard
```

Why the appointment id is built that way: a booking write happens inside a
Firestore transaction that reads that exact document first (see
`bookSlot()` in `firestore.ts`). Firestore serializes transactions touching
the same document, so of two concurrent bookings for the same slot exactly
one commits — the Firestore-native equivalent of the Postgres
`slotLockKey` unique-index guard documented in the root `CLAUDE.md`.

Patients never get a `users/{uid}` doc or a password — they use **Firebase
Anonymous Auth** (`ensurePatientSession()` in `auth.ts`), invisible to them,
so the "book with just name + phone, no account" flow from the demo
artifact carries over unchanged while still giving Firestore a stable uid
per device to enforce rules against.

## 1. Create the Firebase project

1. [console.firebase.google.com](https://console.firebase.google.com) → Add
   project → **do not** enable Google Analytics (not needed, avoids an
   extra product to manage).
2. Confirm it's on the **Spark (free) plan** — this is the default for a
   new project, nothing to opt into.
3. Build → Firestore Database → Create database → **production mode**
   (the shipped `firestore.rules` is the real access control, not the
   30-day test-mode default).
4. Build → Authentication → Get started → enable two sign-in providers:
   **Email/Password** (admin + clinics) and **Anonymous** (patients).

## 2. Register your apps in the project

**Web app** (this is what `apps/web` actually talks to):
Project settings → General → Your apps → Web (`</>`) → register it → copy
the config object into `apps/web/.env.local` (copy
`.env.local.example` first) as the six `NEXT_PUBLIC_FIREBASE_*` values.
This config is not secret — access control is entirely in
`firestore.rules`.

**About the package name you asked me to register earlier
(`MH_Mawid`)**: that string isn't valid for either store — Android
`applicationId` and iOS `CFBundleIdentifier` must be reverse-DNS with at
least two dot-separated segments, lowercase by convention (e.g.
`com.mawid.clinic`, or `iq.mawid.app` if you own a `mawid` domain in a
ccTLD). Pick the real one before registering native apps — **you can't
change it after publishing to either store**. Only register Android/iOS
apps in Firebase once you're actually building a native or wrapped
(Capacitor/TWA) client — the Next.js web app never uses
`google-services.json` / `GoogleService-Info.plist` at all; those two
files exist only to configure the native Firebase SDKs inside an
Android/iOS project, which doesn't exist yet in this repo.

## 3. Deploy security rules + indexes

```bash
npm install -g firebase-tools   # or npx firebase ...  for one-off use
firebase login
firebase use --add              # pick the project you just created
firebase deploy --only firestore:rules,firestore:indexes
```

The Firestore console will also offer a direct "create index" link if a
query ever needs one `firestore.indexes.json` doesn't already cover.

## 4. Seed the admin account

```bash
# Service account key: Project settings → Service Accounts → Generate new private key.
# Keep this file out of git — it's a secret, unlike the web config above.
GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json \
ADMIN_EMAIL=you@example.com \
ADMIN_PASSWORD='a-strong-password' \
npm run seed:admin --workspace=apps/web
```

Sign in at `/admin/login` with that email/password. If you were already
signed in as this user in a browser before running the script, sign out
and back in — custom claims (the `admin: true` flag security rules check)
only refresh on a fresh token.

## 5. Testing locally without touching the real project

```bash
firebase emulators:start   # Firestore on :8080, Auth on :9099, UI on :4001
```

Point `apps/web` at the emulator instead of production by wrapping
`connectFirestoreEmulator`/`connectAuthEmulator` calls around `db`/`auth`
in `config.ts` behind a `NEXT_PUBLIC_USE_FIREBASE_EMULATOR` flag if you
want this for day-to-day development — not wired up yet, since the emulator
is normally only needed to test rule changes, not for every dev session.

The rules themselves were validated against this exact emulator during
development (23 assertions: role escalation, cross-tenant reads/writes,
double-booking, malformed input) — not shipped untested.

## 6. Spark (free) plan — what stays free

Firestore's free daily quota (check
[firebase.google.com/pricing](https://firebase.google.com/pricing) for the
current numbers — these change over time): roughly 50K reads / 20K writes /
20K deletes per day, 1 GiB stored. Everything in this codebase is designed
to fit inside that for a small number of clinics:

- `adminGetStats()` uses `getCountFromServer()`, which bills as **one read**
  regardless of collection size — not "read every document to count them."
- No Cloud Functions anywhere (Spark doesn't support them at all for most
  trigger types) — every write goes straight from the client through
  security rules; the only server-side code is the one-off
  `seed-admin.mjs` script you run locally, never deployed.
- Firebase Authentication (including Anonymous) has no meaningful free-tier
  cap for email/password or anonymous sign-in at this scale.

**Known gap, be aware of it rather than surprised by it**: there's no App
Check on this project, so an anonymous patient write (a booking request)
isn't rate-limited beyond what the rules validate (basic format + size
checks — see `firestore.rules`' `isValidApptCreate()`). A determined
abuser could still script many small writes and burn through the daily
write quota. Firebase App Check (reCAPTCHA-based, itself free on Spark) is
the real fix if this becomes a problem — not implemented yet since it adds
real setup friction (reCAPTCHA site keys) for a system with a handful of
pilot clinics; flag it if you want it added before a public launch.

## How this relates to `apps/server` (Postgres/Prisma)

**This is genuinely an open question, not one I decided for you.** The
existing MVP (`apps/server` + `apps/web`'s `lib/api/client.ts` +
`lib/offline`) is a complete, working Postgres-backed system with its own
double-booking guard and IndexedDB offline-first sync — none of that was
touched, removed, or deprecated by this work. What was added is a fully
separate, parallel data layer (`lib/firebase/`) that a *different* set of
pages (`/admin/*`) talk to. Nothing currently wires the two together, and
nothing currently makes the public/patient/reception screens (`/dashboard`,
`/display`, the root page) use Firestore instead of the Postgres API.

Two real paths from here, and the right one depends on what you actually
want to run in production:
- **Replace**: migrate `/dashboard`, `/display`, and the patient-facing
  screens onto `lib/firebase/` too, and retire `apps/server` + Postgres
  entirely — Firebase's free tier means the whole app could run without
  ever needing paid hosting, which directly solves the "no live hosted
  URL, no hosting credentials" gap noted in the root `CLAUDE.md`.
- **Keep both**: Postgres stays the system of record for reception/
  patients, Firebase becomes purely the backend for a future native
  mobile app and the admin dashboard.

Say which one you want and I'll do the migration work — this isn't a small
patch either way, so I didn't guess.
