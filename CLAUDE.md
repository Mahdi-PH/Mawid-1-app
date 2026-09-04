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
- **Two build variants, both confirmed working on real CI runs**:
  `assembleDebug` needs zero configuration (Android's own auto-generated
  debug keystore) and always builds — good enough to sideload for testing
  today. `assembleRelease` only builds once four `ANDROID_KEYSTORE_*` repo
  secrets are set (see the workflow file's header comment for the exact
  names) — until then that job step is skipped rather than failing the
  whole workflow. Getting the release build green took several rounds on
  the user's side (a base64 secret that decoded to garbage twice in a
  row, traced to the wrong value having been pasted into the secret
  field — not a workflow bug) and one real bug on this side (a keystore-
  validity check that looked for "PK" ZIP magic bytes; a PKCS12 keystore
  actually starts with 0x30, an ASN.1 SEQUENCE tag — fixed once caught).
  Both `assembleDebug` and `assembleRelease` have since produced real,
  downloaded, verified artifacts (`mawid-debug-apk`, `mawid-release-apk`).
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
  also baked into `apps/web/public/.well-known/assetlinks.json` (see
  below — deployed and live).
- **`assetlinks.json` is deployed and live**: added at
  `apps/web/public/.well-known/assetlinks.json` so Android can verify
  this APK is authorized to open the site as a true full-screen TWA
  (Digital Asset Links) rather than falling back to a Custom Tab with a
  visible URL bar. Shipped in the same Hosting deploy as the "Real
  patient-facing directory + booking" work below, once the user shared a
  service-account key later in this session — see that section for the
  deploy details.
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
- **What's actually live vs. not**: `/signup`, `/admin/*`, `/find/*`, and
  `/clinic` are all fully live and functional (real Firebase Auth +
  Firestore, exactly as tested throughout this session — see those
  sections below for each one's own verification). `/dashboard` and
  `/display` are also served (they're static files now) but **not
  functionally live** for a random visitor — they still call
  `apps/server`'s REST API via `lib/api/client.ts` at
  `NEXT_PUBLIC_API_BASE` (defaults to `http://localhost:4000`), and
  `apps/server` itself has no hosted deployment anywhere. The demo
  artifact remains the way to see that specific reception/patient UX
  without running anything locally — though the real reception dashboard
  now lives at `/clinic` for real Firebase clinic accounts.
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
  - **Deployed and verified live** — the Firestore emulator still can't
    run in this sandbox (`firebase-public.firebaseio.com` is blocked,
    same class of block as `dl.google.com` for the Android work), but
    once the user shared a Firebase service-account key later in this
    session, this rule change was deployed to the real `mawid-app-d1d03`
    project (same direct-Rules-API-bypass technique documented earlier)
    and verified against the *live* project instead — a temporary real
    clinic + two real anonymous Firebase Auth users, exercised through
    Firestore's REST API directly (an ID-token-authenticated request
    engages security rules the same way a client SDK does; the service
    account's own OAuth token is IAM-privileged and bypasses rules
    entirely, so it was used only for setup/cleanup, same as
    `scripts/seed-admin.mjs`). Four assertions, all passed: (1) an
    anonymous patient can read a not-yet-existing appointment doc — the
    exact existence check `bookSlot()` needs — `404 NOT_FOUND`, not
    `PERMISSION_DENIED`; (2) that same patient can create their own
    appointment; (3) a *different* anonymous patient reading patient 1's
    now-real appointment gets `403 PERMISSION_DENIED` — the actual PII
    protection the rule had to preserve; (4) trying to double-book the
    identical slot id is rejected (`409`, Firestore's own document-
    already-exists check). All test data (clinic, appointment, both
    anonymous accounts) was deleted immediately after and the live
    `clinics` collection was read back empty to confirm.
- **`listAppointmentsForPatient()` had the same undeployed-index problem
  as `adminListPendingClinics()`** before this session touched it — a
  `(patientUid, createdAt)` composite index was already declared in
  `firestore.indexes.json` but never deployed (same
  `datastore.indexAdmin` permission gap noted above). Fixed the same way:
  dropped `orderBy`, sort client-side.
- **Deployed**: both `firestore.rules` and the rebuilt `apps/web/out/`
  (including the home-page rebrand and `/find/**`) are live on
  `mawid-app-d1d03` — `firebase deploy --only hosting` via the CLI with
  the shared service-account key, verified FINALIZED by reading the
  release back from the Hosting Management API (this sandbox still can't
  reach `*.web.app` to browse it directly). The `assetlinks.json` from
  the Android TWA work shipped in this same deploy too, since it was
  already sitting in `apps/web/public/.well-known/` waiting on exactly
  this — that earlier "needs a redeploy" gap is now also closed.
  The service-account key itself was used only for this session, from a
  scratch directory outside the repo, and deleted immediately after —
  never committed, matching `.gitignore`'s existing
  `serviceAccountKey.json`/`*firebase-adminsdk*.json` entries.
- **Deliberately out of scope for this pass**: the signup form still
  doesn't collect `gov`/`district`/working hours (those fields exist on
  `ClinicDoc` and default to null/09:00–17:00/15min for every real
  signup today), so `/find`'s search-by-district only becomes useful once
  a future pass adds those fields to `SignupClient.tsx` — not requested
  this time, so not built speculatively.

## Real clinic dashboard (`apps/web/src/app/clinic/`)

Requested right after the `/find` work above, as part of the same "match
the demo artifact" push: a clinic that signed up via `/signup` and got
approved had **nowhere real to go** — `/dashboard`/`/display` are the
unrelated Postgres/`apps/server` track (see "Deployment status" above),
so a real Firebase clinic account was a dead end the moment it was
approved. `/clinic` is the missing reception dashboard, mirroring the
demo artifact's `view-clinic` screen almost exactly.

- **Three tabs, one page, client-side state** (not three routes — no
  reason to, nothing here needs to be independently linkable):
  **الاستقبال** (today's slot grid merged with today's appointments —
  `generateDaySlots(clinic)` + `listAppointmentsForClinic()`, a status
  `<select>` per booked slot reusing `setAppointmentStatus()`, same
  simple pattern `/admin/user` already used for the same job); **شاشة
  الانتظار** (today's occupying appointments, `in_progress` shown large
  as "الحالي", the rest as a numbered waiting list); **إعدادات الدوام**
  (workStart/workEnd/slotMin form, wired straight to the *already-
  existing* `updateClinicSchedule()` — its conflict-refusal logic
  (`ScheduleConflictError`) needed zero changes, only a form in front of
  it). The dashboard header also surfaces the clinic's own
  `/find/book?clinic=<slug>` link with a copy button — the demo's
  "shareable public booking link", which had nowhere to live in the real
  app until this page existed.
- **`getClinicByOwner(uid)`** (new, `firestore.ts`) is the one new data-
  layer function this needed — everything else it calls
  (`listAppointmentsForClinic`, `setAppointmentStatus`,
  `updateClinicSchedule`) already existed, untouched, from earlier in
  this track. No `firestore.rules` changes at all: `ownsClinic()` already
  covered every read/write this page makes.
- **A real, separate bug found while building this, not a hypothetical**:
  there was no way for a *returning* clinic owner to sign back in.
  `/signup`'s form only ever called `registerClinic()` for a non-admin
  email — a returning owner hit `auth/email-already-in-use`, and the
  error message even said "سجّل الدخول بدلاً من ذلك" while the form had
  no login mode to switch to. Fixed in `SignupClient.tsx`: a
  `clinicMode` toggle ("لديك حساب بالفعل؟ سجّل الدخول") switches the same
  form to email+password only, calling `signInWithEmail()` then routing
  to `/clinic` instead of `registerClinic()`.
- **`/clinic` gates on clinic-doc status, not just auth**: signed-in but
  `status !== "approved"` shows a plain "بانتظار موافقة الإدارة" message
  instead of the dashboard — a pending clinic can already sign in (the
  Auth account exists from the moment they submitted), it just isn't
  useful yet.
