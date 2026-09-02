# موعد (Mawid) — project memory

Offline-first clinic booking system. This file is the persistent record of
what exists, why it's built this way, and what's still only prototyped.

## Repo state

- Branch `claude/mawid-clinic-booking-mvp-td9qxz` → PR #1 on
  `Mahdi-PH/Mawid-1-app` (open, not merged).
- Monorepo: `apps/server` (Express + Prisma/Postgres), `apps/web` (Next.js 14
  App Router + Tailwind), `packages/shared` (types + the slot-scheduling
  engine, used by both server and web so offline slot math never drifts).

## Firebase backend track (Spark plan) — parallel to `apps/server`, not a replacement

Added a second, self-contained backend on Firebase (Firestore + Auth,
Spark/free plan) alongside the existing Postgres/Prisma one — nothing in
`apps/server` was touched, removed, or deprecated. Full detail in
`docs/firebase-setup.md`; summary here:

- **Real project exists**: `mawid-app-d1d03`, created by the user, pinned
  in root `.firebaserc` so `firebase` CLI commands run from the repo need
  no `firebase use --add`. Still not yet deployed to — see "Deployment
  status of this track" below before assuming rules/admin are live.

- **Schema**: `users/{uid}` (admin/clinic accounts only), `clinics/{slug}`
  (slug = doc id = public booking username), `appointments/{clinicSlug}_
  {date}_{startTime}` — the deterministic appointment id IS the
  double-booking guard: `bookSlot()` in `apps/web/src/lib/firebase/
  firestore.ts` reads that exact doc inside a Firestore transaction before
  writing, so Firestore's same-document transaction serialization gives
  the same one-of-two-concurrent-bookings-wins guarantee the Postgres
  `slotLockKey` unique index gives the other backend — implemented
  Firestore-natively instead of via a DB constraint.
- **Patients never get passwords**: Firebase Anonymous Auth
  (`ensurePatientSession()`) gives every patient a stable uid invisibly,
  so the "book with just name+phone, no account" flow from the demo
  artifact carries over.
