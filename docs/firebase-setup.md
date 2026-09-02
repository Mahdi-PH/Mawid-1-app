# Firebase backend (Spark plan) — setup

This is a second, additive backend track living alongside the existing
Postgres/Prisma one in `apps/server` — nothing here touches or replaces it.
**Decided**: the two stay permanently parallel (Postgres/Express for the
existing reception/patient screens, Firebase for the admin dashboard and a
future native app) — `apps/server` is not being removed. See "How this
relates to `apps/server`" at the bottom for the reasoning.

## What's here

- `firestore.rules` / `firestore.indexes.json` / `firebase.json` (repo
  root) — `storage.rules` is also there but currently unused/undeployed,
  see "Unified signup" below for why
- `apps/web/src/lib/firebase/` — client SDK init, auth helpers, data access
  (`config.ts`, `auth.ts`, `firestore.ts`, `licenseImage.ts`,
  `slotEngine.ts`, `types.ts`)
- `apps/web/src/app/signup/` — the one public signup/sign-in page (see
  "Unified signup" below)
- `apps/web/src/app/admin/` — the admin dashboard (`/admin`,
  `/admin/users/[uid]`; `/admin/login` just redirects to `/signup` now)
- `apps/web/scripts/seed-admin.mjs` — creates/promotes the one primary admin
  account (never done client-side — see the script's own comments for why)

## Schema

```
users/{uid}                 — admin & clinic accounts only (role: "admin" | "clinic")
clinics/{slug}               — slug IS the doc id = the public booking username
                                status: "pending" | "approved" | "rejected"
                                licenseImageUrl: compressed base64 data: URL (see below)
appointments/{clinicSlug}_{date}_{startTime}  — deterministic id = the double-booking guard
```

### Unified signup + approval workflow

`/signup` is the only public auth page — no separate admin login. One email
field decides everything (`isConfiguredAdminEmail()` in `auth.ts`): the
configured admin address (`NEXT_PUBLIC_ADMIN_EMAIL`) becomes a sign-in
attempt, anything else becomes a new clinic/beauty-center signup requiring
a business-license image upload. Every new signup starts
`status: "pending"` — `firestore.rules` locks that field to admin-only
writes, so a clinic can edit its own profile but never self-approve. The
admin dashboard (`/admin`) lists pending signups with the license image
and Approve/Reject buttons (`adminSetClinicStatus()`).

There is no user-facing "username" field — the public booking slug is
auto-derived from the Gmail address's local part
(`generateUniqueSlugFromEmail()`), retried with a numeric suffix on
collision.

**Why the license image isn't in Firebase Storage**: Google now requires
the paid **Blaze** plan to enable Cloud Storage for Firebase at all, even
for usage that stays within Blaze's own free daily quota — confirmed live
on `mawid-app-d1d03` (403 "Cloud Storage for Firebase API has not been
used" persisted after enabling it in console and waiting for propagation).
The user chose to stay fully on Spark rather than attach billing, so
`licenseImage.ts` downscales the image client-side (canvas, max 1000px,
JPEG quality 0.7) into a base64 `data:` URL capped under 900KB and stores
it directly on the `clinics/{slug}` document — well inside Firestore's
1 MiB document limit, which `firestore.rules` also enforces server-side.
This is fully verified working end-to-end against the live project (a
real signup, real image, admin dashboard rendering it, zoom-to-view all
confirmed via Playwright). If Blaze is adopted later, `storage.rules` is
already written and ready to deploy the same way `firestore.rules` was.

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

## 1. The Firebase project — DONE

The project exists: **`mawid-app-d1d03`**, pinned in `.firebaserc` so
every `firebase` CLI command in this repo already targets it. Firestore
database (production mode) and Authentication (Email/Password +
Anonymous providers) are both created and enabled. Only remains to
confirm once, if you haven't already:

1. Confirm it's on the **Spark (free) plan** — the default for a new
   project, nothing to opt into unless it was changed.
2. **Storage: deliberately not enabled — not needed.** license images are
   stored inline in Firestore instead (see "Unified signup" above), since
   enabling Cloud Storage for Firebase now requires the paid Blaze plan.
   Nothing in the app calls Firebase Storage. If Blaze is adopted later:
   Build → Storage → Get started, then deploy `storage.rules` the same
   way `firestore.rules` was deployed (§3) — or `firebase deploy --only
   storage` with your own `firebase login`.

## 2. Register your apps in the project

**Web app** (this is what `apps/web` actually talks to):
Project settings → General → Your apps → Web (`</>`) → register it → copy
the config object into `apps/web/.env.local` (copy
`.env.local.example` first) as the six `NEXT_PUBLIC_FIREBASE_*` values.
This config is not secret — access control is entirely in
`firestore.rules`.

**Android/iOS app ID — finalized**: the earlier `MH_Mawid` isn't valid
(no dot separator), so per your instruction to use reverse-domain notation,
the recommended id for **both** platforms is:

```
com.mawid.clinic
```

— Android `applicationId` and iOS `CFBundleIdentifier` (Bundle ID in
Xcode / App Store Connect). Same string on both platforms is a convention,
not a requirement, but keeps the two listings easy to associate. If you
register a real domain for the product later (e.g. `mawid.app` or an
Iraqi `mawid.iq`), the id can still switch to match it for any app you
register *after* that — **but never for one already published**, since
neither store allows changing a package/bundle id post-publish. No native
Android/iOS project exists in this repo yet, so nothing has been
registered anywhere with this id yet either — it's the value to type in
when you actually create the Android/iOS app entries in the Firebase
console (Project settings → Your apps → Add app), not something already
submitted. Only do that once you're actually building a native or wrapped
(Capacitor/TWA) client — the Next.js web app itself never uses
`google-services.json` / `GoogleService-Info.plist` at all; those two
files exist only to configure the native Firebase SDKs inside an
Android/iOS project.

## 3. Deploy security rules + indexes — STATUS: rules live, indexes not

Project id is pinned in `.firebaserc` (`mawid-app-d1d03`), so `firebase`
commands run from the repo root already know which project to target —
no `firebase use --add` needed.

```bash
npm install -g firebase-tools   # or npx firebase ...  for one-off use
firebase login                  # opens a browser — needs your Google account
firebase deploy --only firestore:rules,firestore:indexes
```

**If you're signing in with your own Google account (`firebase login`),
the command above should just work.** It was run once already for this
project using a service-account key instead (in-session, no browser
available there), and hit two permission walls specific to that key —
worth knowing about since the same key would hit them again on a future
redeploy:

- `firestore:rules` — the CLI's preflight "is the Firestore API enabled"
  check calls `serviceusage.googleapis.com`, which the Admin SDK service
  account's role doesn't include (by design — that role is scoped to
  Firebase data/rules, not general GCP project administration). Worked
  around by calling the Firebase Rules API
  (`firebaserules.googleapis.com`) directly with the same credentials,
  skipping the CLI's redundant check — **rules are live now**, verified
  by reading the deployed release back.
- `firestore:indexes` — a separate, narrower permission
  (`datastore.indexAdmin`-equivalent) that this service account also
  doesn't have; calling the Firestore Admin API directly (same approach as
  above) still got a plain permission-denied. **Indexes are NOT deployed,
  and this was hit for real** (not just theoretically): the admin pending-
  clinics query originally needed one, a real signup surfaced Firestore's
  "this query requires an index" error live, and rather than depend on
  deploying it, `adminListPendingClinics()` was rewritten to avoid needing
  a composite index at all (dropped the `orderBy`, sorts the small pending
  list client-side instead — see `firestore.ts`). The one remaining
  undeployed index (`appointments` by `clinicSlug`+`date`+`startTime`,
  etc. — `firestore.indexes.json`) still isn't used by any code path
  today; Firestore hands you a direct "create this index" link the moment
  a query actually needs one that's missing. To deploy it anyway: run
  `firebase login` with your own Google account (owns the project, no
  permission gap) and rerun the command above, or grant the service
  account `roles/datastore.indexAdmin` in Cloud Console → IAM first.

## 4. Seed the admin account — DONE

The primary admin account is created and verified: `Mahdinaeem201@gmail.com`,
with the `admin: true` custom claim set and a matching `users/{uid}`
Firestore doc. To create/promote another admin later (same command,
idempotent — safe to rerun for the same email to just reset its password):

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
development (33 assertions: role escalation, cross-tenant reads/writes,
double-booking, malformed input, self-approval/email-spoofing on the
clinic approval workflow, the inline license-image size cap) — not
shipped untested.

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

**Decided: keep both, permanently, for now.** The existing MVP
(`apps/server` + `apps/web`'s `lib/api/client.ts` + `lib/offline`) stays
the system of record for the reception/patient screens (`/dashboard`,
`/display`, the root page) — none of it was touched, removed, or
deprecated by this work, and it isn't going to be. Firebase
(`lib/firebase/`) is a fully separate, parallel data layer that only
`/admin/*` talks to today; nothing wires the two together, and nothing
currently makes the reception/patient screens use Firestore instead of the
Postgres API. If a future native/mobile client gets built, Firebase is the
backend it would talk to (see the "replace" path this doc used to lay out,
below, in case that changes later):

- **Replace** (not chosen, but the option stays open): migrate
  `/dashboard`, `/display`, and the patient-facing screens onto
  `lib/firebase/` too, and retire `apps/server` + Postgres entirely —
  Firebase's free tier means the whole app could run without ever needing
  paid hosting, which directly solves the "no live hosted URL, no hosting
  credentials" gap noted in the root `CLAUDE.md`. Revisit this only if the
  user asks for it explicitly.