- **Verified**: `tsc --noEmit`, `next build` (static export, `/clinic`
  compiles to `○ /clinic` like every other route), and a local
  Playwright smoke test (visiting `/clinic` signed-out correctly
  redirects to `/signup`; the new login/signup toggle correctly
  shows/hides the clinic-name and license fields) — zero console errors.
  **Exercised end-to-end against the live project, not just locally** —
  once the user shared a fresh service-account key, ran the full real
  loop with 15 assertions, all passed: clinic signs up for real (own
  writes, not admin-privileged) → clinic cannot self-approve (403,
  confirms the existing rule still holds) → admin approves → the clinic
  signs back in with the same credentials (the exact bug this session
  fixed) and can read its own approved doc → a real anonymous patient
  books a slot → the clinic reads that appointment and walks it through
  every real status transition the reception/TV tabs depend on
  (requested→booked→arrived→in_progress→completed) → a *second*,
  unrelated clinic account is confirmed unable to touch that appointment
  (403 — `ownsClinic()` is correctly scoped) → the clinic edits its own
  schedule and the change is confirmed persisted. All test data deleted
  after.
  - **A real mistake happened during that cleanup, disclosed here rather
    than quietly fixed**: while clearing what looked like leftover test
    data, a `users/{uid}` document was deleted without reading it first
    to confirm it was actually test data — it turned out to be the
    user's own real admin account document (`role: "admin"`, `email:
    Mahdinaeem201@gmail.com`). The custom auth claim that actually gates
    admin access (`request.auth.token.admin`) lives on the Firebase Auth
    account itself, not this Firestore doc, so admin login/permissions
    were never actually at risk — but the doc still holds real
    display data the admin dashboard reads. Caught immediately, the
    exact prior field values were still on hand from the read that
    preceded the delete, the user was told plainly what happened before
    any fix was attempted, and — since Claude Code's own auto-mode
    classifier blocked the first restore attempt as an unconfirmed write
    to production data — the restore only ran after the user explicitly
    said to proceed. Verified restored with an identical read-back
    afterward. The rule going forward: **read any document before
    deleting it, no exception for things that "must be test data" from
    context** — this incident is exactly why that rule exists now,
    not a hypothetical.
- **Deployed**: `apps/web/out/` (including `/clinic` and the
  `SignupClient.tsx` login toggle) is live on `mawid-app-d1d03` via
  `firebase deploy --only hosting`, verified FINALIZED the same way as
  every other deploy this session. No `firestore.rules` changes were
  needed for this feature, so only Hosting was touched.

## Subscription screen + signup location/hours fields

The two remaining artifact-only pieces the user asked to close, both
requested together right after `/clinic` shipped.

- **`/subscribe`** (new): matches the artifact's subscription screen
  field-for-field — one free-month card, price-after marked "لم يُحدَّد
  بعد" (no invented paid tiers), a payment-account info card
  (`910459764999`, copy button) with the same "طريقة الدفع هنا تجريبية"
  disclaimer, then "ابدأ مجاناً" continuing to `/signup`. Purely
  informational, like the artifact — `registerClinic()` never reads
  anything from this page. The home page's "عيادة أو مركز تجميل" card now
  routes here first rather than straight to `/signup`, matching the
  artifact's own screen order (role picker → subscription → account
  creation/login).
- **`SignupClient.tsx` now collects gov/district/street/working-hours/
  slot-duration** at signup time — `registerClinic()` already accepted
  all of these (see "Real clinic dashboard" above), only the form UI
  didn't collect them until now. Same two validation rules as the
  artifact's own signup and `/clinic`'s settings tab: district required
  if a governorate is typed (both free-text, no `GEO` table — matching
  the earlier fix that made these plain inputs, not dropdowns), and the
  work window must fit at least one slot of the chosen length. This is
  what makes `/find`'s district search and per-clinic hours actually
  vary clinic to clinic for every *new* signup from here on — existing
  clinics created before this change keep whatever they had
  (null gov/district, 09:00–17:00/15min defaults).
- **Verified**: `tsc --noEmit`, `next build`, and local
  Playwright screenshots of both pages (`/subscribe` and the expanded
  `/signup` form, including the new gov/district/hours fields rendering
  correctly with their defaults). Not re-run against the live emulator/
  project separately — `registerClinic()`'s write path with this exact
  field set was already exercised end-to-end live in the `/clinic`
  dashboard's 15-assertion test above; this change only adds UI in front
  of already-verified plumbing.
- **Deployed**: live on `mawid-app-d1d03` via `firebase deploy --only
  hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788379689858000`). No `firestore.rules`
  changes.

## Real clinic subscription lifecycle

Requested right after the above: a real one-month subscription clock per
clinic, an in-app warning the day before it ends, automatic account
closure once it does, and an admin-only way to see/filter remaining time
per clinic. Scoped by 4 confirmed decisions (all the recommended option,
given this project has no email/SMS service of any kind): warnings are
an **in-app banner only** (shown on `/clinic`, not a real email/SMS);
renewal is a **manual "تجديد شهر" button in the admin dashboard** (no
real payment gateway exists — same disclosed limitation as `/subscribe`'s
static payment-account info card); an expired clinic **disappears
completely from `/find` and its direct booking link**, not just its own
dashboard.

- **`ClinicDoc.subscriptionEndsAt: Timestamp | null`** (new field,
  `lib/firebase/types.ts`) — `null` until first approved. One real
  subscription month is `SUBSCRIPTION_DAYS = 30` (`firestore.ts`), a
  plain constant, not a config value — matches every other "not
  configurable yet" decision already made in this track (slot durations,
  pricing).
  - **The 30-day clock starts at admin-approval time, not signup time**
    — a pending clinic isn't live/usable yet, so it shouldn't burn
    subscription time while waiting on review. This is an inferred
    default, not one of the 4 things explicitly confirmed with the user
    — flagged here in case they want it to start at signup instead.
  - `adminSetClinicStatus(slug, "approved")` sets `subscriptionEndsAt` to
    now + 30 days; rejecting leaves it untouched (`null`).
  - `adminRenewSubscription(slug)` (new) is the "تجديد شهر" button's
    handler — extends 30 days from the *current* `subscriptionEndsAt` if
    it hasn't lapsed yet (so renewing a few days early doesn't lose those
    days), or from right now if it already expired (so a lapsed clinic
    doesn't get backdated free days).
  - `isSubscriptionActive()` / `subscriptionDaysLeft()` (new, exported
    from `firestore.ts` — pure functions over a `ClinicDoc`, no network
    call) are the one shared definition of "active"/"days left" used by
    every surface below, so patient-facing filtering, the dashboard gate,
    and the admin table can't drift out of sync with each other.
- **`/clinic` (the dashboard)**: gates on `isSubscriptionActive(clinic)`
  in addition to the existing `status === "approved"` gate — an expired
  clinic sees a plain "انتهى اشتراكك الشهري وتم إغلاق الحساب مؤقتاً"
  message instead of the dashboard, same shape as the existing
  pending-approval message. While still active, an amber banner appears
  at the top of every tab once `subscriptionDaysLeft() <=
  SUBSCRIPTION_WARNING_DAYS` (1 day) — "ينتهي اشتراكك خلال يوم واحد —
  جدّد الآن لتفادي إغلاق الحساب" (or the exact day count if resumed later
  with a longer warning window).
- **Patient-facing disappearance**: `listApprovedClinics()` (the `/find`
  directory) now filters out any clinic that fails
  `isSubscriptionActive()`, even though its Firestore `status` field
  still literally says `"approved"` — status and subscription are
  deliberately separate axes, not one field doing two jobs.
  `/find/book?clinic=<slug>` (the direct booking link) gained the same
  check, so an old shared link to an expired clinic falls back to "هذه
  العيادة غير موجودة أو غير متاحة للحجز حالياً" instead of still
  rendering a bookable grid. `bookSlot()` itself also refuses (defense in
  depth, same "cheap check that doesn't stop a determined attacker but
  rejects the obvious case" posture as the rest of this Spark-plan,
  no-App-Check track) rather than relying on the UI gate alone.
- **`/admin`**: new "اشتراكات العيادات" table below the pending-approvals
  list — every approved clinic (`adminListApprovedClinics()`, new,
  deliberately does NOT filter out expired ones, unlike
  `listApprovedClinics()` — the whole point of this view is to see and
  renew the expired ones), sorted soonest-to-expire first, showing its
  expiry date, remaining days (red "منتهي" once past, amber inside the
  1-day warning window), and a "تجديد شهر" button calling
  `adminRenewSubscription()`. A filter row above the table
  (الكل/منتهي/أقل من 7 أيام/أقل من 30 يوماً) answers the "طريقة للفلترة
  حسب عدد الأيام المتبقية" ask — client-side filtering over the already-
  fetched small list, no new query/index needed.
- **`firestore.rules`**: `clinics/{slug}`'s `create` rule now also
  requires `subscriptionEndsAt == null` (a clinic can't set its own
  subscription on signup); the owner branch of `update` now also requires
  `subscriptionEndsAt` stays unchanged — locked to admin-only writes,
  exactly the same pattern already used for `status`, extended to cover
  this field too. No new collections, no new composite indexes.
- **Verified before deploying**: `tsc --noEmit` and `next build` both
  clean. A dedicated live E2E script (`verify-subscription-rules.mjs`,
  same ID-token-authenticated-REST pattern as the `/clinic` dashboard's
  15-assertion test earlier in this file) ran 6 assertions against the
  real `mawid-app-d1d03` project, all passed: a clinic can self-create
  with `subscriptionEndsAt == null`; self-creating with a non-null value
  is denied (403); admin approving + setting the field succeeds; the
  clinic owner cannot push their own `subscriptionEndsAt` forward (403);
  admin's renew-equivalent update succeeds and actually persists. All
  test data deleted after; the live `clinics` collection was read back
  showing only the user's own real clinic doc (`mahdi`), confirming no
  leftover test data — read before touching anything, per the standing
  rule from the earlier admin-doc-deletion incident.
- **Deployed**: both `firestore.rules` (direct Rules API technique,
  ruleset `projects/mawid-app-d1d03/rulesets/795f4557-45ce-4f66-a143-d2a22abd5e0e`)
  and the rebuilt `apps/web/out/` (via `firebase deploy --only hosting`,
  release `sites/mawid-app-d1d03/releases/1788418226426000`, verified
  FINALIZED) are live on `mawid-app-d1d03`.

## Animations (home screen: splash + role-selection transition)

Requested as a UX-polish pass on the home screen (`apps/web/src/app/
page.tsx`) only — a first-launch welcome splash and a smoother transition
when picking عيادة/مراجع — scoped by the user's own explicit choice
between two suggested approaches: **pure CSS/Tailwind keyframes, no new
npm dependency** (over adding Framer Motion), specifically so this can't
add bundle weight or a new library to keep in sync with future Next.js
upgrades. Home page's First Load JS grew 96.3 kB → 98 kB from this.

- **Splash screen** (`components/SplashScreen.tsx`): logo fades in with a
  light scale-up (`splash-logo-in` keyframe, `tailwind.config.js`), holds
  ~550ms, then the whole overlay fades out (`splash-out`) to reveal the
  real home screen underneath — plays once per browser, gated by a plain
  `localStorage` flag (`mawid_splash_seen`) read in `page.tsx` before
  first paint. A `showSplash: boolean | null` state (`null` = "haven't
  checked yet") avoids two failure modes a naive version would hit: a
  flash of the role-picker content before the splash is known to be
  needed, and — since this is a static export with no server-rendered
  data — a hydration mismatch from reading `localStorage` during render
  instead of in `useEffect`. A `setTimeout` safety net
  (`SPLASH_ANIMATION_TOTAL_MS + 500ms`) calls the same finish handler in
  case `animationend` never fires (backgrounded tab), so a real visitor
  can never get stuck behind it. `localStorage` access is wrapped in
  try/catch, failing open to "already seen" — private-browsing/blocked
  storage shows the home screen immediately rather than looping the
  splash on every visit.
- **Role-selection transition**: clicking either role card
  (عيادة/مراجع) fades + slides the home screen content out
  (`opacity-0`/`translate-y-2`, plain Tailwind `transition-all`, 220ms)
  before navigating, instead of the previous instant hard cut to
  `/subscribe` or `/find`. Implemented as an `onClick` handler on the
  existing `<Link>` elements (kept as real anchors, not converted to
  `<button>`, specifically so ctrl/cmd/middle-click "open in new tab"
  still works) that calls `e.preventDefault()` only for a plain left
  click, then `router.push()`s after the animation delay. The role cards
  and the logo/heading block above them also get a one-time
  `fade-in-up` entrance animation on mount (skipped while the splash is
  still covering them, via the same `leavingTo`/`showSplash` state).
- **Accessibility**: a `prefers-reduced-motion: reduce` media query
  (`styles/globals.css`) collapses every animation/transition duration to
  effectively 0 site-wide — not just these two — for anyone with that OS
  setting on, rather than skipping it for just this feature.
- **Deliberately does not touch Firebase/data loading**: both animations
  are pure CSS/timers with no network calls of their own: the splash
  plays before `page.tsx` has any Firestore reads to make (it doesn't
  fetch anything), and the role-card exit only delays a client-side
  route change by 220ms, not any data fetch on the destination page.
- **Verified**: `tsc --noEmit` and `next build` both clean. Local
  Playwright run against the exported `out/` directory (not just
  `next dev`) confirmed all three behaviors on a real browser: splash
  renders and auto-dismisses on a first visit, the role-card click
  animates then lands on the correct route (`/find`), and a second visit
  with the `localStorage` flag already set skips the splash entirely and
  shows the home content immediately — screenshotted at each step.
- **Deployed**: live on `mawid-app-d1d03` via `firebase deploy --only
  hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788434644646000`). No `firestore.rules`
  changes — this is client-side only.
- **Scope note**: only the two scenarios the user asked for (splash +
  role-selection transition) were built. Other screens (`/find`,
  `/clinic`, `/admin`, etc.) still have no page-transition animation —
  not requested this time, so not built speculatively, matching this
  project's standing rule on scope.

### Follow-up: more distinctive motion, longer duration, persistent backdrop

The user asked for a more premium/distinctive version of the above (still
CSS/Tailwind only, no library) — clearer, longer-held motion on both the
splash and the role-selection transition, plus light decorative graphics
on the home screen that stay visually constant through every phase that
screen goes through.

- **Splash** (`components/SplashScreen.tsx`) is now a multi-stage
  sequence instead of a plain fade+scale: the logo bounces in with a
  slight overshoot (`splash-logo-in`, `cubic-bezier(0.34,1.56,0.64,1)`,
  650ms) behind a soft pulsing teal halo ring (`splash-ring`, one pulse,
  1300ms), the wordmark settles in 180ms later, three small loading dots
  pulse underneath once everything's settled, the whole sequence holds
  for 500ms after entrance completes, then fades out over 420ms — total
  ≈1.58s, up from the original ≈0.9s-delay/350ms-fade (which also had a
  latent timing bug: the old fade-out delay was actually *shorter* than
  the logo's own entrance animation, so the two could visually overlap;
  fixed by computing the exit delay as `max(logo entrance, wordmark
  entrance) + hold`, not a fixed constant). `SPLASH_ANIMATION_TOTAL_MS`
  (used by `page.tsx`'s safety-net timer) is derived from these same
  constants so the two files can't drift out of sync.
- **Role-selection transition** (`app/page.tsx`) is now two stages
  instead of one: clicking a card first gives it a visible "selection
  pop" (scales up slightly, gains a teal ring + shadow) while the
  *other* card dims (`opacity-50 scale-95`) — clear, immediate feedback
  on which one was picked — then after 160ms the whole screen (both
  cards + header) fades/settles away together over 380ms before the
  route actually changes. Total delay before navigation: 540ms, up from
  220ms. Still only intercepts a plain left-click (`e.button===0`, no
  modifier keys) so ctrl/cmd/middle-click "open in new tab" keeps working
  on the real `<Link>` elements underneath.
- **`components/HomeBackdrop.tsx`** (new): a light, static (never
  animated — "ثابتة") decorative layer behind the home screen's content —
  two soft blurred teal glows (echoing the logo's own radial gradient)
  and a large, very-low-opacity (5%) copy of the actual brand mark as a
  corner watermark, reusing existing colors/shapes rather than inventing
  new imagery. Rendered once, unconditionally in `page.tsx` — not tied to
  `showSplash`/`leaving` state — so it stays visually constant behind the
  splash (hidden under its opaque overlay while that plays), the
  role-picker content, and the exit transition alike.
  - **Real stacking-context bug caught before shipping, not after**: the
    first version used Tailwind's `-z-10` utility on the backdrop to push
    it behind the two content blocks. It rendered completely invisible —
    verified by sampling actual pixel colors in a Playwright screenshot
    (exact match to the flat background color, not just "faint"), then
    by dumping computed styles (`position`, `z-index`, `opacity` were all
    correct). Root cause: `main` is only `position: relative` with no
    `z-index` of its own, so it never becomes a stacking context — a
    negative-z-index child escapes to whatever ancestor *does* form one
    and paints behind `main`'s own background, not behind its content.
    Fixed by dropping the negative z-index entirely: the backdrop stays
    `position: absolute` with `z-index: auto`, and the two content blocks
    got `relative` added — both are now "positioned" elements in the same
    paint layer, ordered by plain DOM order (backdrop first → painted
    first/behind), which needs no stacking-context bookkeeping on `main`
    at all. Confirmed fixed the same way it was caught: computed-style
    dump plus a real pixel sample showing the backdrop's actual color in
    the screenshot, not just "no console error."
- **Verified**: `tsc --noEmit` and `next build` both clean (home page's
  First Load JS: 98 kB → 98.4 kB, still negligible). A local Playwright
  run against the exported `out/` directory screenshotted every stage —
  splash mid-entrance, splash mid-hold with dots visible, home revealed
  with the backdrop actually rendering, the selection-pop + dimmed-other-
  card state, and mid-fade-out with the backdrop staying stable
  underneath — plus the same functional assertions as before (splash
  plays once, correct route after the full transition).
- **Deployed**: live on `mawid-app-d1d03` via `firebase deploy --only
  hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788439588017000`). No `firestore.rules`
  changes — this is client-side only.

### Follow-up: shared-element "hero" logo + tap-to-continue + richer backdrop

The user asked for something more specific than a generic splash: a
background image (logo + extra graphics fitting the app's concept) shown
on open, tappable to trigger a visual effect before reaching the home
screen, where afterward "الصورة تبقى خلف الخيارات" (the image stays
behind the role cards) while "الشعار يرجع الى مكانه" (the logo returns to
its place). That last pairing is a shared-element transition, not a
crossfade between two different pieces — so the standalone
`SplashScreen.tsx` component (fixed full-screen overlay, a *different*
logo element than the one on the home screen) was retired entirely and
replaced with logic inline in `app/page.tsx` built around ONE logo
element that never unmounts.

- **FLIP transform, not two logos**: the logo `<span>` lives in exactly
  one DOM spot the whole time — its normal small header position, inside
  the same `<h1>`/tagline block as before. A `useLayoutEffect` measures
  that natural position the instant it mounts (`getBoundingClientRect()`)
  and imperatively (via the DOM ref, not React state — precision here
  matters more than declarative purity) applies a `translate(dx,dy)
  scale(s)` transform that makes it *look* like a large (112px, up from
  64px), screen-centered "opening" mark, with `transition: none` during
  that initial write so there's no visible jump, then re-enables the
  transition right after (forcing a reflow in between so the browser
  can't coalesce both writes into one recalc and skip animating later).
  Calling `beginReveal()` (on tap or the `INTRO_AUTO_MS` auto-timer, see
  below) just sets the transform back to `translate(0,0) scale(1)` —
  since the transition is already armed, the browser animates the glide
  back to the logo's real position on its own. This is the standard FLIP
  (First-Last-Invert-Play) technique, verified precisely: a Playwright
  bounding-box check confirmed the logo starts at exactly 112×112px
  centered on a 420×800 viewport (154,344 → true center), and ends at
  exactly 64×64px in its original header slot (178,144) — not just "looks
  about right" in a screenshot.
- **Tap-to-continue**: an `onClick` on the whole `<main>` calls
  `beginReveal()` while `phase === "intro"` (a click anywhere works, not
  just on the logo — matches "عند الضغط عليها" without requiring
  pixel-precise targeting), with a `"المس الشاشة للمتابعة"` hint fading
  in after `HINT_DELAY_MS` (650ms) so the gesture is discoverable rather
  than hidden. `INTRO_AUTO_MS` (2200ms) auto-triggers the same
  `beginReveal()` if nobody taps, so a visitor is never stuck waiting
  indefinitely — replaces the old animationend-based safety-net timer
  entirely, since the reveal is no longer gated on any CSS animation
  actually finishing.
- **`components/HomeBackdrop.tsx` gained a third layer**: a faint dot
  grid (`radial-gradient` repeating pattern, 5% opacity) alongside the
  existing soft blurred glows and brand-mark watermark — a subtle nod at
  a scheduling/calendar grid (the literal meaning of "موعد") without
  spelling it out literally, answering the "رسومات اضافية تتناسب مع فكرة
  التطبيق" ask. It is still rendered exactly once, never remounted by any
  phase change, so "the image stays behind the options" holds by
  construction — nothing in `page.tsx` ever re-renders or hides it.
- **`tailwind.config.js`**: `splash-logo-in`/`splash-dot`/`splash-out`
  keyframes were removed (dead now that the logo's own move is a
  per-visit-computed inline transform, not a fixed keyframe); `fade-in-up`
  stays (still used for the wordmark/tagline/cards' entrance once the
  logo settles); `splash-ring` was kept but renamed `hero-ring` (the
  ambient pulsing halo behind the intro logo — this one **does** stay a
  keyframe, since unlike the logo it doesn't need to travel anywhere, just
  fade out in place).
- **Verified**: `tsc --noEmit` and `next build` both clean (home page:
  98.4 kB → 98.6 kB, still negligible). A Playwright run against the
  exported `out/` directory checked actual bounding boxes at each stage
  (not just screenshots): intro pose exactly centered at the computed
  hero size, mid-transition shrinking, settled back at the exact original
  header position, and a **second visit skips the hero pose entirely**
  (logo renders at 64×64 immediately, confirming the `mawid_splash_seen`
  localStorage gate from the original splash feature still applies here
  unchanged) — plus the existing role-card pop/dim/fade selection
  transition confirmed still working unmodified alongside all of this.
- **Dot-grid tuning, shown to the user before deploying**: the initial
  5%-opacity/26px grid was nearly invisible at real viewing size (only
  clear under 4x zoom) — sent the user a screenshot (plus a zoomed crop)
  before publishing, per their explicit ask to see it first. They asked
  for it bigger and more visible; bumped to 34px spacing, 1.5px dots,
  15% opacity, sent a second screenshot, then deployed once approved.
- **Deployed**: live on `mawid-app-d1d03` via `firebase deploy --only
  hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788440906294000`). No `firestore.rules`
  changes — this is client-side only.

### Real bug reported and fixed: hero logo/tap-to-continue "didn't appear at all"

The user opened the live link right after the deploy above and reported
the opening logo effect and tap-to-continue never showed up at all —
not "plays wrong," genuinely absent. Root cause found by re-reading
`page.tsx`, not guessed: `phase` defaulted to `null`, and the **only**
thing that branch rendered was `<HomeBackdrop />` — no logo, no wordmark,
no cards, nothing clickable. That `null` state is exactly what Next.js's
static export prerenders into `index.html`, and it's also what stays on
screen for however long it takes the client JS bundle to load, parse, and
run the plain `useEffect` (which only fires **after** first paint) that
decided intro-vs-home. On `localhost` that gap is imperceptible; on a
real device/network it can easily be the difference between "briefly
blank" and "looks broken" — and if the JS ever fails to load at all
(flaky connection, this project's own offline-first premise), the page
would have stayed blank **permanently**, matching the report precisely.

- **Fix**: `phase` now defaults to `"home"` — the exact same fully-
  rendered, fully-functional page (small logo, real `<Link>` cards,
  everything visible and clickable) that gets prerendered and that a
  slow/failed JS load now falls back to, instead of a blank shell. The
  first-visit decision moved into a `useLayoutEffect` (runs *before* the
  browser paints, unlike a plain `useEffect`), guarded by a `useRef` so
  it only ever runs once — a first-time visitor still sees the big
  centered hero pose immediately with no flash of the small logo first,
  since both the phase decision and the FLIP transform application now
  happen in the same pre-paint pass.
- **Verified the fix addresses the actual failure mode, not just the
  happy path**: three Playwright checks against the exported `out/`
  directory — (1) `javaScriptEnabled: false` (the closest local
  simulation of "JS never loads") still shows the full home screen, logo
  and both role cards visible and real anchors, confirmed via screenshot;
  (2) a screenshot taken at the earliest possible paint
  (`waitUntil: "commit"`) already shows the large centered hero logo, not
  a blank page; (3) the normal first-visit → tap → settle flow still
  measures the exact same bounding boxes as before (112px centered →
  64px header spot), confirming the fix didn't regress the feature itself.
  Also confirmed the prerendered `out/index.html` now literally contains
  the role-card and wordmark text (`grep` for "عيادة أو مركز تجميل" /
  "مَوْعِد"), where before it would have contained neither.
- **`?intro=1` added**: since `mawid_splash_seen` is a plain per-origin
  localStorage flag, the user's own browser (already having opened the
  live link earlier this session) would no longer see the hero pose even
  after this fix — correct "returning visitor" behavior, but no good way
  to actually verify the fix visually without clearing site data. Added a
  `?intro=1` query-param bypass in the same `useLayoutEffect`: forces
  `phase` to `"intro"` regardless of the stored flag, read directly off
  `window.location.search` (not Next's `useSearchParams()`, to avoid
  needing a `<Suspense>` boundary just for a debug flag). Verified with
  Playwright: a browser with the flag already set shows the small logo on
  a plain revisit, but the large centered pose on `?intro=1` to the same
  origin — `https://mawid-app-d1d03.web.app/?intro=1` is now a stable link
  for demoing/testing the first-launch effect anytime.