- **Roles are a custom auth claim** (`request.auth.token.admin`), never a
  client-writable field — `firestore.rules`' `users/{uid}` create/update
  rules explicitly block self-promotion to admin; the claim is only ever
  set by `apps/web/scripts/seed-admin.mjs` (run locally with a Firebase
  service-account key + `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars) via the
  Admin SDK.
- **Admin dashboard** at `/admin` (`apps/web/src/app/admin/`): stats
  (`getCountFromServer()` — bills as one read regardless of collection
  size, deliberately chosen over `getDocs().length` to stay cheap on
  Spark's daily read quota), a users table with registration dates, and a
  per-user page listing/editing/deleting that clinic's appointments.
  `/admin/layout.tsx` is a Server Component solely so its `export const
  dynamic = "force-dynamic"` actually takes effect (this route-segment
  config is a no-op in a `"use client"` file — learned by `next build`
  actually failing during prerendering, see the layout's comment) so the
  auth-gated subtree never gets statically prerendered.
- **Real bug found and fixed by actually logging in, not just by
  building**: right after a successful sign-in, the login page used to
  call `router.replace("/admin")` itself, racing `AdminLayoutClient`'s own
  `onAuthChange`-driven redirect effect — `status` was still momentarily
  `"signed-out"` (the async `isAdminUser()` claim check hadn't resolved
  yet) at the exact instant `pathname` flipped to `/admin`, so the layout
  bounced straight back to `/admin/login`. Every network call had
  genuinely succeeded (verified via request logging), so this would have
  looked like "the login button just doesn't work" with no visible error.
  Fixed by making the layout's effect the *only* place that navigates,
  in both directions (`signed-out` → `/admin/login`, `ok` while on
  `/admin/login` → `/admin`); the login page no longer navigates itself.
  Verified fixed by an actual headless-browser login against the real
  `mawid-app-d1d03` project (screenshot sent to the user), not just a
  passing build.
- **Security rules validated against the real Firestore emulator**, not
  just read-through: 23 assertions (role escalation attempts, cross-tenant
  reads/writes, double-booking, malformed/oversized input) all passed
  before this was considered done.
- **Known gap, disclosed not hidden**: no Firebase App Check configured,
  so anonymous patient writes have no real rate limiting beyond the
  rules' format/size checks — a scripted abuser could still burn Spark's
  daily write quota. App Check is free on Spark too; not wired up yet
  because it needs reCAPTCHA site-key setup, real friction for a
  handful-of-pilot-clinics stage. Flag it before a public launch.
- **Deployment status of this track (as of this writing): rules and admin
  are LIVE on the real `mawid-app-d1d03` project; indexes are not.** The
  user created the Firestore database and enabled Auth (Email/Password +
  Anonymous) in console, then shared a service-account key in-session for
  the rest:
  - Firestore database: created (production mode).
  - `firestore.rules`: **deployed and verified live** — but not via
    `firebase deploy`, which kept failing on `serviceusage.googleapis.com`
    403s (the Admin SDK service account's role intentionally excludes
    general GCP API-enablement checks). Worked around by calling the
    Firebase Rules API (`firebaserules.googleapis.com`) directly with the
    same service-account credentials, bypassing the CLI's redundant
    preflight check — then read the live release back to confirm it
    matches. See the session transcript for the exact script if this needs
    repeating after a future rules change.
  - `firestore.indexes.json`: **NOT deployed** — same service account
    lacks `datastore.indexAdmin`-type permission (a narrower, separate
    grant from what rules deploy needs), confirmed by a direct Firestore
    Admin API call failing with a plain permission-denied, unrelated to
    the serviceusage issue above. Not blocking anything today (no code
    path runs those composite queries yet); Firestore surfaces a direct
    "create this index" link the moment a query actually needs one that's
    missing, which is the easiest fix if this is hit later — or grant the
    service account `roles/datastore.indexAdmin` and re-run
    `firebase deploy --only firestore:indexes`.
  - Admin account: created and **verified** — `Mahdinaeem201@gmail.com`,
    custom claim `{admin:true}` set, matching `users/{uid}` Firestore doc
    confirmed to exist with `role:"admin"`.
  - **Web app registered** (`Mawid Web`, appId
    `1:1082116408705:web:68efc55102e44885051480`) via the Firebase
    Management API (`firebase.googleapis.com`) directly, same
    service-account credentials — this one worked with no permission
    issue, unlike indexes. Its config (apiKey, authDomain, etc. — not
    secret, safe to regenerate/re-view anytime from Firebase console →
    Project settings → Your apps) was written to `apps/web/.env.local` in
    this environment; that file is gitignored so it did **not** persist
    to the repo — whoever next runs `apps/web` for real either reuses this
    same registered Web app's config (visible in the Firebase console) or
    registers a new one, either way following `.env.local.example`.
  - **End-to-end login verified against the real project**, not just
    `next dev` + a build: ran the actual Next.js dev server, drove a real
    headless-browser sign-in at `/admin/login` with the seeded admin
    credentials (network calls routed through this sandbox's outbound
    proxy, which a bare browser doesn't use automatically — see the
    session transcript if this needs redoing), and confirmed the
    dashboard renders live Firestore data (1 user, 0 appointments at the
    time). This run is what caught and fixed the redirect race described
    above — a bug `next build`/`tsc` alone could never have caught, since
    it's a runtime auth-timing issue, not a type or compile error.
- **Decided by the user**: `apps/server`/Postgres and this Firebase track
  stay permanently parallel for now (Postgres/Express for the existing
  reception/patient screens, Firebase for the admin dashboard and a future
  native app) — not a replacement, and `apps/server` is not to be removed.
  Revisit only if the user says otherwise.

### Clinic/beauty-center signup + admin approval workflow

Added a real, publicly-usable signup flow and turned the admin dashboard
into an actual approval gate — not just a read-only viewer. Present in
both tracks (the real Firebase app and the demo artifact), per the user's
explicit request to update both.

- **One unified entry point, no separate admin login**: `/signup`
  (`apps/web/src/app/signup/`) is now the only public auth page. One email
  field decides everything (`isConfiguredAdminEmail()` in
  `lib/firebase/auth.ts`): the configured admin address becomes a plain
  sign-in (the admin account still only ever comes from
  `scripts/seed-admin.mjs` — this is a UX routing hint, not a security
  boundary, since Firebase Auth's own email-uniqueness rejects anyone
  trying to *register* a second account on that address), anything else
  becomes a new clinic/beauty-center signup. `/admin/login` now just
  redirects to `/signup` for old links; `AdminLayoutClient` redirects
  signed-out visitors straight to `/signup`.
- **Every new clinic starts `status: "pending"`** (`ClinicDoc.status` in
  `lib/firebase/types.ts`) with a required business-license image upload
  to Firebase Storage (`lib/firebase/storage.ts` `uploadLicenseImage()`,
  path `licenses/{uid}/...`). `firestore.rules`' `clinics/{slug}` update
  rule locks `status` to admin-only writes — a clinic can edit its own
  profile freely but can never self-approve; validated with 8 additional
  emulator assertions (self-approval rejected, email-spoofing on the
  denormalized `clinics.email` field rejected, missing license rejected,
  admin approve/reject succeeds) on top of the original 23.
- **No more user-facing "username" field anywhere** (real app or
  artifact) — the public booking-link slug is auto-derived from the
  Gmail address's local part (`generateUniqueSlugFromEmail()` /
  the artifact's matching `uniqueSlugFromEmail()`), retried with a
  numeric suffix on collision, exactly mirroring how the real backend
  already treated slug vs. login-identifier as separate concepts.
- **Admin dashboard** (`/admin`) gained a "طلبات التسجيل المعلَّقة" section:
  each pending clinic shows its license image, email, and
  Approve/Reject buttons (`adminSetClinicStatus()`). The demo artifact's
  new `view-admin` screen (reachable only via the admin email on the
  unified account screen, password `admin1234` — clearly a demo
  credential, never the user's real email) mirrors this, and also gates
  the patient directory + public booking link so a still-pending or
  rejected clinic is invisible to مراجع until approved
  (`directoryClinics()` / `renderPublicBooking()` now check
  `status === "approved"`).
- **Real bug caught by testing, not just building**: a JS operator-
  precedence slip in the artifact's file-type check
  (`!x.indexOf(...) === 0` instead of `x.indexOf(...) !== 0`) would have
  let every license upload through regardless of file type — caught by
  re-reading the diff before testing, fixed before it ever ran in a
  browser.
- **Reported-and-fixed bug: license upload "not responding to clicks"**
  (artifact only) — took two attempts. First attempt: the license
  `<input type="file">` was styled with the same `.field input` rule as
  every text field (full-width box, border, padding), but a native file
  input only forwards clicks from the small browser-drawn "Choose file"
  button, not the padded box CSS drew around it — fixed by hiding the
  native input behind a full-size `<label for="accLicense">` "dropzone"
  using the standard clip-based hidden-input technique. Reported as still
  not opening a file dialog after that fix, so switched to a strictly
  more robust pattern instead of guessing again: the real `<input
  type="file">` (`.file-input-overlay`) now sits directly on top of the
  visible dropzone box itself — `position:absolute;inset:0;opacity:0` —
  so every click inside the box lands on the actual input element, not a
  `<label>` acting as a proxy for it (this also still carries a
  `for="accLicense"` label wrapper as a redundant fallback). The
  filename/thumbnail preview writes into a separate sibling `<span
  id="accLicensePreview">` rather than the dropzone's own innerHTML, so
  showing a preview never deletes the input node it depends on. Also
  shows a thumbnail + filename once a file is chosen, both for
  reassurance the file "was received" and as a discoverable affordance
  during a normal walkthrough. `apps/web`'s real `/signup` file input
  (`SignupClient.tsx`) uses plain Tailwind classes with no such
  padded-box styling, so it isn't affected by this specific bug —
  left as-is; flag it if it turns out to need the same treatment.
- **Requested change: المحافظة/الحي from dropdown to free text** (artifact
  only — the real Firebase app has no location fields at all yet, see
  "Two-sided product direction" below). `accGov`/`accDistrict` were
  `<select>`s populated from the `GEO` table; changed to plain
  `<input type="text">` per the user's explicit ask. `GEO` still backs
  `findCountryForGov()` (best-effort match, only used to fill in
  `country` when a typed governorate happens to match a known one) and
  the patient directory's district-based lat/lng lookup — both fall back
  to `null`/`0` harmlessly on a non-matching typed value, since neither
  `directoryClinics()`'s search filter nor `clinicAreaLabel()` reads
  `country` (both key off the raw gov/district text). The now-unused
  `fillAccGov()`/`fillAccDistrict()` select-population helpers were
  removed.
- **Real failure-path verified, not just the happy path**: attempted an
  actual signup against the live project while Storage was still
  disabled (see below) — `registerClinic()`'s existing
  create-then-cleanup-on-failure logic correctly deleted the orphaned
  Auth account and left no stray Firestore docs, confirmed by listing
  users/clinics via the Admin SDK straight after. (This specific failure
  mode is now moot — see the Storage-to-Firestore pivot below — but the
  cleanup-on-failure path it exercised is the same one any future
  registerClinic() failure hits, so the verification still stands.)
- **Pivoted away from Firebase Storage entirely — license images live
  inline in Firestore now.** The user did open Storage in console, but
  hit a wall neither of us knew about going in: Google now requires the
  **Blaze** (pay-as-you-go) plan to enable Cloud Storage for Firebase at
  all, even for usage that would stay within Blaze's own free daily quota
  — confirmed by the 403 "Cloud Storage for Firebase API has not been
  used" error persisting after enabling it in console and after waiting
  for propagation. Asked the user rather than assuming: pay to unlock
  Storage, or keep the license image inside Firestore (like the demo
  artifact always did)? They chose to stay fully free. Result:
  `apps/web/src/lib/firebase/storage.ts` was deleted; a new
  `licenseImage.ts` downscales the image client-side (`createImageBitmap`
  → canvas → JPEG, max 1000px / quality 0.7) into a base64 `data:` URL
  capped under 900KB, well inside Firestore's 1 MiB document limit —
  `firestore.rules`' clinic-create rule enforces the same cap server-side.
  `licenseImageUrl` keeps its name/type (still a string holding a URL, now
  a `data:` one instead of an `https://` Storage link) so the schema/type
  barely changed. `storage.rules` and `firebase.json`'s storage block are
  left in the repo, unused and undeployed, in case Blaze is adopted later.
- **A second real bug found by this same pivot, before it shipped**: the
  admin dashboard used to wrap each license thumbnail in
  `<a href={licenseImageUrl} target="_blank">` to view it full-size —
  works fine for an `https://` Storage URL, but Chrome blocks top-level
  navigation to `data:` URLs (an anti-phishing measure), so that link
  would have silently done nothing once switched to inline images. Fixed
  by replacing it with a same-page click-to-zoom overlay, which works
  for any URL scheme since it never navigates.
- **A third real bug, this time in the query, not the upload**: the new
  admin pending-list query (`where("status","==","pending"),
  orderBy("createdAt","desc")`) needs a composite index — caught live
  when a real signup succeeded but the admin dashboard then failed to
  load the pending list at all (Firestore's own "this query requires an
  index" error). Rather than depend on deploying that index (the service
  account still lacks `datastore.indexAdmin`, see below), dropped the
  `orderBy` and sort the small pending list client-side instead —
  `adminListPendingClinics()` needs zero indexes now.
- **Fully verified end-to-end against the live project after all three
  fixes**: a real signup (real Gmail-shaped test address, a real image
  file, no mocking) succeeded, the admin dashboard correctly showed it
  with its license image rendering as an `<img>`, and clicking the
  thumbnail opened the zoom overlay — confirmed via Playwright screenshot,
  not just a passing build. Test accounts were then deleted via the Admin
  SDK (both the Auth user and its Firestore docs) so the live project is
  clean, not left with test clutter.
- **Android/iOS app id finalized as `com.mawid.clinic`** (reverse-DNS, both
  platforms) — the earlier `MH_Mawid` was invalid (no dot separator) and
  told to the user directly rather than silently substituted. No native
  Android/iOS project exists in this repo yet; this id is what to type in
  Firebase console → Add app whenever one is created, not something
  already registered anywhere.

## Architecture decisions worth knowing before touching this code

- **Double-booking guard**: `Appointment.slotLockKey` is a unique Postgres
  column built as `` `${doctorId}|${date}|${startTime}` ``, set to `NULL` on
  cancellation (Postgres allows unlimited NULLs in a unique index) — so
  cancelling frees the slot automatically while two concurrent bookings for
  the same slot still collide atomically. See
  `apps/server/src/modules/appointments/appointments.service.ts` and
  `packages/shared/src/slotEngine.ts`.
- **Offline-first**: `apps/web/src/lib/offline` mirrors the server schema in
  IndexedDB (Dexie). Every write is local-first with an instant client id,
  queued, and flushed to `POST /api/sync/push` in the background —
  idempotent via a client-generated `opId` (`synced_operations` table).
- **PWA**: `apps/web/public/manifest.webmanifest` + `public/sw.js`
  (hand-written app-shell service worker, network-first navigation /
  cache-first assets) make the web app installable on Android/iOS/Windows.
  This is a *second, independent* offline layer from the IndexedDB one —
  one covers the UI shell, the other covers data.
- **Brand**: abstract calligraphic "meem" mark on a teal gradient tile +
  wordmark **مَوْعِد** in Amiri Bold with full tashkeel (the diacritics are the
  requested decoration, not an add-on). Assets in `apps/web/public/brand/`
  (`icon.svg` = full-bleed square source for app-store icon masking,
  `icon-tile.svg` = pre-rounded for web use, various PNG sizes, wordmark +
  lockup in teal/white). Colors: `#0F7A6C` teal / `#17A892` light /
  `#0A5A4F` dark / `#F5FBF9` brand white. Fonts: Amiri (wordmark), Cairo
  (headings/UI), Tajawal (body) — loaded via Google Fonts link tags, not
  yet wired through `next/font` in the actual app (pre-existing gap: the
  original dashboard build referenced these families without ever loading
  them).

## Two-sided product direction (prototyped in a demo artifact, NOT in the real codebase yet)

The user asked to expand the product from "clinic reception tool" into a
**two-sided platform** with a home role picker: **عيادة (Clinic)** vs
**مراجع (Patient/visitor)**. This was iterated live as a single-file HTML
artifact (published, not committed to the repo) rather than in
`apps/web` — the artifact is disposable and fast to reshape; the real
Next.js/Prisma implementation is a separate, larger effort once the UX is
approved. Current artifact URL (same URL republished on every iteration):
`https://claude.ai/code/artifact/d8829f59-094b-4102-8744-9893d170084f`

The artifact is kept deliberately in sync with every user-facing change
made to the real app so it stays "أول شيء تجربه" for anything new — most
recently the clinic/beauty-center relabel, the Gmail-based signup field,
the unified admin sign-in, and the license-upload approval workflow (all
already listed below) plus a small teal pill banner on the home screen
("جديد — التطبيق الحقيقي أصبح مباشراً وقابلاً للتثبيت على جهازك") linking
out to the now-live `https://mawid-app-d1d03.web.app`, added once that
deployment shipped — since an artifact runs sandboxed and can't itself
demonstrate a real installable PWA, this links out to the real one instead
of faking install behavior in-artifact.

What the artifact currently demonstrates end-to-end (all client-side,
localStorage-backed, no server):

1. **Home**: choose "عيادة أو مركز تجميل" or "مراجع" — both role-card titles
   set in the teal accent color (not the default near-black ink) for
   prominence. No
   pricing badges on this screen (removed per the user's ask — "أول شهر
   مجاناً" / "مجاني دائماً" now only appear where they're contextually
   relevant, e.g. the subscription screen).
2. **Clinic path**: subscription screen (one free-plan card; price after
   month 1 explicitly marked "لم يُحدَّد بعد" / TBD and editable, per the
   user's instruction — no invented paid tiers) → a **"الدفع بعد انتهاء
   الشهر المجاني"** info card showing a payment account number
   (`910459764999`, user-supplied, with a copy button — informational only,
   no real payment processing) → **account creation** (clinic name, unique
   username — accepts upper/lowercase letters, digits, `_` and `-`, case
   preserved and case-sensitive, checked against a reserved-word list +
   existing accounts; optional specialty; optional المحافظة/الحي/الشارع
   location picked from the *same* `GEO` table the patient side searches,
   governorates flattened across every country in `GEO` with Iraq listed
   first; password + confirm) → success screen with a **shareable public
   booking link** (`<page-url>#book/<username>`) with copy button +
   WhatsApp share intent → reception dashboard (timeline + waiting-room
   TV), now scoped per logged-in clinic account rather than a single
   hardcoded clinic. A **login screen** exists for returning owners (two
   pre-seeded demo accounts, both password `demo1234`: `alnoor-demo` in
   Riyadh, `karbala-demo` in Karbala). A clinic that sets a
   governorate+district also becomes findable through the patient
   directory's search (`directoryClinics()` merges the static demo list
   with any clinic account that set a location) — not only reachable via
   its direct link, per the user's explicit ask that the two windows
   "sync."
3. **Patient path**: no GPS — the user asked for it removed. A single
   search box (no district dropdown) matches against `"اسم العيادة - الحي"`
   combined, so typing either the clinic name or its district finds it,
   exactly as asked. Clicking a clinic shows today's live slot grid;
   requesting a slot collects name+phone (no account) and lands in a
   "طلباتي" pending-confirmation list. Every clinic that is a real
   registered account (`accountKey` set) shows a light-blue gradient
   checkmark next to its name in both the list and the detail header
   (`verifiedBadge()`); directory-only/static demo entries never get one —
   this is the one honest way to distinguish "really registered in موعد"
   from "just listed," since there is no real data source behind the
   listing (see below).
4. **Direct booking link** (`#book/<username>`): opens straight into that
   one clinic's booking window, skipping home/role-picker/search entirely —
   this is literally the "شارك الرابط في مواقع التواصل" feature. It only
   resolves within the same browser that created the account, since the
   artifact has no backend — **told to the user explicitly**, not silently
   glossed over. A different device/browser opening the same link falls
   back cleanly to the home screen rather than erroring.
5. **Per-clinic working hours + configurable slot duration**: every clinic
   now owns its own schedule instead of one shared global timetable. Account
   creation (`view-account`) has بداية/نهاية الدوام (`accWorkStart`/
   `accWorkEnd`, `<input type="time">`) and مدة الموعد الواحد (`accSlotMin`,
   a `<select>` restricted to `5/10/15/20` minutes — the exact set the user
   asked for). Validated at signup: both times required, and the work
   window must fit at least one slot of the chosen length
   (`toMin(workEnd) - toMin(workStart) >= slotMin`), each with an inline
   Arabic error rather than a silent failure. The engine (`slotConfigOf()` /
   `generateSlotsFor(cfg)` in the `<script>`) generates slots by walking
   `workStart..workEnd` in `slotMin` steps and skipping any step that
   overlaps `breakStart..breakEnd` (optional, not yet exposed in the UI —
   stored as `null` for new accounts, only the two pre-seeded demo accounts
   have one) — so "available only during clinic hours" holds by
   construction, not as a separate rule to keep in sync. Every render path
   that used to read one global `SLOTS` array now resolves a per-entity
   config first: `slotConfigForClinic(clinic)` for directory
   cards/detail (defers to the linked account's own config via
   `accountKey` when the directory entry is a real registered clinic,
   otherwise uses the static entry's own fields), `slotConfigOf(acc)` for
   the logged-in clinic's own dashboard/timeline/TV/public-booking-link
   views. `queueNumberIn(slots, t)` replaced the old global
   `queueNumberFor(t)` for the same reason (a queue number is only
   meaningful against the slot list it was computed from). Pre-seeded demo
   accounts: `alnoor-demo` 15-minute slots, 09:00–17:00, break
   13:00–14:00; `karbala-demo` 10-minute slots, 08:30–16:00, no break. The
   four static directory-only `CLINICS` entries were also given varied,
   realistic schedules (10/15/20-minute slots, some with a break) so the
   patient-facing search/detail views exercise the same per-clinic math,
   not one hardcoded case.
6. **Editing working hours after signup**: the clinic dashboard's topbar
   (`view-clinic`) has a third tab, إعدادات الدوام, alongside الاستقبال and
   شاشة الانتظار (`activateClinicTab()` in the `<script>`), with the same
   بداية/نهاية الدوام + مدة الموعد الواحد fields as signup, pre-filled from
   the logged-in account and reusing the same two validation rules (both
   times required; the window must fit at least one slot of the chosen
   length). Saving applies immediately — the dashboard timeline and doctor-
   meta line re-render on save, and the public booking link/patient views
   pick it up on their next render since they all read the account's config
   live rather than a cached copy. The one extra rule editing needs that
   creation didn't: **saving is refused if any already-booked appointment's
   start time would fall outside the new schedule** (checked by generating
   the new slot grid and diffing it against every occupied appointment
   time) — the error names the exact conflicting times and tells the
   clinic to cancel/reschedule them first, rather than silently orphaning a
   patient's booking. `breakStart`/`breakEnd` aren't editable from this
   screen yet (still signup-time-only, `null` for new accounts) — same gap
   noted above.

Known, disclosed limitations of the artifact (do not silently "fix" these
by pretending they don't exist — they're inherent to a single static HTML
file with no backend, and were explained to the user each time):

- Passwords are stored in plain text in `localStorage` — demo-only, never
  do this server-side (the real `apps/server` would hash them).
- Account/session data lives only in the creating browser's localStorage —
  no cross-device sync. This is exactly what the real Postgres-backed
  server already built in `apps/server` would solve.
- The "الدفع بعد انتهاء الشهر المجاني" account number is static, informational
  text (a manual bank/wallet transfer instruction) — there is no payment
  gateway, invoicing, or subscription-expiry tracking behind it.
- **Karbala, Iraq is the app's designated official location** (`GEO.العراق
  .كربلاء`, listed first in every location picker) — the user asked for
  this explicitly, and separately asked to seed the search database with
  every clinic registered with Iraq's Ministry of Health in Karbala
  governorate. That second part was **not done**: this session has no
  access to any real MOH registry, and fabricating a list of real-sounding
  clinic names and presenting them as ministry-verified would be inventing
  fake official records — explicitly refused, and the user agreed when
  asked. What exists instead are two clearly-labeled placeholder Karbala
  entries (`"عيادة كربلاء التجريبية (مثال توضيحي)"` as a real seeded account,
  `"مركز الفرات الطبي (مثال توضيحي)"` as a directory-only static entry) whose
  names say outright that they're illustrative. If a real MOH dataset is
  ever provided (by the user, or a real integration), it should replace
  these placeholders and populate `directoryClinics()`/`CLINICS` for real —
  see `verifiedBadge()` in the artifact for how registered-vs-listed is
  distinguished today.

Visual: the demo layers soft radial/linear gradients (`--grad-page`,
`--grad-card`, `--grad-bar`, `--grad-accent` in the `<style>` root tokens)
over the same teal accent (`#0F7A6C` / `#2DD6BD` dark) on the page
background, primary buttons, topbars, and card surfaces — the brand color
itself was deliberately left unchanged, only given more depth, per the
user's request.

## Android app (installable APK) — `android/`

A real Android app, `com.mawid.clinic`, that produces an actual installable
`.apk` — separate from (and in addition to) the browser-installable PWA
described above. It's a **Trusted Web Activity (TWA)**: a thin native
wrapper, using Google's official `androidbrowserhelper` library, that
launches `https://mawid-app-d1d03.web.app` full-screen with no browser
chrome. There's deliberately almost no native code — the app always shows
whatever is currently live on Firebase Hosting, so a web deploy is also an
app update with no separate native release needed for content changes.

- **Why TWA and not a from-scratch native app or Capacitor**: the PWA
  (manifest + service worker) already existed and is already live — TWA is
  the standard, minimal way to turn an existing live PWA into a real
  Play-Store-shaped APK. Confirmed with the user first (package name,
  wrapping approach, signing-key handling) since this is a real
  architecture choice, not a small patch — see the three
  `AskUserQuestion` answers this was built from.
- **Package name finalized as `com.mawid.clinic`** — the user asked again
  for `MH_Mawid` (as in earlier turns); re-confirmed with them that it's
  still invalid as an Android `applicationId` (no dot separator, must be
  reverse-DNS) rather than silently substituting it, and they picked
  `com.mawid.clinic` again.
- **The actual build cannot run in this Claude Code sandbox** — its
  network policy blocks `dl.google.com` (confirmed via direct `curl`: `403`
  on the CONNECT tunnel, both for the SDK repository and Google's Maven),
  which is where the Android Gradle Plugin and all Android SDK components
  are resolved from. There is no local workaround for this one (unlike the
  `*.web.app` block, which only affected verifying a deploy after the fact,
  not the deploy itself). So `android/` was authored by hand here — every
  Gradle/manifest/resource file written directly — and
  `.github/workflows/android-build.yml` is where the actual build runs, on
  GitHub's own runners, which have full internet and the Android SDK
  preinstalled. Two things needed a same workaround during authoring:
  - `./gradlew` itself couldn't be generated by running `gradle wrapper`
    directly in `android/`, since that first evaluates `build.gradle`,
    which resolves the AGP classpath dependency from the same blocked
    `dl.google.com` — worked around by running `gradle wrapper` in an
    empty scratch directory (no build.gradle to evaluate) and copying the
    resulting `gradlew`/`gradlew.bat`/`gradle/wrapper/*` into `android/`.
  - Launcher icons (`mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher*.png`) were
    generated locally with Pillow (`pip install Pillow` — `pypi.org` is
    allow-listed through the sandbox's proxy, unlike `dl.google.com`),
    resizing the existing `apps/web/public/brand/icon-1024.png` down to
    each density rather than needing Android Studio or `bubblewrap`.
- **Two build variants**: `assembleDebug` needs zero configuration
  (Android's own auto-generated debug keystore) and always builds — good
  enough to sideload for testing today. `assembleRelease` only builds once
  four `ANDROID_KEYSTORE_*` repo secrets are set (see the workflow file's
  header comment for the exact names) — until then that job step is
  skipped rather than failing the whole workflow.
- **Signing key**: generated once, in this session, with `keytool`
  (`CN=Mawid, O=Mawid, L=Karbala, C=IQ`, RSA 2048, 10,000-day validity,
  alias `mawid-release`) — the user explicitly asked for it to be
  generated automatically rather than supplying their own. **This key
  cannot be regenerated later without losing the ability to publish any
  future update to the same app listing** (Android requires every update
  to an `applicationId` be signed by the same key), so it was handed
  directly to the user (never committed — `.gitignore` now excludes
  `*.keystore`/`*.jks` and `android/app/release.keystore` defensively)
  along with the exact four values to paste into GitHub → repo Settings →
  Secrets and variables → Actions. Its SHA-256 certificate fingerprint is
  also baked into `apps/web/public/.well-known/assetlinks.json` (added,
  not yet deployed — see below).
- **`assetlinks.json` needs a Firebase Hosting redeploy to take effect**:
  it was added at `apps/web/public/.well-known/assetlinks.json` so Android
  can verify this APK is authorized to open the site as a true full-screen
  TWA (Digital Asset Links) rather than falling back to a Custom Tab with
  a visible URL bar — the app still works either way, this only affects
  that visual polish. This session has no Firebase service-account key
  (it was shared once, earlier, and isn't persisted across sessions/
  containers), so deploying it is a follow-up: rebuild
  (`npm run build --workspace=apps/web`) and
  `firebase deploy --only hosting` once a key is available again.
- **Not done yet, and not attempted**: publishing to the Play Store
  (needs a $25 one-time Google Play Developer account the user would have
  to create themselves, plus a store listing, screenshots, privacy policy
  URL, etc. — a distribution/business step, not a code one). What exists
  today is a sideloadable APK, which is what "install and test it now"
  actually needs.

## Deployment status

**`apps/web` is live**: **https://mawid-app-d1d03.web.app**, deployed to
Firebase Hosting (free static hosting, part of the same `mawid-app-d1d03`
project as the Firebase backend track — no separate hosting account
needed). Getting here required converting the whole app to a Next.js
static export:

- `next.config.js` now has `output: "export"` — every route was already a
  client component with no server-only data fetching, so this cost
  nothing except two things static export genuinely can't do: the old
  `/admin/users/[uid]` dynamic segment (uids aren't known at build time)
  became `/admin/user?uid=...` reading the id via `useSearchParams()`
  instead; and `export const dynamic = "force-dynamic"` (added earlier to
  dodge a build-time prerender crash when Firebase env vars were still
  missing) was removed — no longer needed now that `.env.local` has real
  values baked in at build time, and actively incompatible with static
  export anyway.
- Deployed via `firebase deploy --only hosting` with the service-account
  key — this one worked through the CLI directly with no permission wall,
  unlike Firestore rules/indexes or Storage earlier. Verified live and
  finalized by reading the release back from the Firebase Hosting
  Management API (`firebasehosting.googleapis.com`), since this sandbox's
  own network egress policy doesn't allow reaching `*.web.app` directly to
  curl/Playwright-test it — that's a limitation of this environment, not
  of the deployment; the user needs to be the one to open the link and
  confirm the install prompt on their own device.
- Verified locally first, not just assumed: served the exported `out/`
  directory with a static file server and ran Playwright against it
  (manifest links correctly, the service worker actually registers, admin
  login/dashboard/the new query-param user-detail route all work,
  `/admin/login`'s redirect still works) — all passed before deploying.
- **What's actually live vs. not**: `/signup` and `/admin/*` are fully
  live and functional (real Firebase Auth + Firestore, exactly as tested
  throughout this session). `/dashboard` and `/display` are also served
  (they're static files now) but **not functionally live** for a random
  visitor — they still call `apps/server`'s REST API via
  `lib/api/client.ts` at `NEXT_PUBLIC_API_BASE` (defaults to
  `http://localhost:4000`), and `apps/server` itself has no hosted
  deployment anywhere. The demo artifact remains the way to see that
  reception/patient UX without running anything locally.
- **Real bug the user caught by actually opening the installed app**: the
  root `/` page was still the original pre-pivot MVP homepage (a bare
  "لوحة الاستقبال"/"شاشة صالة الانتظار" button pair pointing at the
  non-hosted `/dashboard`/`/display` routes above) — it had never been
  updated to the branded two-sided home screen (logo mark, wordmark, role
  cards) iterated in the demo artifact, so opening the real installed app
  looked "completely different" from the demo the user had been trying.
  Rewrote `apps/web/src/app/page.tsx` to match the demo's branding (same
  inline SVG logo mark, teal gradient, "مَوْعِد" wordmark, role-card
  layout). The "عيادة أو مركز تجميل" card routes to the real, live
  `/signup`; the "مراجع" card is shown but visibly disabled with "قريباً"
  rather than routed anywhere, since no real patient-facing directory/
  search/booking flow exists in `apps/web` yet — that's still only the
  demo artifact (see "Two-sided product direction" above and "Next steps
  if resumed" below), a genuinely separate, larger effort needing real
  product decisions, not something to fake a working link to.
- To redeploy after future changes: `npm run build --workspace=apps/web`
  (regenerates `apps/web/out/`), then `firebase deploy --only hosting`
  from the repo root (needs `firebase login` or the same service-account
  key approach).

## Real patient-facing directory + booking (`apps/web/src/app/find/`)

The مراجع (patient) side is no longer artifact-only — `/find` is a real,
Firestore-backed directory + booking flow in `apps/web`, built after the
user's reaction to installing the real app and finding its home page
still linked nowhere real (see the home-page rebrand entry above) made
clear the demo/real gap had to close for this side too, not just
branding. Scoped by one explicit product decision from the user:
**patients never get an account — anonymous forever — and can only find
clinics that are already registered** (no GPS, no manual "add a place"
by a patient, matching the artifact's existing no-GPS decision).

- **Almost the entire backend already existed** from the original
  Firebase-track build, unused by any UI until now: `ClinicDoc` already
  had `gov`/`district`/`workStart`/`workEnd`/`slotMin`/`breakStart`/
  `breakEnd`; `bookSlot()`, `ensurePatientSession()`, and the
  `appointments/{clinicSlug}_{date}_{startTime}` double-booking guard
  were all written and covered by `firestore.rules` long before any
  patient-facing page called them. This session added the three pages
  that actually call them, plus two new `firestore.ts` helpers
  (`listApprovedClinics()`, `getSlotAvailability()`) and one
  `firestore.rules` change (below).
- **`/find`**: lists `clinics` where `status == "approved"` only —
  pending/rejected stay invisible, same as the artifact's directory and
  the admin approval workflow's whole point. A single search box matches
  clinic name + gov/district text, no separate filters, mirroring the
  artifact's `directoryClinics()` search exactly.
- **`/find/book?clinic=<slug>`** (query-param route, same static-export
  reason as `/admin/user`): today's slot grid only, generated from the
  clinic's own `workStart`/`workEnd`/`slotMin`/break via the existing
  `slotEngine.ts` — no multi-day picker, matching the artifact. Tapping a
  free slot opens a name+phone form; submitting calls
  `ensurePatientSession()` then `bookSlot()`. A `SlotTakenError` (lost the
  race to another patient) surfaces inline and re-marks that slot taken
  rather than crashing the page.
- **`/find/requests`** ("طلباتي"): a patient's own requests across every
  clinic, keyed off the stable anonymous uid Firebase Auth persists in
  that browser — no login, exactly what `firestore.rules` already scoped
  appointment reads to.
- **Real architecture problem solved, not just UI wiring**: an anonymous
  patient has no way to safely know which of today's slots are already
  taken. A broad "give me this clinic's appointments today" query is
  correctly denied by `firestore.rules` for a random patient (those docs
  carry another patient's name/phone), and the demo artifact never had to
  solve this since its "occupied" map was local mock data. Two things
  needed to change together:
  - **`getSlotAvailability()`** checks each slot's *deterministic*
    document id individually with a plain `getDoc()` rather than a range
    query: a slot that's free reads back "not found" (nothing to
    protect); a slot someone else already booked comes back
    permission-denied *by the existing rules, unchanged* — read as
    "taken", not treated as an error. Costs one read per slot on the grid
    (a few dozen at most) — fine at pilot scale, same tradeoff already
    accepted elsewhere in this track (see the license-image-size /
    App Check notes above).
  - **`firestore.rules`**: `bookSlot()`'s own transaction needs that same
    kind of read — checking whether the *specific* slot a patient is
    trying to claim already exists — for the booking itself, not just
    the grid's dimming. The appointments `allow read` rule gained exactly
    one clause: `|| (isSignedIn() && resource == null)`. A nonexistent
    document has no data to leak, so this can't expose any real booking —
    once a document exists, this clause is false and the original three
    conditions (own booking / clinic owner / admin) are the only way in,
    unchanged. This is the standard Firestore "check-then-write" pattern,
    not a new door into existing data.
  - **Not verified against a live emulator before this commit** — unlike
    every earlier `firestore.rules` change in this project (see the 23-
    and 8-assertion emulator runs above), this one couldn't be: the
    Firestore emulator binary is fetched from
    `firebase-public.firebaseio.com` at first run, which this sandbox's
    network policy also blocks (confirmed directly — same class of block
    as `dl.google.com` for the Android work). The `resource == null`
    pattern is a well-documented, standard Firestore rules idiom for
    exactly this "does this id already exist" check, and the reasoning
    above was worked through carefully, but this still needs a real
    booking attempt (or a session with Firebase network access) to
    confirm before fully trusting it in production — flag this rather
    than silently treating "compiles and reasons through cleanly" as
    equivalent to "emulator-verified" like the rest of this project's
    rules changes.
- **`listAppointmentsForPatient()` had the same undeployed-index problem
  as `adminListPendingClinics()`** before this session touched it — a
  `(patientUid, createdAt)` composite index was already declared in
  `firestore.indexes.json` but never deployed (same
  `datastore.indexAdmin` permission gap noted above). Fixed the same way:
  dropped `orderBy`, sort client-side.
- **Not yet deployed** — this session has no Firebase service-account key
  (same gap as the Android `assetlinks.json` follow-up above); the code
  is committed and build-verified locally (`tsc --noEmit`, `next build`,
  and a static-file/Playwright render check of `/` and `/find`) but the
  live `mawid-app-d1d03` project still needs `firebase deploy --only
  firestore:rules,hosting` once a key is available again.
- **Deliberately out of scope for this pass**: the signup form still
  doesn't collect `gov`/`district`/working hours (those fields exist on
  `ClinicDoc` and default to null/09:00–17:00/15min for every real
  signup today), so `/find`'s search-by-district only becomes useful once
  a future pass adds those fields to `SignupClient.tsx` — not requested
  this time, so not built speculatively.

## Next steps if resumed

Two things are needed to make the `/find` work above actually live and
verified, in order: (1) a Firebase service-account key, to deploy the
updated `firestore.rules` and the rebuilt `apps/web/out/` to
`mawid-app-d1d03`; (2) a real booking attempt against the live project
right after that (anonymous, from a fresh browser/incognito session) to
confirm the `resource == null` rules change actually behaves as reasoned
above, since it could not be emulator-tested in this sandbox.

If the user also wants signup to collect gov/district/working hours (so
`/find`'s district search and per-clinic hours actually vary clinic to
clinic, matching the artifact), that's a small, well-scoped addition to
`SignupClient.tsx` — `registerClinic()` already accepts all of those
fields, only the form UI doesn't collect them yet.

Paid subscription tiers remain undecided and unbuilt, in either track —
ask before building, per the artifact's "لم يُحدَّد بعد" pricing note.