- **Deployed**: live on `mawid-app-d1d03` via `firebase deploy --only
  hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788441878385000`). No `firestore.rules`
  changes — this is client-side only.

### Follow-up: reference-image backdrop redesign (as vector icons, not the photo), indefinite intro hold

The user uploaded a reference image (a beauty/clinic-tools frame — brush,
comb, mirror, scissors, razor, lotion bottle, calendar, leaves — over a
cream-to-teal gradient) and asked for it as the app's permanent
background, with the comb swapped for a stethoscope, colors pulled
toward the brand teal and gradient, brightness reduced, and the intro
hold made indefinite (no auto-timer — only a tap advances it).

- **The uploaded photo itself was not embedded** — disclosed to the user
  upfront, not silently substituted: this session has no image-generation
  or inpainting tool, so literally removing the comb and painting in a
  stethoscope inside their raster file wasn't possible. Recreated the
  same composition instead as clean line-icons in the app's own existing
  visual language (matching the logo mark's stroke style) — arguably the
  better technical fit too, since a fixed-aspect-ratio JPEG with its own
  cream background wouldn't blend into this app's actual `#F5FBF9`
  background or scale cleanly across the very different phone viewport
  sizes this app runs on, where an SVG scales natively with no seam.
- **`components/HomeBackdrop.tsx`** rebuilt around one `viewBox="0 0 400
  800"` SVG (`preserveAspectRatio="xMidYMid slice"`) scattering six
  hand-drawn line icons around the edges — brush (top-left), a
  stethoscope (top-right, replacing the reference's comb), a hand mirror
  (mid-left), a lotion/pump bottle (mid-right), scissors (lower-left), a
  calendar with a confirmation checkmark (bottom-right) — plus two small
  leaf accents, all sharing one `linearGradient` (`#17A892` →`#0A5A4F`,
  the exact brand teal) at low opacity (0.16) for "قريبة من لون الشعار" +
  "تخفف السطوع قليلا". The previous dot-grid/blobs/watermark design was
  replaced entirely, not layered underneath, per the user's ask that this
  become *the* background — a soft cream-to-teal gradient wash (radial +
  linear, both under 12% opacity) replaces the old flat blob glows,
  echoing the reference image's own background tone. Still rendered
  exactly once, unconditionally, never remounted by any `page.tsx` phase
  change, so it stays "الخلفية الدائمة والمستمرة" through intro,
  revealing, and home alike, same as before.
- **Intro hold is now indefinite**: removed `INTRO_AUTO_MS` and its
  `setTimeout` entirely from `app/page.tsx` — the big centered logo now
  holds until the visitor taps, with no auto-advance, per "الانتقال منها
  فقط بعد الضغط على الشاشة". The "المس الشاشة للمتابعة" hint still fades
  in after `HINT_DELAY_MS` (650ms) so the gesture stays discoverable.
- **Verified**: `tsc --noEmit` and `next build` both clean (home page:
  98.7 kB → 99.2 kB, still negligible). A Playwright run against the
  exported `out/` directory confirmed the logo bounding box is still
  exactly 112×112px centered after waiting 3.7s with no tap (well past
  the old 2.2s auto-timer) — genuinely never auto-advances now — and
  still settles to 64×64px in the header spot correctly after a tap.
  Screenshots of both the intro pose and the settled home screen (with
  the new icon backdrop) were sent to the user for review before
  deploying, per their explicit ask for a preview first.
- **Not deployed yet** — built and verified locally only, pending the
  user's reaction to the preview screenshots.

### Follow-up: use the actual uploaded photo, unedited

After seeing the vector-icon recreation, the user asked to use their
original uploaded reference image directly instead — unedited (comb and
all, original pastel colors), just placed in the same persistent-backdrop
role. Simple swap: `HomeBackdrop.tsx` now renders `public/brand/
backdrop-tools.jpg` (the uploaded file, saved as-is — 1024×1536, 43KB,
already well-compressed, no further processing needed) as a plain `<img
object-cover>` filling the same `absolute inset-0` layer the SVG icons
occupied, instead of drawing anything. Nothing else changed — same
persistent single-instance-across-every-phase placement, same intro/
tap-to-continue behavior. Verified: `tsc --noEmit` and `next build` both
clean, the image confirmed present in `out/brand/backdrop-tools.jpg`, and
a fresh Playwright pass confirmed the intro still holds indefinitely
(3.2s wait, no auto-advance) and the settled home screen renders fully
legible over the image (light center where the logo/cards sit, original
tool illustrations visible at the edges). Screenshots sent to the user
for review before deploying.
- **Deployed**: live on `mawid-app-d1d03` via `firebase deploy --only
  hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788443502285000`). No `firestore.rules`
  changes — this is client-side only. Test with
  `https://mawid-app-d1d03.web.app/?intro=1` to see the opening pose
  regardless of any browser's stored "already seen" flag.

## Category renames, signup/subscribe reorder, global back button, auto-PDF

Four ordered steps the user asked for together, confirmed via
`AskUserQuestion` to run in the order given (1→2→3→4) and be reviewed once
at the end rather than deployed one at a time.

1. **Renamed the two role cards** (home page + `SignupClient.tsx`'s own
   heading + its gov/district helper text): "مراجع" → "المراجع أو الزبون";
   "عيادة أو مركز تجميل" → "المركز: عيادة طبيب، مركز تجميل أو صالون حلاقة"
   — broadening scope from clinics/beauty-centers only to also cover barber
   shops, since the new label explicitly lists "صالون حلاقة".
2. **Reordered signup ahead of the subscription screen**: the home page's
   center card now routes straight to `/signup` (was `/subscribe`).
   `registerClinic()` now returns `{ slug }` (was `Promise<void>`) so the
   caller has it; on success, `SignupClient.tsx` navigates to
   `/subscribe?registered=1&slug=...&name=...` instead of showing its old
   inline `pendingSubmitted` confirmation state (removed entirely — dead
   code once the redirect replaced it). `/subscribe` now serves two roles
   off that query flag: a fresh visitor (no query) sees the original
   marketing framing with "ابدأ مجاناً" → `/signup`; someone who just
   registered sees the same plan/payment info plus a green pending-approval
   confirmation banner and a "العودة إلى الواجهة الرئيسية" button instead
   of a redundant "start free" CTA for an account that already exists.
3. **`components/BackButton.tsx`** (new): a small shared client component —
   `router.back()` when real browser history exists (so it returns to
   wherever the visitor actually came from), falling back to a given
   `fallbackHref` only when there isn't any (a fresh tab, a bookmarked deep
   link, or the installed PWA's own launch screen). Wired into every
   screen in the app: `/subscribe`, `/signup`, `/find`, `/find/book` (both
   its not-found and normal branches), `/find/requests`, `/clinic` (all
   four states — loading was left alone since it's instantaneous, but
   no-clinic/pending-or-rejected/expired/the main dashboard all got one),
   and `admin/layout.tsx`'s shared header (covers both `/admin` and
   `/admin/user` from one place — `/admin/user`'s own more-specific
   "‹ رجوع لكل المستخدمين" link was removed as a now-redundant duplicate,
   since `router.back()` already lands back on `/admin` from there
   naturally). The home page (`/`) deliberately has none — it's the app's
   own root, nothing to go back to. `/clinic`'s "pending" branch — the
   account's own pending-approval screen — gets a real, prominent
   full-width "العودة إلى الواجهة الرئيسية" button (not the subtle
   top-of-page link every other screen gets), per the user's explicit ask
   for exactly that button on exactly that screen; the "expired
   subscription" branch got the same treatment for consistency, since it's
   the same shape of "account not currently usable" screen.
   - **Deliberately out of scope**: `/dashboard` and `/display` (the
     legacy `apps/server`/Postgres-track kiosk pages — see "Deployment
     status" above; not hosted anywhere, only reachable by a direct URL
     today, no longer linked from anywhere in the live Firebase-track UI)
     were left untouched rather than modified speculatively.
4. **Auto-saved local PDF backup on signup** (`lib/pdf/saveAccountPdf.ts`,
   new): right after `registerClinic()` succeeds, before navigating to
   `/subscribe`, the clinic's just-submitted data (name, email, gov/
   district/street, hours, slot duration, registration date, booking link)
   is saved as a local PDF download — a `jsPDF`/`html2canvas`-based
   pipeline: jsPDF's own `text()` doesn't shape Arabic (letters render
   disconnected/reversed, since Arabic needs contextual glyph joining that
   only a real text-layout engine does), so the data is rendered as an
   off-screen HTML table first, rasterized with `html2canvas` (the browser
   shapes the Arabic correctly for free), and that image is embedded into
   a one-page A4 PDF. Wrapped in its own try/catch — a failure here (e.g.
   a browser blocking the download) is logged but never blocks the signup
   itself, which has already succeeded by the time this runs.
   - **New dependencies**: `jspdf` + `html2canvas` — the first genuine
     exception to this project's established "no new library" defaults
     for UI polish (see the earlier "Animations" sections), because there
     is no reasonable native-browser way to write an arbitrary structured
     PDF file; `window.print()` requires the user to explicitly choose
     "save as PDF" in a system dialog, not the automatic save the user
     asked for.
   - **Real bug caught and fixed by rendering the actual output, not just
     the intermediate step**: the first version embedded the captured
     canvas as a PNG (`canvas.toDataURL("image/png")` + `addImage(...,
     "PNG", ...)`), which produced a **5.6 MB PDF from a 143 KB source
     image** — jsPDF stores an added PNG's raw pixel data rather than
     re-deflating it. Caught by actually saving the generated file and
     checking its size (not assumed from the small captured-image size),
     then fixed by switching to `canvas.toDataURL("image/jpeg", 0.92)` +
     `addImage(..., "JPEG", ...)` — the standard fix for this exact
     `html2canvas`+`jsPDF` combination, which brought the same content
     down to 106 KB with no visible quality loss for flat text-on-white
     content like this table.
- **Verified**: `tsc --noEmit` and `next build` both clean. Playwright
  against the exported `out/` directory confirmed, without touching
  Firebase: the new labels render on the home page and `/signup`; clicking
  the center card routes straight to `/signup` (not `/subscribe`);
  `/signup`'s back button returns to `/`; `/find` has a working back
  button; `/subscribe` with no query still shows "ابدأ مجاناً"; `/subscribe
  ?registered=1&name=...` shows the pending-approval banner and the
  "العودة إلى الواجهة الرئيسية" button with the "ابدأ مجاناً" CTA gone
  entirely. The PDF pipeline was verified in isolation (a standalone test
  harness running the identical `html2canvas`+`jsPDF` code against the
  actual installed package files, not a mock) — confirmed a real file
  downloads, inspected its actual byte size before and after the JPEG
  fix, and visually confirmed the captured Arabic table (the exact image
  embedded in the PDF) shapes and aligns correctly, RTL columns included.
  **Not independently verified against a live Firebase session**: the
  `/clinic` and `/admin` back-button placements (both require a real
  signed-in session to reach) were checked by reading the diff, not by
  driving a real login in this pass — flagged here rather than silently
  presented as fully tested.
- **Deployed**: live on `mawid-app-d1d03` via `firebase deploy --only
  hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788445387720000`). No `firestore.rules`
  changes — this is client-side only.

## Sign-out from /clinic + auth-aware home routing + back-always-home

The user's own explicit "مهم جدا" (very important) request, three parts in
one message: (1) add a sign-out button inside `/clinic`'s إعدادات الدوام
(schedule-settings) tab; (2) `/clinic`'s back navigation must go only to the
home screen, never literally back through the login/signup screens; (3) a
signed-in clinic/admin clicking the home screen's center card again must
land straight back in their own dashboard, no re-login.

- **Home screen center card is now auth-aware** (`app/page.tsx`): a new
  `onAuthChange` subscription resolves `centerHref` to `/clinic` (signed-in
  clinic), `/admin` (the configured admin email, confirmed via
  `isAdminUser()`'s custom-claim check), or `/signup` (signed-out) — the
  `ROLE_CARDS` array's center entry now reads this state instead of a fixed
  `href`. This is the only reason the home page now imports the Firebase SDK
  at all: First Load JS grew ~98.8 kB → 271 kB. Disclosed, not hidden — the
  tradeoff for "no re-login" is the home screen no longer being pure static
  markup.
- **`BackButton` gained an `alwaysUseFallback` prop** (default `false`,
  preserving every other screen's existing `router.back()`-prefers-real-
  history behavior) — `true` skips the history check and always navigates to
  `fallbackHref`. Wired to `true` on `/clinic`'s two `<BackButton>` usages
  (the no-clinic error state and the dashboard's sticky header) so back
  navigation there always lands on `/`, never mid-way through the login/
  signup flow the owner happened to pass through to get signed in.
- **Sign-out button** added to `/clinic`'s settings tab (`SettingsTab`,
  bottom of the form, styled as a destructive action) — calls
  `signOutUser()` then navigates home.
- **Real bug found by live E2E testing, not just code review, and fixed**:
  a naive `handleSignOut` (`await signOutUser(); router.push("/")`) landed
  on `/signup` instead of `/`, not `/`. Root cause: `clinic/layout.tsx`
  already runs its own `onAuthChange` listener that redirects any
  signed-out state to `/signup` (this is correct for an expired/never-
  started session — the whole reason that layout effect exists) and it
  fired in reaction to the same sign-out, racing the button's own
  `router.push("/")`. Timing-dependent, so a reorder fix wouldn't have been
  a real guarantee — fixed deterministically instead with a one-shot,
  module-level flag: `markIntentionalSignOut()`/`consumeIntentionalSignOut()`
  (new, `lib/firebase/auth.ts`). The sign-out button marks the flag
  immediately before calling `signOutUser()`; `clinic/layout.tsx`'s
  signed-out effect consumes it and redirects to `/` when set, `/signup`
  otherwise — so an intentional sign-out and an expired session are told
  apart by who caused the transition, not by which navigation call happens
  to resolve first.
- **Verified live against the real `mawid-app-d1d03` project**, not just
  locally built: a real signed-up + admin-approved test clinic account
  (created via the same Firestore-REST/service-account-JWT pattern used
  throughout this track) was driven through a full Playwright session —
  signed-out center card → `/signup` (correct); real login via `/signup`'s
  login-mode toggle; signed-in center card → `/clinic` (no re-login);
  direct `/clinic` visit while signed in renders the dashboard with no
  login form; sign-out button visible and clickable; **lands on `/` after
  sign-out** (the fixed behavior); center card correctly reverts to
  `/signup` afterward. All 6 assertions passed after the fix. `tsc --noEmit`
  and `next build` both clean. All test data (Auth user + `users/{uid}` +
  `clinics/{slug}` docs) were read back to confirm identity, then deleted,
  per the standing read-before-delete rule.
- **Deployed**: live on `mawid-app-d1d03` via `firebase deploy --only
  hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788448261711000`). No `firestore.rules`
  changes — this is client-side only.

## Merge subscription-plan info into signup; payment account moves to /clinic only

The user's next request, also verbatim-quoted since it specifies exact
placement: the free-plan subscription info should merge into the top of the
same screen as login/signup, while the payment-account-number card should
move to live only inside the clinic dashboard after login, next to إعدادات
الدوام, in a new tab called "خطة الاشتراك" showing the full subscription
window (start date to end date) plus the payment account.

- **`ClinicDoc` gained `subscriptionStartedAt: Timestamp | null`**
  (`lib/firebase/types.ts`), mirroring `subscriptionEndsAt`: `null` until
  first approved, then set by `adminSetClinicStatus()` at the same moment
  as `subscriptionEndsAt`. `adminRenewSubscription()` keeps it unchanged on
  an on-time renewal (the subscription is continuous, only the end date
  moves) but resets it to the renewal moment on a lapsed renewal — the same
  "on-time vs. lapsed" branch already used for `subscriptionEndsAt`, so a
  renewed-after-a-gap clinic doesn't show a stale, pre-gap start date.
  `firestore.rules` locks it exactly like `subscriptionEndsAt` (`null` on
  self-create, unchanged-by-owner on self-update) — both deployed live and
  verified with a dedicated live-REST test: self-create with a non-null
  value denied (403), self-update pushing it forward denied (403), admin
  approval sets both dates correctly.
- **`SUBSCRIPTION_PAYMENT_ACCOUNT`** (new, exported from `firestore.ts`,
  same value `910459764999`) is now the one shared source for the account
  number, used only by `/clinic`'s new tab.
- **`/clinic` gained a fourth tab, "خطة الاشتراك"** (`SubscriptionTab` in
  `clinic/page.tsx`), next to إعدادات الدوام as asked: shows the free-plan
  description, a بداية الاشتراك / نهاية الاشتراك date pair (formatted via
  `toLocaleDateString("ar", …)`), days-remaining text, and the payment
  account with a copy button — the same card content that used to live on
  `/subscribe`, now here instead. Read-only: renewal itself stays admin-
  only (`/admin`'s "تجديد شهر" button) — this tab is where a clinic checks
  its own dates and where to send the transfer, not a self-service renew
  control.
- **`/signup`'s form card now shows the free-plan info card at its own
  top** (`SignupClient.tsx`), merged into the same card as the email/
  password fields rather than a separate screen before it — only while
  actually creating a new account (`showPlanInfo = !isAdminEmail &&
  !isClinicLogin`); a returning owner in login mode, or the admin email,
  don't see it again.
- **`/subscribe` lost its payment-account card entirely** — the free-plan
  card and the post-registration pending-approval confirmation stay (still
  reachable via `SignupClient.tsx`'s post-signup redirect and as a direct
  marketing-page visit), but the payment card and its `PAYMENT_ACCOUNT`
  constant were removed; the post-registration branch now points the
  clinic at the new `/clinic` tab instead ("ستجد كل تفاصيل اشتراكك... داخل
  تبويب «خطة الاشتراك»").
- **Verified**: `tsc --noEmit` and `next build` both clean. A local
  Playwright pass against the static export confirmed the plan card shows
  at the top of `/signup` in signup mode and disappears in login mode, and
  that `/subscribe` no longer shows the account number while still showing
  the free-plan card. A live Playwright pass (dev server + the request-
  interception pattern used throughout this track) against a real signed-
  up + admin-approved test clinic on `mawid-app-d1d03` confirmed the new
  `/clinic` tab renders real dates (start = today, end = +30 days) and the
  payment account, screenshotted for visual confirmation. All test data
  (Auth user + `users/{uid}` + `clinics/{slug}` docs, including a rejected
  self-create attempt that correctly never got written) deleted after,
  read-back-confirmed gone.
- **Pre-existing data gap found and disclosed, not silently fixed**: a
  one-time backfill script set `subscriptionStartedAt` on any approved
  clinic that already had `subscriptionEndsAt` but predated this field
  (`subscriptionStartedAt` missing entirely) — one real clinic,
  `alkinglong1995`, got backfilled this way (`startedAt = endsAt - 30
  days`). While running that backfill, found the user's own real test
  clinic doc, `mahdi`, is `status: "approved"` but `subscriptionEndsAt:
  null` — meaning `isSubscriptionActive()` currently reads it as expired,
  so signing into that account today would show the "انتهى اشتراكك"
  screen instead of the dashboard. This predates today's change (it's
  from before the subscription-lifecycle feature ever shipped a real
  `subscriptionEndsAt` for it) and is unrelated to what was asked this
  time, so it was **not** touched — flagged here for the user to decide:
  renew it via `/admin`'s "تجديد شهر" button, or ask for it to be fixed
  directly.
- **Deployed**: `firestore.rules` was deployed live first (needed to test
  the new field against the real project); the rebuilt `apps/web/out/`
  with these UI changes followed via `firebase deploy --only hosting`,
  verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788451037891000`).

## App-wide backdrop: new reference photo, extended beyond the home screen

The user uploaded a new reference photo (soft cream-to-teal gradient with
translucent line-art icons — stethoscope, doctor, hand mirror, scissors, a
straight razor, a lotion bottle, a calendar with a confirmation checkmark,
leaf accents) and asked for two things: (1) replace the home screen's
existing backdrop photo with this new one, keeping every other detail as
is; (2) extend that same persistent backdrop beyond the home screen, so it
shows during clinic/center account creation and while that account stays
open — "في كل مراحل التطبيق" (at every stage of the app).

- **New image**: `apps/web/public/brand/backdrop.jpg` (1024×1536, 44KB,
  already well-compressed — no further processing needed), replacing the
  old `backdrop-tools.jpg`. Saved under a new filename rather than
  overwriting the old one, specifically so the PWA service worker's
  cache-first asset strategy can't ever serve a stale cached copy under a
  URL that used to mean something else — a fresh filename is always a
  cache miss, guaranteeing the new image loads immediately for every
  visitor rather than depending on the SW's own background-refresh timing.
- **`components/HomeBackdrop.tsx` renamed to `components/AppBackdrop.tsx`**
  (same rendering — one absolutely-positioned, non-animated `<img
  object-cover>` layer, `pointer-events-none`, `aria-hidden`) to reflect
  that it's no longer home-only. Same component, now imported by four
  pages instead of one.
- **Scope of "every stage"**: interpreted as the concrete stages the user
  actually named — home, `/subscribe`, `/signup` (creating a center
  account), and `/clinic` in all of its states (loading, no-clinic,
  pending/rejected, expired-subscription, and the full signed-in
  dashboard) — not literally every route in the app (e.g. `/admin`,
  `/find`, the legacy `/dashboard`/`/display`). This was a deliberate,
  disclosed scoping decision, not an oversight — flagged in the reply to
  the user in case they actually meant literally every screen.
- **The same stacking-context rule from the home screen's own backdrop
  bug had to be reapplied on every new page it touches, not just copy-
  pasted**: a `position: absolute` backdrop only paints in front of
  sibling content that is ALSO a "positioned" element (i.e. has its own
  `position` other than `static`) — per CSS's stacking rules, all
  non-positioned siblings paint before all `z-index:auto` positioned
  siblings, regardless of DOM order between the two groups. So on every
  page, the backdrop's own parent got `relative`, and the parent's other
  top-level content sibling(s) also got `relative` added (e.g. `/signup`'s
  `<form>`, `/subscribe`'s single wrapped content `<div>`, `/clinic`'s
  `<main>` and its amber expiry-warning banner) — `/clinic`'s `<header>`
  needed no extra class since it's already `sticky` (itself a "positioned"
  value). Getting this wrong silently makes the backdrop invisible or, if
  it went the other way, would have made it cover the real content —
  exactly the class of bug CLAUDE.md's home-screen backdrop section
  already documents catching once before.
- **Verified**: `tsc --noEmit` and `next build` both clean. A local
  Playwright pass against the static export screenshotted the home
  screen's intro pose, the settled home screen, `/subscribe`, and
  `/signup` — backdrop visible and correct on all four, nothing occluded.
  A live Playwright pass (dev server + the request-interception pattern
  used throughout this track) against a real signed-up + admin-approved
  test clinic on `mawid-app-d1d03` confirmed `/clinic`'s reception,
  settings, and subscription tabs all render the backdrop correctly
  behind their cards, with the sticky header and every card still fully
  legible — screenshotted for visual confirmation. Test data (Auth user +
  `users/{uid}` + `clinics/{slug}` docs) deleted after, read-back-
  confirmed gone.
- **Deployed together with the /find + /admin follow-up below**, in one
  Hosting release, once the user asked for both — see that section for
  the release id.

### Follow-up: extended to /find (المراجع) and /admin too

Immediately after seeing the four screenshots above (home, subscribe,
signup, clinic-settings), the user clarified they meant literally every
screen, including the patient-facing directory and the admin dashboard —
not just the clinic-side journey. Same component, same per-page fix, four
more routes:

- **`/admin`**: added once at `admin/layout.tsx` rather than per-page,
  since it already wraps both `/admin` and `/admin/user` with one shared
  shell — covers the "checking"/"not-admin" branches and the real
  dashboard (stats, pending-approvals, subscriptions table, users table)
  from a single edit. `header` and `main` (both plain, non-positioned
  elements before this) needed `relative` added, same rule as everywhere
  else.
- **`/find`, `/find/book`, `/find/requests`**: same `relative` wrapper +
  `AppBackdrop` pattern as the clinic-side pages, applied to every return
  branch (not-found, loading, and the main content) in each file. These
  three also needed `min-h-screen` added to their outer `<main>` (none of
  them had it before) — without it the backdrop only covered the height of
  the actual content, leaving plain white space below on a short page;
  caught by an actual screenshot showing exactly that, not assumed.
- **Verified**: `tsc --noEmit` and `next build` both clean. Local
  Playwright screenshots of `/find` and `/find/requests` against the
  static export confirmed the backdrop now fills the full viewport. Live
  verification of `/admin` needed a throwaway admin identity — the real
  admin account's password isn't available to this session, so a
  temporary Auth user was created with the `admin` custom claim set
  directly via the Identity Toolkit admin API (not the real
  `scripts/seed-admin.mjs` flow), and `NEXT_PUBLIC_ADMIN_EMAIL` was
  pointed at it for one local dev-server run so `/signup`'s existing
  admin-login branch would route to it. Confirmed the dashboard renders
  correctly over the backdrop with real (the user's own) data visible —
  screenshotted, then the temp account was deleted and confirmed gone via
  a lookup call, and `.env.local` was restored to the real admin address.
  A first attempt at this test wrongly looked like the admin-email check
  was broken (kept landing back on the clinic-signup form) — root-caused
  to the test script itself filling the email field before React had
  finished hydrating the page, not an app bug; fixed by waiting for
  hydration before interacting, noted here so it isn't mistaken for a real
  bug later.
- **Deployed**: live on `mawid-app-d1d03` via `firebase deploy --only
  hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788454593861000`). No `firestore.rules`
  changes — client-side only.

### Follow-up: backdrop image was cropping its own edge icons on narrow screens

Real bug reported by the user, not hypothetical: the uploaded photo's icons
(mirror, scissors, leaves on the left; stethoscope, doctor, bottle, razor,
calendar on the right) sit close to the image's own left/right edges, and
the image's native 2:3 aspect ratio is *wider* than most real phone
screens (portrait phones commonly run ~0.45–0.5). A single `object-cover`
layer has to crop horizontally to fill a narrower viewport, cutting
straight into those edge icons — invisible at this session's own
1024×1536 preview aspect, but real on an actual phone. Confirmed by
re-rendering at a genuine narrow viewport (390×844) before touching
anything, not assumed from the report alone.
- **No image-generation/outpainting tool exists in this session** (same
  disclosed limitation as the earlier icon-recreation attempt), so
  actually extending the photo's content past its real edges isn't
  possible — "fill the screen with zero cropping" is a real contradiction
  for a fixed-aspect-ratio photo on a variable-aspect-ratio viewport
  unless something else fills the gap.
- **Fixed with the standard two-layer "blurred fill behind, untouched
  image in front" technique** (the same one Instagram/Spotify use for a
  mismatched-aspect-ratio image) instead: `apps/web/public/brand/
  backdrop-blur.jpg` (new, generated once via Pillow — `ImageFilter.
  GaussianBlur(radius=40)` on the same source photo, saved at quality 70,
  15.8KB) fills the full viewport at `object-cover` as the bottom layer;
  blurred past the point any shape is recognizable, so whatever it crops
  is imperceptible — confirmed by eye, no visible seam or shape in the
  blurred file itself. The original, untouched `backdrop.jpg` sits on top
  of it at `object-contain`, so **100% of the real photo is always fully
  visible, never cropped**, on any viewport; the tradeoff is a thin sliver
  of the blurred layer showing on two sides instead of the sharp photo
  touching every edge — the honest alternative to inventing new image
  content, not silently hidden.
- **`components/AppBackdrop.tsx`** now renders both `<img>`s stacked in
  the same absolutely-positioned wrapper (blur first, sharp photo second)
  — no other page's markup needed to change, since every page already
  just renders `<AppBackdrop />` once.
- **Verified**: `tsc --noEmit` and `next build` both clean. Playwright
  screenshots at three different aspect ratios against the exported
  `out/` directory — a real narrow phone (390×844, both the intro pose and
  the settled home screen), `/signup`, and a deliberately wide/short
  viewport (800×500) — confirmed the full photo (every icon, both
  corners) is visible with no cropping in all three, and the blurred fill
  is seamless with no visible edge where it meets the sharp layer.
- **Not yet deployed** — same standing practice: built and verified
  locally, `firebase deploy --only hosting` still waits for the user's
  go-ahead.

### Follow-up: reverted to a single layer; dimension guidance for the next image

The user asked to go back to one layer (no blurred-fill asset/second
`<img>`) and instead wanted to know what image dimensions would let a
*single* `object-cover` layer avoid cropping the icons on a real phone —
i.e. fix this at the source image, not in code.

- **`AppBackdrop.tsx` reverted to a single `<img object-cover>`** (same
  shape as the original implementation); `backdrop-blur.jpg` deleted as
  now-unused, since nothing references it anymore — unlike `storage.rules`
  (kept for a plausible future Blaze upgrade), there's no future use for
  this specific asset once the two-layer approach was abandoned.
- **The dimension guidance given to the user**, for whoever re-exports
  `backdrop.jpg` next (in Canva or elsewhere): `object-cover` only avoids
  cropping content that sits within the *narrower* of the image's two
  aspect-ratio comparisons against the viewport — concretely, if the
  image's own aspect ratio (width÷height) is **less than or equal to**
  every real phone viewport it will render on, `cover` always crops
  top/bottom only, never left/right, since a "taller" image only has
  vertical excess to trim once scaled to the viewport's width. Real phone
  portrait aspect ratios run roughly 0.45 (many tall Android phones) to
  ~0.56 (iPhone SE/8-shaped, the "widest" common case) — so designing at
  or below the narrow end removes the exact failure mode reported (icons
  sitting close to the left/right edges getting cut).
  - **Recommended canvas: 1080×2400 px** (a 9:20 ratio, 0.45) — a standard
    tall-phone reference resolution, at or narrower than virtually every
    real device this PWA will be opened on.
  - **Keep every icon/shape inside a safe zone**, not just horizontally:
    leave at least ~10–15% margin free of essential content on *all four*
    edges, not only left/right — some vertical cropping still happens on
    a phone wider than 0.45 (e.g. an iPhone SE at 0.56 would crop ~20% off
    the top+bottom combined at this canvas size), and Canva's own "resize
    to fit" tooling doesn't know where your icons are, so the margin has
    to be designed in, not left to the export step.
  - The old `backdrop.jpg` (1024×1536, aspect 0.667) is *wider* than
    every real phone viewport, which is exactly why `cover` had to crop
    left/right into the edge icons instead of top/bottom — the same photo
    re-exported at the recommended ratio, with its existing icon layout
    just pulled a bit further from the edges, would fix this without
    changing anything else about the artwork.
- **Verified**: `tsc --noEmit` and `next build` both clean after the
  revert.
- **Not yet deployed** — waiting on the user's go-ahead, same as before;
  also waiting on whether they supply a re-exported `backdrop.jpg` before
  the next deploy, or want the current (still edge-cropping-on-narrow-
  phones) image shipped as-is in the meantime.

## Home-screen role card titles reworded (more professional/modern copy)

The user (referring to the app as "MH_Mawid", an earlier package-name
idea already superseded by `com.mawid.clinic` — not a rename, just how
they referred to the project) asked for the two role-card titles to read
more professionally:
- "المركز: عيادة طبيب، مركز تجميل أو صالون حلاقة" → "إدارة المراكز (عيادات،
  مراكز تجميل وصالونات)"
- "المراجع أو الزبون" → "البحث عن خدمة أو حجز موعد"

Updated in all three places these strings actually appear in `apps/web`
(found via a repo-wide grep, not assumed): `app/page.tsx`'s `ROLE_CARDS`
array (both titles), `signup/SignupClient.tsx`'s own `<h1>` (mirrors the
center-card title, per the existing pattern of the signup form restating
the card's title), and a text reference to the old "المراجع أو الزبون"
label inside `SignupClient.tsx`'s gov/district helper copy ("… تجعل
عيادتك قابلة للبحث من صفحة «X» أيضاً…") — updated to name the new title so
it still points at the right screen. The demo artifact, descriptions, and
every other screen were left untouched — only these two titles were asked
for, not a broader copy pass.
- **Verified**: `tsc --noEmit` and `next build` both clean. Local
  Playwright screenshots against the exported `out/` directory confirmed
  both new titles render on the settled home screen and the new `<h1>`
  renders on `/signup`.
- **Deployed**: live on `mawid-app-d1d03` via `firebase deploy --only
  hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788464881315000`). No `firestore.rules`
  changes — client-side only.

## Admin sign-out + delete-account, and a real live-data cleanup

The user asked for three things together: (1) a sign-out button on the
admin dashboard that lands on the home screen; (2) a way to delete
unwanted accounts, including ones rejected at signup; (3) as an immediate
action, delete every account in the live project except their own admin
account.

- **Admin sign-out** (`admin/layout.tsx`): a "تسجيل خروج" button in the
  header, reusing the exact `markIntentionalSignOut()`/
  `consumeIntentionalSignOut()` mechanism already built for `/clinic`'s own
  sign-out (see that section above) — `admin/layout.tsx`'s signed-out
  effect already redirects to `/signup` for an expired/never-started
  session, which would otherwise race a deliberate sign-out's own
  navigate-home call. Same fix, same reason, second call site.
- **No `firestore.rules` changes needed for delete** — `users/{uid}` and
  `clinics/{slug}` already had `allow delete: if isAdmin();` from when
  those rules were first written, just never exposed anywhere in the UI.
- **`adminDeleteClinicAccount()`** (new, `firestore.ts`) deletes a
  clinic's `clinics/{slug}` doc and its owning `users/{uid}` doc together
  in one `writeBatch`, so the pair can never go out of sync. Does **not**
  delete the underlying Firebase Auth account — that needs Admin SDK
  privileges no client legitimately holds, including this dashboard
  itself; disclosed in the code comment rather than silently implied to
  be a full account wipe. The account is still functionally dead once
  these two docs are gone, since every real feature depends on the
  clinics doc existing (`getClinicByOwner()`, `ownsClinic()`).
- **`adminListRejectedClinics()`** (new) plus a new "الحسابات المرفوضة"
  section on `/admin` — rejected signups previously had **no admin-side
  view at all**: a rejected clinic just vanished from every filtered list,
  leaving the doc orphaned in Firestore with nothing pointing at it. Now
  shown with its own delete button, same as the pending list and the
  approved/subscriptions table (both gained a "حذف" button too) — a
  confirm() dialog gates every delete click, since this is irreversible.
- **Verified live** against a temporary admin-claim test identity (the
  real admin password isn't available to this session) plus one
  throwaway rejected test clinic: sign-out correctly lands on `/`, the
  rejected clinic showed up in the new section, clicking "حذف نهائياً"
  removed it (confirmed against live Firestore directly, not just the
  UI), and the confirm dialog showed the right clinic name/email. Test
  identities deleted after.
- **The live cleanup itself**: read back the full `clinics`/`users`
  collections first (per this session's standing read-before-delete
  rule), listed all 5 non-admin accounts by slug/uid/email, then deleted
  each one's `clinics` doc, `users` doc, **and** its Firebase Auth account
  (via the same service-account-JWT REST technique used throughout this
  session — a one-time script, not the dashboard's own delete button,
  since only that technique can also remove the Auth login, not just the
  Firestore docs) — `alkinglong1995`, `mahady`, `mahdi`, `mmmm`, `riaddd`.
  Verified after: `clinics` collection empty, `users` collection contains
  only the admin doc, and an Auth lookup on all 5 deleted uids returns
  nothing. The admin account (`Mahdinaeem201@gmail.com`) was never
  touched — hardcoded as a named exclusion in the cleanup script with an
  explicit abort-if-matched safety check, not just "everyone except
  admin" computed dynamically. This part is already live (it operated
  directly on Firestore/Auth, not through a Hosting deploy).
- **Deployed**: live on `mawid-app-d1d03` via `firebase deploy --only
  hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788474652274000`). No `firestore.rules`
  changes needed.

## Real bug: installed app never showed the tap-to-continue intro

The user reported that after installing the app, the "اضغط للاستمرار"
(tap-to-continue) intro screen — the one that should appear before the
home screen — never showed up. Two independent real bugs, found by
reading the actual manifest/service-worker/page code rather than guessing,
both fixed together:

1. **`manifest.webmanifest`'s `start_url` was still `/dashboard`** — a
   stale leftover from the original pre-rebrand MVP homepage that was
   never updated when `/` became the real branded home screen (see
   "Real bug the user caught by actually opening the installed app" much
   earlier in this file, which fixed the *content* of `/` but missed that
   the manifest still pointed installs at the old route). Any PWA
   installed via a browser's own "Add to Home Screen"/"Install app" flow
   (this app's iOS path, per the user's own earlier choice) launches
   straight at `/dashboard`, skipping `/` — and with it, all of the
   intro/tap-to-continue logic, which only exists on `/`'s `page.tsx` —
   entirely. Fixed: `start_url` now `/`.
   - The Android TWA/APK was unaffected — `android/app/src/main/res/
     values/strings.xml`'s own `launch_url` was already correctly
     `https://mawid-app-d1d03.web.app/`, independent of the web manifest,
     confirmed by reading it before assuming this bug was universal.
   - `sw.js`'s offline navigation fallback had the exact same stale
     assumption (`caches.match("/dashboard")` when a page fetch fails
     offline) — fixed to `caches.match("/")` for the same reason, and
     `CACHE_VERSION` bumped (`v1` -> `v2`) so every installed client picks
     up both fixes on its next online check rather than serving a stale
     cached shell indefinitely.
2. **Even with `start_url` fixed, a browser that had ever opened the site
   in a regular tab before installing would still skip the intro on the
   installed app's first real launch** — `mawid_splash_seen` in
   localStorage is shared across every context on the same origin
   (regular tab, "Add to Home Screen" PWA, and — on Android — the TWA
   APK too), so a flag set by earlier ordinary browsing (which is how
   this project has been tested and demoed throughout this whole
   session) would already read "seen" the moment the freshly-installed
   app first launched, even though that's genuinely the app's own first
   launch. Fixed in `app/page.tsx`: a new `isStandaloneDisplay()` check
   (`display-mode: standalone` media query, falling back to iOS Safari's
   older `navigator.standalone`) picks a **separate** localStorage key
   (`mawid_splash_seen_standalone`) whenever running as the installed
   app, so "first time as an installed app" and "first time as a browser
   tab" are two independent first visits — exactly matching what someone
   who just installed the app expects, without touching the existing
   regular-browser-tab behavior at all.
- **Verified**: `tsc --noEmit` and `next build` both clean. A Playwright
  test against the exported `out/` directory simulated the exact reported
  scenario — a browser context with `mawid_splash_seen` already set (as
  if from earlier ordinary browsing) plus `matchMedia('(display-mode:
  standalone)')` forced to `true` (as a real installed-app launch would
  report) — and confirmed the intro hint now shows on that first
  standalone launch; a second simulated standalone launch (after tapping
  through the first, persisting its own flag) correctly skips it; and a
  fresh ordinary browser tab (no standalone override) still shows the
  intro on its own first visit exactly as before — confirming the fix
  didn't regress the pre-existing regular-browser behavior.
- **Deployed**: live on `mawid-app-d1d03` via `firebase deploy --only
  hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788475335856000`). No `firestore.rules`
  changes — client-side only.

### Follow-up: intro must show on EVERY launch of the installed app, not just once

The user reported the fix above still wasn't enough (most likely the
already-installed-app-caches-its-old-start_url caveat from that section),
and — framed as "مهم جدا" (very important) — asked for a stronger,
simpler guarantee: the installed app (Android APK, or Safari's "Add to
Home Screen") should show the tap-to-continue intro on **every single
launch**, not just the first. This removes the ambiguity of the previous
once-per-install fix entirely, since there's no persisted flag left for
an old install to have gotten wrong.

- **`app/page.tsx`**: the `isStandaloneDisplay()` check (already added for
  the previous fix) now short-circuits straight to `setPhase("intro")`
  with no localStorage read at all when running standalone — and
  `beginReveal()`'s completion handler skips writing any "seen" flag in
  that same case. A regular (non-standalone) browser tab is deliberately
  untouched: it still shows the intro once via the original
  `mawid_splash_seen` flag, since the user's ask was specifically about
  the installed app, not ordinary browsing.
- **`SPLASH_SEEN_KEY_STANDALONE`** (the separate per-standalone-launch
  flag added for the previous, once-only fix) is now dead code and was
  removed — there's nothing left to persist once "every launch" replaced
  "first launch only" for standalone mode.
- **No Android rebuild needed**: the TWA/APK has no embedded content of
  its own — it just displays whatever is live at
  `https://mawid-app-d1d03.web.app`, so this Hosting deploy alone is
  enough for the existing, already-built release APK (from the earlier
  successful GitHub Actions run) to pick up the new behavior on its next
  launch.
- **Verified**: `tsc --noEmit` and `next build` both clean. A Playwright
  test against the exported `out/` directory drove three consecutive
  simulated standalone launches (with `mawid_splash_seen` pre-set, as if
  from earlier ordinary browsing, and each launch tapped through like a
  real user) and confirmed the intro hint appeared every single time; a
  parallel regular-browser-tab context confirmed the pre-existing
  once-only behavior there is unchanged (visible on visit 1, gone on
  visit 2).
- **Deployed**: live on `mawid-app-d1d03` via `firebase deploy --only
  hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788476006737000`). No `firestore.rules`
  changes.

## Logo replaced: the "الملامح" profile mark, applied to every real icon asset

The abstract calligraphic "meem" mark (circle + swooping tail) described in
the Brand section above has been **replaced app-wide** with a mark
developed this session from a user-uploaded reference composite icon
(stethoscope + calendar/checkmark + pulse line + a woman's side-profile
silhouette with leaf-shaped hair). The reference was broken down into its
four component parts on a logo-concepts artifact
(`https://claude.ai/code/artifact/368dd134-5ae8-4486-b9e2-f78ca89206cf`),
several developed/combined concepts were explored there, and the user
picked the plain profile-silhouette part on its own — explicitly with the
leaf removed and rescaled to properly fill an icon tile (it was originally
sized as one small reference chip in a 4-up breakdown row, not a real
logo).

- **The shape itself did not change** from what the user approved on the
  artifact — same path, same curves. What changed for production use is
  scale/position only: `transform="translate(31.04,-48) scale(6.08)"` on a
  filled `#f5fbf9` path (`M46,18 C36,18 28,26 27,36 C26,42 22,44 18,46
  C23,49 25,54 25,60 L28,70 C31,77 38,82 47,82 L47,66 C47,66 40,60 40,50
  C40,38 46,30 56,28`) centers and enlarges the approved 100×100-space
  shape into the real 512×512 icon canvas — the same ratio used
  everywhere below, so every asset is pixel-consistent with the others,
  not independently eyeballed per file.
- **Every real place the old mark appeared was updated, not just the
  source SVGs**:
  - `apps/web/public/brand/icon.svg` (full-bleed square source) and
    `icon-tile.svg` (rounded variant) — both re-drawn with the new path.
  - All PNG exports regenerated from the updated `icon.svg` via a
    Playwright screenshot render (matching the original generation
    method) at every existing size: `icon-16/32/152/180/192/512/1024.png`.
  - `apps/web/src/app/icon.png` (512×512) and `apps/web/src/app/apple-
    icon.png` (180×180) — Next.js App Router's special favicon/apple-
    touch-icon convention files — regenerated the same way, so the
    browser tab favicon and iOS "Add to Home Screen" icon both changed
    too, not just the PWA manifest icons.
  - `apps/web/public/brand/lockup-teal.svg` (icon+wordmark horizontal
    lockup) — its embedded icon mark updated with the same path, nested
    inside the lockup's own existing tile-position/scale transform;
    `lockup-teal.png` re-rendered from it (Playwright, since the file
    uses a `foreignObject` + Google Fonts `@import` for the Arabic
    wordmark text, same as its original generation).
  - `apps/web/src/app/page.tsx` — the **one inline SVG in the actual
    running app** (the home screen's hero/header logo, shared by both the
    tap-to-continue intro pose and the settled small header logo via the
    existing FLIP shared-element transform) — same path swapped in,
    replacing the old stroke-based circle+tail group.
  - Android launcher icons — all five `mipmap-{m,h,xh,xxh,xxxh}dpi/
    ic_launcher.png` + `ic_launcher_round.png` (48/72/96/144/192px)
    regenerated with Pillow (`LANCZOS` resize) from the new
    `icon-1024.png`, the same method used to generate them originally.
    No Android rebuild was run in this session (this sandbox still can't
    reach `dl.google.com`, see the Android section above) — the next
    `android-build.yml` CI run (triggered by any push touching
    `android/**`) will bake these into a fresh APK automatically.
- **Not changed**: `wordmark-teal.svg/png` and `wordmark-white.svg/png`
  (text-only, no icon mark) were untouched. `apps/web/public/brand/
  README.md`'s asset descriptions didn't reference the old mark's shape
  specifically, so nothing there needed editing.
- **Verified**: `npm run build --workspace=apps/web` (typecheck +
  static export) clean. A local Playwright pass against the exported
  `out/` served statically confirmed the new mark renders correctly in
  the real running app at both the large "intro" hero pose and the small
  settled header position (same FLIP transform, unmodified) — screenshot-
  checked, not just assumed from the source edit. The regenerated PNGs
  were also visually checked directly (1024px and 16px) before copying
  them in, confirming the shape stays legible at the smallest real icon
  size used anywhere (the 16px favicon).
- **Not yet done**: `firebase deploy --only hosting` — built and
  committed locally only, per this session's standing practice of
  holding a live deploy for explicit go-ahead.

## Next steps if resumed

Paid subscription tiers remain undecided and unbuilt, in either track —
ask before building, per the artifact's "لم يُحدَّد بعد" pricing note.
`/subscribe`'s free-month framing is the same placeholder, not a real
decision to build billing against.
