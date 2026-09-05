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
- **Deployed**: live on `mawid-app-d1d03` via `firebase deploy --only
  hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788518884974000`). No `firestore.rules`
  changes — this is client-side/asset only.

## Patient waiting screen (second window after booking) + color-coded statuses

Two requests together: (1) after a patient books, open a second "شاشة
الانتظار" (waiting screen) window for that same clinic/appointment,
alongside the booking window itself; (2) color-code each booking status
in the reception dashboard with a simple matching indicator, the way the
demo artifact already did.

- **Shared status palette, not duplicated per screen**:
  `apps/web/src/lib/firebase/statusMeta.ts` (new) is the one place
  `STATUS_LABEL`/`STATUS_COLOR`/`STATUS_DOT`/`STATUS_PATIENT_MESSAGE` live
  for the Firestore `AppointmentStatus` type, so the reception dashboard
  and the new patient screen can never show a status in two different
  colors. Same `bg-X-100 text-X-800 border-X-300` Tailwind convention
  already used by `@mawid/shared`'s `APPOINTMENT_STATUS_COLORS` (the
  older Postgres/`apps/server` track's own status badge, see
  `components/StatusBadge.tsx`) — extended with `requested` (purple), a
  status the Postgres model has no equivalent for. `components/
  AppointmentStatusBadge.tsx` (new) is the small pill component built on
  it; `/clinic`'s reception table now shows one next to each appointment's
  status `<select>` (which also gained a colored left-border matching
  `STATUS_DOT`) instead of the select being the only signal.
- **`/find/wait`** (new, query-param route: `?clinic=<slug>&appt=<id>`):
  the patient's own live appointment-status screen — a big colored status
  card + a plain-language message per status (e.g. "حان دورك الآن —
  تفضّل عند الطبيب" for `in_progress`, with a small pulsing dot).
  Deliberately scoped to **the patient's own appointment only**, not the
  clinic's full queue — a public "who's currently being seen" screen
  would need a `firestore.rules` change letting any visitor list a
  clinic's appointments for today, which would also hand over every
  other patient's name/phone on that list. Same privacy tradeoff
  `getSlotAvailability()` already avoids for the booking grid (see that
  function's own comment) — this stays inside it rather than reopening
  it, so **no `firestore.rules` change was needed** for this feature at
  all: reading one's own appointment doc was already allowed.
- **Live-updating, not polled**: `watchAppointment()` (new,
  `firestore.ts`) wraps `onSnapshot` on the appointment doc, so the
  screen updates the instant the clinic marks the patient
  arrived/in_progress/completed from `/clinic`'s reception tab — no
  manual refresh. `getAppointmentId()` (new, also `firestore.ts`) just
  exposes the existing deterministic-id builder `bookSlot()` already used
  internally, since the booking page knows clinicSlug/date/startTime but
  `bookSlot()` itself returns `void`, not the new doc.
- **"Two windows" implemented literally**: `find/book/page.tsx` computes
  the appointment id right after `bookSlot()` succeeds and calls
  `window.open("/find/wait?...", "_blank")` — best-effort, since some
  browsers (Safari especially) drop the "real user gesture" grace period
  across an `await`, so this can get popup-blocked. The confirmation card
  also gained a plain "فتح شاشة الانتظار" link/button as the reliable
  fallback either way, not just a backstop for a blocked popup.
- **A real timing edge case, handled not ignored**: a fresh second tab's
  Firebase Auth persisted session (from the booking tab's
  `ensurePatientSession()`) takes a moment to rehydrate from IndexedDB
  even though it's the same browser/origin. `/find/wait` calls
  `ensurePatientSession()` itself before subscribing (idempotent — returns
  the existing anonymous user if already signed in, per its own
  implementation) so the `onSnapshot` read never races an unresolved auth
  state. Opening the same link from a browser that never booked (a
  different device, or a cleared session) correctly gets denied by the
  unchanged rules — there's no patient login system, so that's the same
  expected boundary as everywhere else in this track.
- **Two real, previously-undiscovered bugs found by the live E2E pass
  below, not by code review alone** — both fixed before deploying:
  1. **Every slot on `/find/book` showed as unavailable for a
     brand-new visitor** (not just this session's test clinic — this
     was already live in production). Root cause:
     `getSlotAvailability()`'s per-slot existence checks rely on
     `firestore.rules`' `(isSignedIn() && resource == null)` clause,
     which — as its name says — still requires `isSignedIn()`. The
     booking page only ever called `ensurePatientSession()` at
     confirm-time, never before loading the grid, so a visitor who had
     never booked anything yet (no anonymous session established) had
     every single slot's existence check denied outright and
     misread as "taken" — every slot line-through, forever, for that
     visitor. **Confirmed as a real regression, not assumed**: reverted
     the fix, re-ran the exact same live test against the real project,
     watched every slot stay unavailable after a 20-second wait; restored
     the fix, re-ran, all slots came back available. Fixed by calling
     `ensurePatientSession()` (idempotent — a no-op for a returning
     visitor who already has a session) before `getClinic()`/
     `reloadAvailability()` fire, not just before the final booking write.
  2. **`/find/wait` hung on "جارٍ التحميل" forever for anyone who
     wasn't the booking patient**, instead of falling back to its
     not-found state. `watchAppointment()`'s `onSnapshot()` call had no
     error callback — a `permission-denied` (the exact, correct outcome
     for a different patient trying to read someone else's appointment)
     just logged to the console and silently stopped delivering updates,
     leaving `onChange()` never called again. **The privacy boundary
     itself was never broken** — rules correctly denied the read in
     every case — this was purely a UX bug in how the denial was
     handled client-side, but a confusing one (an infinite spinner
     instead of an honest "not found"). Fixed by adding an error
     callback to `onSnapshot()` that calls `onChange(null)`, so any
     denied/failed read now falls back to the same not-found UI a
     nonexistent appointment id already showed.
- **Verified end-to-end against the live `mawid-app-d1d03` project**,
  not just locally: a temporary approved test clinic (`e2e-wait-test`,
  created directly via the service-account/Firestore-REST technique used
  throughout this session, deleted after) was exercised through the real
  running app (`next dev` + the Firebase-domain Playwright interception
  pattern used elsewhere in this file) — a real anonymous patient booked
  a real slot, the second window opened and showed the correct initial
  "بانتظار تأكيد" status, the appointment's status was then changed
  server-side to `in_progress` and the **already-open** second window
  updated to "عند الطبيب" with no page refresh (the core live-update
  claim, actually observed, not assumed from the code), and a second,
  unrelated anonymous patient opening the same wait-screen URL was
  correctly shown "تعذّر العثور على هذا الحجز" rather than any of the
  first patient's data. All test data (the clinic doc and both
  appointment docs created during the run) were deleted after and the
  live `clinics` collection was read back showing only the user's own
  real clinic doc (`mahdi`) — read-before-delete, per the standing rule.
  The seven status badge colors were also rendered directly against the
  app's own compiled Tailwind CSS and confirmed visually distinct.
- **Deployed**: live on `mawid-app-d1d03` via `firebase deploy --only
  hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788522793839000`). No `firestore.rules`
  changes — every fix here was client-side (the rules were already
  correctly strict; the bugs were in how the app called/handled them).

## Reception dot-only status, smoother waiting-screen entry, and a real schedule-save bug

Three follow-ups to the waiting-screen/status-color work above, all
requested together.

- **Reception table: dot instead of a text badge**. The colored badge
  next to the status `<select>` (added in the previous pass) duplicated
  the select's own text, per the user's explicit "بدون كلمة داخلها لان
  الخيار موجود" — replaced with a plain 10px colored dot (`STATUS_DOT`,
  `title` attribute for a hover tooltip) in `clinic/page.tsx`'s
  `ReceptionTab`. `AppointmentStatusBadge` (the text pill) is untouched
  and still used as-is on `/find/wait`, where there's no adjacent select
  to make the text redundant.
- **`/find/book` now guarantees getting the patient to `/find/wait`,
  not just best-effort**. The previous `window.open()`-only approach
  routinely fails on real devices: most mobile browsers (and any in-app/
  PWA webview) drop the "real user gesture" popup allowance the moment an
  `await` runs first, and `handleConfirm()` has two before ever calling
  `window.open()`. Kept that call as a harmless bonus, but the actual
  guaranteed path is now a same-tab transition: the confirmation banner
  shows for 1.4s ("جارٍ الانتقال إلى شاشة الانتظار…"), fades out over
  300ms (`transition-opacity`, matching the fade/slide pattern already
  used elsewhere in this app, e.g. the home screen's role-card exit), then
  `router.push()`s to `/find/wait` — no popup permission needed, nothing
  to miss. The card's manual link became an immediate "الانتقال الآن"
  button (same-tab navigation, not `target="_blank"`) for anyone who
  doesn't want to wait the 1.4s.
- **"مدى اكتمال الحجوزات" (today's booking fullness)** now shows on
  `/find/wait` itself — a small "N من M" stat + progress bar under the
  status card. Computed with the exact same privacy-safe technique
  `getSlotAvailability()` already uses for the booking grid (per-slot
  existence checks, never a real query over other patients' data) — no
  new data exposure, no `firestore.rules` change, just re-running that
  same check against the appointment's own clinic/date once `/find/wait`
  has both loaded.
- **Real, previously-broken bug fixed: saving إعدادات الدوام (schedule
  settings) failed on every attempt**, not just sometimes. Root cause:
  `updateClinicSchedule()`'s conflict-check query filtered
  `where("clinicSlug","==",slug)` **and** `where("date",">=",todayISO)` —
  an equality clause plus a range clause on a different field, which
  needs a composite index. That exact index (`clinicSlug ASC, date ASC,
  startTime ASC`) **is** declared in `firestore.indexes.json`, but — like
  every composite index in this project — was never actually deployed,
  since the service account still lacks `datastore.indexAdmin` (the same
  documented gap `adminListPendingClinics()` and
  `listAppointmentsForPatient()` already hit and were fixed for, earlier
  in this file). So every real save threw Firestore's "this query
  requires an index" error, caught by `handleSave()`'s generic catch
  block and shown as an opaque error message — not the friendly
  `ScheduleConflictError` message, and never actually saving anything,
  regardless of what was typed. **Fixed the same way those two were**:
  dropped the `date` range clause from the query (now just
  `clinicSlug == slug`, a single-field filter that needs no composite
  index at all) and moved the `date >= todayISO` filtering into the
  existing client-side `.filter()` alongside the status/slot-time checks
  — the result set is one clinic's appointments, small enough that this
  costs nothing extra at this app's scale, same tradeoff already accepted
  throughout this track.
- **Verified end-to-end against the live `mawid-app-d1d03` project**, all
  three fixes, not just build-clean: a temporary clinic (`e2e-settings-
  test`) with a **real email/password clinic-owner account** (not an
  admin-privileged bypass — the same login path any real clinic owner
  uses) was created, then driven through the actual running app:
  1. Signed in via `/signup`'s login-mode toggle, opened إعدادات الدوام,
     changed the hours, clicked حفظ — "تم الحفظ" appeared with no error,
     and the new hours were confirmed **persisted** by reading the
     `clinics/e2e-settings-test` doc directly afterward (workStart/
     workEnd genuinely changed server-side, not just a UI success message
     that didn't actually write anything).
  2. A real anonymous patient booked a slot on that clinic and was
     **auto-navigated to `/find/wait` with zero clicks** — confirmed by
     watching the tab's own URL change on its own after the confirmation
     pause, landing on the correct live status card ("بانتظار تأكيد")
     with the "١ من ٣٤" booking-completion stat rendering correctly.
  3. The reception table (`/clinic`, الاستقبال tab) showed the new
     appointment with a plain colored dot next to its status select —
     confirmed visually, no redundant text badge.
  All test data (the clinic doc, its owner's `users` doc, its
  appointment, and the owner's Firebase Auth account) were deleted after
  and the live `clinics` collection was read back showing only the
  user's own real clinic doc (`mahdi`) — read-before-delete, per the
  standing rule.
- **Deployed**: live on `mawid-app-d1d03` via `firebase deploy --only
  hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788526852746000`). No `firestore.rules`
  changes.

## Patient local session: entry gate, auto-resume, sign-out, active-booking shortcut

A large, explicitly-specified request: give the مراجع (patient) side a
"session" so a returning visitor doesn't retype their info every time,
with a sign-out control and specific back-navigation behavior. Scoped by
the request's own explicit instruction to use **local storage** — so
this is a per-browser convenience layer built on top of the existing
anonymous-patient architecture, not a new backend account system. That
matters because it was already explicitly decided (and documented above,
"Two-sided product direction") that **patients never get a real account,
anonymous forever** — this feature doesn't reopen that decision, it just
adds a UX layer in front of it.

- **`lib/patientLocal.ts`** (new): plain `localStorage` helpers for a
  `PatientProfile` (`name`, `phone`, `pin`) and an `ActiveBooking`
  pointer (`clinicSlug`, `clinicName`, `apptId`, `date`, `startTime`).
  **The PIN has no server-side verification at all** — it's a locally-
  stored field only, collected once and never checked against anything.
  Disclosed here rather than implied to be real security, the same way
  this project has always flagged its other local-only/no-backend-check
  limitations (e.g. the demo artifact's plaintext passwords).
- **`/find` gained an entry gate**: a first-time visitor sees a small
  "إنشاء حساب سريع" form (اسم / رقم هاتف / رمز PIN من 4 أرقام) before the
  clinic search UI renders at all. Submitting saves the profile to
  `localStorage` and reveals the search UI in the same render pass (no
  route change, so browser history isn't affected) — see `PatientGate`
  in `find/page.tsx`. A returning visitor with a saved profile skips this
  entirely and lands straight on the search UI, satisfying "يدخل إلى
  حسابه المسبق مباشرة... دون إعادة طلب معلومات التسجيل" by construction.
- **`components/PatientAccountBar.tsx`** (new): "مرحباً {name}" + a
  "تسجيل خروج" button, shown on `/find`, `/find/wait`, and
  `/find/requests`. Clicking sign-out opens a small centered confirm
  popup (custom-built, not a native `confirm()`, for consistent styling)
  with "تأكيد الخروج" / "إلغاء" — confirming calls
  `clearPatientSession()` (wipes both the profile and the remembered
  active booking) and navigates home, the same "clear + land on `/`"
  convention `/clinic` and `/admin`'s own sign-out buttons already use.
- **`/find/book` prefills from the saved profile** (still editable, in
  case the booking is for someone else) instead of asking again, and
  saves an `ActiveBooking` pointer to `localStorage` the moment a booking
  succeeds.
- **"موعدك الحالي" card on `/find`**: when an `ActiveBooking` pointer
  exists, a prominent card above the search box links straight into
  `/find/wait` for it — the "البقاء عليها أو الرجوع إليها بسلاسة" ask,
  answered without a Firestore query (the pointer alone is enough to
  build the link). `/find/wait` clears that pointer once the appointment
  reaches a terminal status (`completed`/`cancelled`/`no_show`) via its
  existing live listener, so a finished visit stops being offered as
  "your current booking."
- **Navigation stack**: turned out to already match the requested
  behavior with no changes needed, once verified rather than assumed —
  `BackButton`'s existing `router.back()`-prefers-real-history behavior
  already sends `/find` → `/` and `/find/book`|`/find/wait`|`/find/
  requests` → `/find` (unchanged fallbacks), and since the new gate is a
  conditional render inside `/find` rather than a separate route, it
  never adds an extra history entry to skip over.
- **Verified, not just built**: `tsc --noEmit` and `next build` both
  clean. A full Playwright pass against the exported `out/` directory
  drove the entire flow — fresh visit shows the gate; submitting it
  reveals the account bar; a reload skips the gate (profile persisted);
  clicking the home screen's search card a second time lands directly on
  `/find` with no gate (real link-based navigation, not just direct URL
  loads, to exercise the actual back-button/history path a visitor would
  take); sign-out shows the confirm popup, clears storage, and lands on
  `/`; the gate reappears on the next visit after that. The "موعدك
  الحالي" card was checked by seeding a fake `ActiveBooking` pointer
  directly. Not re-run against a live booking end-to-end this pass (no
  service-account key on hand for this change) — the booking/prefill/
  active-booking-save code paths reuse `bookSlot()`/`ensurePatientSession()`
  unchanged, so risk is concentrated in the new local-only UI, which is
  what was actually exercised live above.
- **Not yet deployed** — built and committed locally only, per this
  session's standing practice of holding a live deploy for explicit
  go-ahead.

## Patient sign-out made non-destructive; shared confirm popup; gate copy trim

Three corrections to the patient local-session work above, all requested
together.

- **Gate heading trimmed**: "إنشاء حساب سريع" → "إنشاء حساب", and its
  one-line description ("بيانات بسيطة تُحفظ على جهازك فقط...") removed
  entirely, per the user's explicit "لا حاجة لها".
- **Sign-out is no longer destructive** — this is the real behavior
  change. Previously `clearPatientSession()` wiped the stored profile
  and active-booking pointer outright, so signing out and then "logging
  back in" always created a brand-new, empty local account — exactly
  what the user said they didn't want. `lib/patientLocal.ts` now
  separates *stored* data from *active session*:
  - The profile and active booking stay in `localStorage` forever (until
    overwritten — see below), untouched by sign-out.
  - A separate `mawid_patient_session_active` flag is what actually
    gates whether `/find` shows the account or the gate.
    `signOutPatient()` clears only this flag.
  - `beginSession(input)` (what the gate calls on submit) compares the
    typed name/phone/PIN against whatever's already stored: an exact
    match resumes that same stored profile *and its active booking* untouched
    — this is the PIN's actual purpose, not just a field to fill in. A
    non-match (or nothing stored yet) overwrites with the newly-typed
    profile and clears any previous active booking, since that booking
    belonged to a different identity on this device.
  - This means a plain "sign out, don't retype anything" visit still
    shows the gate again (a real session boundary, as asked for), but
    signing back in with the *same* details is invisible to the user —
    their account and current booking are exactly as they left them.
- **One shared confirm popup for every sign-out button in the app**:
  `components/ConfirmPopup.tsx` (new, generic: title/message/confirm/
  cancel) replaces `PatientAccountBar`'s own inline modal and is now also
  wired into `/admin`'s and `/clinic`'s sign-out buttons, which
  previously signed out immediately with no confirmation at all — per
  the user's explicit ask to have the same one-click confirm step
  everywhere, not just on the patient side.
- **Verified, not just built**: `tsc --noEmit` and `next build` both
  clean. A Playwright pass against the exported `out/` directory drove
  the actual scenario this was about: create a profile + seed an active
  booking, sign out, confirm the gate reappears (not an empty page or an
  error), re-enter the *same* name/phone/PIN and confirm both the
  account *and* the active-booking card come back exactly as before;
  separately, signing out and entering *different* credentials correctly
  starts a fresh profile with no leftover booking from the previous
  identity. The admin/clinic confirm-popup wiring is mechanical reuse of
  the same already-verified component and wasn't separately re-tested
  live (needs an authenticated session) — flagged rather than assumed.
- **Deployed**: live on `mawid-app-d1d03` via `firebase deploy --only
  hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788531610801000`). No `firestore.rules`
  changes — this is client-side/local-storage only.

## Patient gate: signup/login toggle (real phone+PIN authentication)

The gate on `/find` gained a second side — "إنشاء حساب" or "تسجيل دخول",
same toggle-link pattern already used by `/signup` for clinic accounts
(`clinicMode`/"لديك حساب بالفعل؟ سجّل الدخول").

- **`loginWithPhoneAndPin(phone, pin)`** (new, `lib/patientLocal.ts`):
  the "تسجيل دخول" side asks only for phone + رمز المرور, no name field —
  a returning patient shouldn't have to retype what's already stored.
  Matches against whatever profile is already saved on this device; a
  match activates the session (the stored active booking, if any, stays
  untouched); a mismatch returns `null` and the gate shows "رقم الهاتف أو
  رمز المرور غير صحيح" rather than silently creating a blank account
  under the "login" label — unlike the signup side, this one is meant to
  actually assert an identity, not just collect one.
- **"إنشاء حساب" is unchanged** — still name+phone+PIN via `beginSession()`
  (exact-match resume, otherwise fresh profile), per the earlier pass.
- **Verified**: `tsc --noEmit` and `next build` both clean. A Playwright
  pass against the exported `out/` directory drove the real scenario:
  create an account, sign out, switch to تسجيل الدخول (confirms the name
  field is gone), submit wrong credentials (confirms the error message),
  then the correct phone/PIN (confirms it logs back into the same
  account) — screenshotted for a visual check too.
- **Deployed**: live on `mawid-app-d1d03` via `firebase deploy --only
  hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788532533262000`). No `firestore.rules`
  changes — this is client-side/local-storage only.

## Home role-card descriptions removed; direct booking links now gate too; back-button fix

Three more corrections, all requested together.

- **Home screen role cards**: the one-line description under each title
  ("سجّل مركزك لإدارة الحجوزات..." / "ابحث عن مركزك واطلب موعدك مباشرة...")
  removed entirely — `ROLE_CARDS` in `app/page.tsx` now carries only
  `id`/`href`/`title`, per the user's explicit ask to keep just the
  titles.
- **`components/PatientGate.tsx`** (new): the patient identity gate
  (إنشاء حساب / تسجيل دخول) extracted out of `find/page.tsx` into its own
  component, taking a `backHref` prop — needed so `/find/book` could
  reuse the exact same gate rather than duplicating it.
- **Real gap closed: a clinic's own shared public booking link
  (`/find/book?clinic=<slug>`) used to skip the patient account
  entirely**, landing straight on the slot grid with no identity at all
  — inconsistent with `/find`'s own gate, and the reason "طلباتي"/the
  active-booking pointer never really worked for a patient who only ever
  arrived via a shared link. `/find/book` now checks
  `getPatientProfile()` on mount exactly like `/find` does: no session →
  render `<PatientGate backHref="/" .../>` first (prefilling name/phone
  from whatever's returned), *then* load the clinic and slot grid.
- **Real, previously-reported bug fixed: `/find/book`'s back button
  needed a page refresh to actually reach its destination.** Root cause:
  its `BackButton` relied on the default `router.back()`-prefers-real-
  history behavior, which — like `/clinic`'s own back button hit and
  fixed the same way earlier in this file — can't be trusted on a route
  that's routinely the *first* page in a tab (a shared clinic link opened
  fresh). Fixed the same way: both `BackButton` usages in `find/book/
  page.tsx` (the not-found state and the main booking view) now pass
  `alwaysUseFallback`, so "رجوع" is a plain, immediate `fallbackHref`
  navigation every time — no history-length heuristic, no dependence on
  how the page was reached. The gate's own back button (in
  `PatientGate.tsx`) is `alwaysUseFallback` too, going straight to `/`
  — appropriate since arriving via a direct clinic link never visited
  `/find`'s search page to go back to.
- **Verified, not just built**: `tsc --noEmit` and `next build` both
  clean. A Playwright pass confirmed the home screen's cards show only
  their titles now. A second pass (dev server + the Firebase-domain
  interception pattern used throughout this file, since this needed a
  real `getClinic()` read) drove the actual reported bug: opened
  `/find/book?clinic=<a real nonexistent slug>` fresh, submitted the
  gate, landed on the not-found state, clicked "رجوع للبحث" **on the
  first try with no refresh** and landed on `/find` — confirming the fix
  — then reloaded the same booking URL and confirmed the gate is
  correctly skipped the second time (session already active from the
  first visit).
- **Deployed**: live on `mawid-app-d1d03` via `firebase deploy --only
  hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788533568407000`). No `firestore.rules`
  changes — this is client-side only.

## Real bug: home screen's role cards invisible after "رجوع" from /signup or /find

Reported with a screenshot: pressing "رجوع" from either the clinic
account-creation screen or the patient account-creation screen landed
back on `/` with the logo/wordmark/subtitle all visible but **both role
cards completely gone** — fixed only by a manual refresh of the home
screen. The previous attempt at a back-button fix (the `alwaysUseFallback`
pass earlier in this file) addressed a different route's back button
entirely and didn't touch this.

- **Root cause, found by reading the animation code, not guessed**:
  clicking a role card (`handleRoleClick` in `app/page.tsx`) sets
  `leaving=true` (which drives every card's `opacity-0 scale-95
  translate-y-3` exit class) *before* `router.push()` actually navigates
  away — and nothing ever reset that state back to `false`. Two different
  real mechanisms can then hand that exact stale `leaving=true` back to
  the visitor on "رجوع", both producing the identical symptom (a hard
  refresh fixes it because that forces a genuinely new mount with
  `leaving` back at its default):
  1. Next's client-side router can reuse this component instance from its
     router cache on `router.back()` instead of remounting it fresh — a
     mount-only effect would never re-run to reset the stale state.
  2. Real mobile browsers routinely serve a same-origin back-navigation
     straight from the **back-forward cache (bfcache)** — a literal
     frozen snapshot of the JS heap/DOM taken at the instant the visitor
     left, mid-animation, thawed back byte-for-byte on return.
- **Fixed with two listeners, not one, to close both**: a `popstate`
  listener resets `leaving`/`selectedHref` for the router-cache-reuse
  case; a `pageshow` listener (checking `event.persisted`, the flag a
  real bfcache restore sets) resets it for the bfcache case. Both are
  registered once in a mount effect and just flip the same two pieces of
  state back to their defaults — no interaction with anything else on the
  page.
- **Verified, not just built**: `tsc --noEmit` and `next build` both
  clean. A Playwright pass against the exported `out/` directory drove
  the literal reported scenario (tap a role card, click "رجوع", check
  the cards immediately with no refresh) for both `/find` and `/signup`
  — computed `opacity` read back as `1` in both cases, not just "visible"
  by Playwright's own heuristic. Since this sandbox's headless Chromium
  didn't reproduce the freeze on its own (bfcache eligibility differs
  under automation), the fix's actual reset mechanism was confirmed
  directly instead: manually froze a card mid-exit-animation (real
  computed opacity ≈0.18, captured on purpose before the fade
  completed), dispatched a synthetic `pageshow` event with
  `persisted: true` exactly as a real bfcache restore would, and
  confirmed the opacity immediately started climbing back toward `1`
  (the CSS transition actually re-engaging), proving the reset code
  path itself works correctly independent of which real mechanism
  triggers it on an actual phone.
- **Deployed**: live on `mawid-app-d1d03` via `firebase deploy --only
  hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788534499449000`). No `firestore.rules`
  changes — this is client-side only.

## Universal Patient Passport — QR-code medical archive

A large new feature requested by name: "الأرشيف الطبي الموحد للمراجع عبر
QR Code". Scope was narrowed by two explicit `AskUserQuestion` decisions
before any code was written, both because the obvious "full spec"
implementation would have immediately hit walls this project already
knows about:

- **Text-only record, no file storage this pass.** Lab_Reports_URLs[]/
  X-ray/PDF uploads need Firebase Storage, which (see "Pivoted away from
  Firebase Storage entirely" above) requires the paid Blaze plan even to
  enable — the user chose to build only the text-based
  Medical_History/Previous_Prescriptions record for now and defer file
  storage until a Blaze decision is made.
- **Patient_ID stays the existing unverified local identity, not real SMS
  verification.** Real Firebase Phone Auth (SMS OTP) was the first choice
  discussed, but turned out to hit the *exact same* Blaze-plan wall as
  Storage — Google requires Blaze to send real SMS in production, even
  within Blaze's own free quota. Told to the user before writing any auth
  code (not discovered mid-build like the Storage case was); they chose
  to stay on Spark and keep the existing anonymous-auth-based identity
  rather than adopt Blaze for this. **Disclosed limitation, not hidden**:
  "Patient_ID" is the patient's Firebase Anonymous Auth uid — the same
  identity `ensurePatientSession()`/`bookSlot()` already use for
  appointments — so it is only as trustworthy as "whoever currently holds
  this anonymous browser session," exactly like every other patient-side
  identity in this app. A real clinical deployment would need real
  identity verification; this is a working prototype of the QR/consent/
  access-grant mechanics on top of today's identity layer, not a claim
  that the identity itself is medical-grade.

### Data model (`apps/web/src/lib/firebase/types.ts`, `firestore.ts` → new `passport.ts`)

No Cloud Functions exist anywhere in this project (Cloud Functions itself
requires Blaze to deploy at all, same family of constraint) — so, like
everything else in this Firebase track, the whole feature is client SDK +
`firestore.rules` only, no server-signed tokens:

- **`patient_records/{patientId}`** (patientId == the patient's own auth
  uid, doc id) — just a profile doc (`fullName` + timestamps). Medical
  history/prescriptions are **not** arrays on this doc — Firestore
  security rules can't express "this array write only appended, never
  edited an existing element," so instead:
- **`patient_records/{patientId}/entries/{entryId}`** — one immutable
  document per history note or prescription/report
  (`type: "history"|"prescription"`, `text`, `authorType: "patient"|
  "clinic"`, denormalized `clinicOwnerUid`/`clinicSlug`/`clinicName` when
  clinic-authored). `firestore.rules` denies `update`/`delete` to
  everyone but admin — a correction is a new entry, never an edit of an
  old one, which is what actually makes "the doctor gets read-only access
  to the old archive" true rather than just a UI convention.
- **`access_requests/{requestId}`** — the QR code's own short-lived (5
  minute) claim ticket, random id. This is the closest thing to "a
  temporary signing key" this project can build without a backend: the
  id's randomness + a tight expiry are the actual security, not
  cryptographic signing. A patient creates one when tapping "إظهار رمز
  الدخول"; a clinic "claims" it by scanning, which is what surfaces the
  approve/deny prompt on the patient's own still-open screen — there's no
  push notification system in this app (see the SMS/Storage disclosures
  above — same "no paid backend service" posture), so approval only works
  while the patient's own device is present and listening
  (`onSnapshot`), which matches the real physical scenario ("show the
  clinic your phone screen") this feature is actually for.
- **`access_grants/{patientId}_{clinicOwnerUid}`** — the actual
  permission a clinic's read access depends on, deterministic id (same
  "compute the id, let Firestore arbitrate" trick `appointments/{...}`
  already uses for double-booking). Only ever created/renewed by the
  patient themselves, in response to approving a claimed request — a
  clinic can never self-grant. Capped server-side (`firestore.rules`) at
  65 minutes out from `request.time` on every create/update, so even a
  tampered client can't mint a long-lived pass; the app itself always
  requests 30 minutes (`ACCESS_GRANT_MINUTES` in `passport.ts`), standing
  in for "the duration of the consultation" since there's no way for this
  app to know when a real consultation actually ends.

### UI

- **`/find/passport`** ("بطاقتي الصحية", linked from `/find` next to
  "طلباتي"): the patient's own passport — "إظهار رمز الدخول" generates an
  `access_requests` ticket and renders it as a QR (via the `qrcode` npm
  package) encoding `{patientId, requestId, exp}`; a live listener flips
  the screen to an approve/deny prompt the instant a clinic claims it,
  then to a confirmation once approved. Also lists the patient's own
  medical history/prescriptions (read + a "أضف ملاحظة" box for a
  self-reported entry) and any currently-active grants with a per-grant
  "إلغاء الوصول" revoke button.
- **`/clinic`'s new "مسح سجل المراجع" tab** (`components/
  ScanPatientTab.tsx`): camera-based scanning via `getUserMedia` +
  `jsqr` (a small, dependency-light pure-JS QR decoder — no native camera
  plugin needed since this is a web app), with a manual-paste fallback
  for a desktop dev machine or a browser that denies camera permission
  (clearly labeled as a fallback, not hidden as if it were the real
  flow). After claiming a scanned ticket, the tab waits
  (`onSnapshot`-driven, no polling) for the patient's approval, then shows
  that patient's record read-only plus a form to append a new
  prescription/report — exactly the "read old archive, write new entries
  only" split the spec asked for, enforced independently by
  `firestore.rules`, not just by what buttons this UI shows.

### Verification

No live-project verification this pass — no fresh Firebase service-
account key was on hand this session (this project's standing practice is
the user shares one fresh each time it's needed, then it's deleted
immediately after use), so nothing was deployed or tested against the
real `mawid-app-d1d03` project.

What *was* verified, and how:

- `tsc --noEmit` (via `next build`'s own typecheck) and the static export
  build are both clean; `/find/passport` and `/clinic`'s new tab compile
  and are included in the static export.
- **The actual security-critical part — `firestore.rules` — was verified
  against a real, locally-running Firestore emulator** (the emulator jar
  was already cached in this sandbox from earlier work in this project;
  Java was available), not just read through by eye. A 22-assertion script
  (three real signed-in-anonymous identities: one patient, two separate
  clinics) exercised the whole flow end-to-end and every negative case:
  patient creates their own record; a clinic with no grant can't read it;
  a clinic can't self-create a grant; a patient's access-request ticket
  respects its expiry bound; a clinic claims a ticket and the patient
  approves it; the granted clinic can then read the record and append a
  new prescription entry; the granted clinic **cannot** edit the record's
  `fullName` or edit/delete the entry it just wrote (the read-only/
  append-only guarantee, actually checked, not assumed); an unrelated
  second clinic still can't read the record or forge an entry under the
  granted clinic's identity; revoking a grant immediately cuts off
  access; a clinic can't re-activate its own revoked grant; a patient can
  add their own self-reported entry. All 22 passed.
  - **A real bug was caught by this exact test run, in the test harness
    itself, not the rules**: the first pass showed 3 unexplained
    failures where a write that should have succeeded (a clinic claiming
    its own scanned ticket; that same clinic later trying — and rightly
    failing — to reactivate its own revoked grant) was denied. Root
    cause, found by reading the Firestore emulator's own debug log
    (`firestore-debug.log`) and then directly inspecting the stored
    documents via the emulator's REST API with the debug `Authorization:
    Bearer owner` bypass: a `DocumentReference` created against one
    signed-in Firebase app instance (the patient's) was being reused to
    perform a write that was supposed to come from a *different* signed-
    in instance (a clinic's) — Firestore always executes a write using
    the credentials of the specific SDK instance the reference belongs
    to, not whichever instance the test code "intended." Once each write
    used a reference obtained from the correct actor's own client, all
    22 assertions passed. Disclosed here rather than silently fixed and
    forgotten, since it's a good illustration of exactly the kind of
    cross-actor mistake these rules are designed to prevent for real —
    caught in the test harness first.
  - Emulator + scratch test files were fully cleaned up after (no jar,
    log, or test script left in the repo).
- **Not verified**: the camera-scanning path itself (`getUserMedia` +
  `jsqr`) was not exercised with a real camera/real QR image in this
  pass — only confirmed to render its "تعذّر الوصول إلى الكاميرا" fallback
  UI cleanly in a headless browser with no camera, and to not throw. The
  manual-paste fallback path is what should be used to exercise the
  claim/approve/read/append flow live once this is deployed, until it's
  tried with a real phone camera.
- **Not deployed** — `firestore.rules` and the rebuilt `apps/web/out/`
  are committed but not pushed to the live `mawid-app-d1d03` project;
  same standing practice as every other feature in this file (hold
  `firebase deploy` for the user's explicit go-ahead), doubly true here
  since this feature was never verified live.

### Disclosed limitations (read before treating this as production-ready)

- No file/image attachments (X-rays, PDF reports) — text only, see the
  Blaze-plan scoping decision above.
- Patient_ID is unverified anonymous-auth identity, not a real, checked
  phone/legal identity — see the Blaze-plan scoping decision above.
- No push notifications — the patient-approval step only works while the
  patient's own device has `/find/passport` open and listening; this
  matches the real in-person "show the clinic your screen" scenario the
  feature is built for, but there is no way to approve a request
  remotely or after closing the tab.
- The QR "signing key" is an unguessable random Firestore document id
  plus a short server-checked expiry, not a real cryptographic signature
  — adequate against casual replay/guessing, not against a
  sophisticated attacker with write access to the patient's own device.
- Not yet load-tested or used with a real camera/real patient in a real
  clinic visit — see "Verification" above.

**Deployed** (in a later turn, once the user shared a fresh service-
account key and asked explicitly): `firestore.rules` was pushed live via
the direct Rules API technique (ruleset
`projects/mawid-app-d1d03/rulesets/a92289c4-5a7e-434b-98e5-f8073e4141be`)
and the rebuilt `apps/web/out/` via `firebase deploy --only hosting`,
verified FINALIZED (release
`sites/mawid-app-d1d03/releases/1788556485011000`). The service-account
key was deleted immediately after (both the copy used for the deploy and
the original upload). The camera-scanning path is still not verified with
a real camera — see "Verification" above — that gap is unaffected by
deploying.

## Patient end-of-visit deletion: automatic prompt + manual delete

The user's next request: when a clinic marks an appointment "منتهي"
(completed), the patient's own screen should offer to delete that
appointment — "انتهى موعدك، هل تريد حذف الحجز؟" with نعم/لا — and a
patient should also be able to delete a finished appointment manually at
any time, not only via that prompt.

- **firestore.rules**: `appointments/{apptId}`'s `delete` rule, previously
  `isAdmin()` only, now also allows the patient themselves —
  `isSignedIn() && resource.data.patientUid == request.auth.uid &&
  resource.data.status == "completed"`. Deliberately scoped to
  `"completed"` only, not every terminal status: letting a patient delete
  a still-`"requested"`/`"booked"` appointment, or one the clinic marked
  `"cancelled"`/`"no_show"`, would let them erase a record the clinic
  still needs or dodge a no-show being on file — neither was asked for,
  only "delete once it's actually finished." No new collection, no schema
  change — `deleteAppointment()` (already existed in `firestore.ts`, used
  until now only by the admin dashboard) is the one function every new
  call site below reuses.
- **The prompt fires from two places, live, not polled** — both reuse the
  same `ConfirmPopup` component (which gained an optional `busy` prop in
  this pass, disabling both buttons and showing "…" while the delete
  request is in flight, so a slow network can't be double-submitted):
  - **`/find/wait`** (the patient's live status screen, already
    `onSnapshot`-subscribed to this exact appointment): a new effect
    shows the popup the instant `appt.status` flips to `"completed"`,
    provided this appointment hasn't already been dismissed (see below).
    "نعم، حذف الحجز" calls `deleteAppointment()`, clears the local
    `ActiveBooking` pointer, and `router.push("/find")` — "redirect
    smoothly to the home/search screen" from the spec. "لا، إبقاء السجل"
    just records the dismissal and closes the popup; the appointment
    stays exactly as-is (already effectively inactive/historical, since
    `/find/requests` — see below — already lists every appointment
    regardless of status, so a completed-but-kept one is already sitting
    in that "قسم السجلات السابقة" by construction, no separate flag or
    move needed).
  - **`/find`**: a patient who closed the waiting-screen tab (or never
    opened it) would otherwise never see this. `/find` now subscribes
    (`watchAppointment`, live `onSnapshot`) to whatever appointment the
    local `ActiveBooking` pointer names, purely to catch this transition
    even from the search screen — the same popup, same two handlers,
    scoped to this component's own state rather than `/find/wait`'s.
    Reaching a terminal status here also calls `clearActiveBooking()`
    (mirroring the exact same cleanup `/find/wait` already did), so the
    "موعدك الحالي" card can't keep pointing at a finished visit.
- **"لا حاجة لإعادة إظهار الإشعار" is a real per-appointment guarantee,
  not just "don't ask twice in one session"**: `lib/patientLocal.ts`
  gained `isEndPromptDismissed(apptId)`/`markEndPromptDismissed(apptId)`
  — a small `localStorage`-backed list (capped at the 30 most recent, so
  it can't grow unbounded over a long-lived browser profile) of
  appointment ids the patient has already answered "لا" for. Both prompt
  sites check this before showing anything, so choosing "keep" once means
  it never asks again for that same appointment, on either screen, even
  after a reload — matching "دون إزعاج المراجع بإشعارات متكررة" exactly.
  Choosing "نعم" needs no such flag: once the appointment doc itself is
  gone, there's nothing left to prompt about, on any screen.
- **Manual delete, the other half of "تلقائياً أو يدوياً"**:
  `/find/requests` (already listing every one of the patient's
  appointments, at every status — this project's existing, if informal,
  "قسم السجلات السابقة") now shows a small "حذف الحجز" text button under
  any entry whose status is `"completed"`, opening the same `ConfirmPopup`
  pattern ("حذف هذا الحجز نهائياً؟" / "لن تتمكن من التراجع عن هذا
  الإجراء.") before actually deleting. Deleting here removes the row from
  the list immediately (no full reload) and also clears the active-
  booking pointer if it happened to be the one just deleted.
- **Verified against a real, locally-running Firestore emulator**, not
  just read through by eye — a dedicated 5-assertion script (three
  distinct signed-in-anonymous identities: two patients, one clinic
  owner) confirmed exactly the intended shape of the new rule: a patient
  cannot delete their own still-`"booked"` appointment; a patient cannot
  delete a *different* patient's completed appointment; the owning
  clinic itself cannot delete a patient's completed appointment (deletion
  is patient-or-admin only, never the clinic); a patient *can* delete
  their own completed appointment; a second, unrelated patient can
  likewise delete their own. All 5 passed. Test fixtures were seeded via
  the emulator's own `Authorization: Bearer owner` REST bypass (since
  several of the fixtures — e.g. a `"booked"` appointment belonging to
  someone else — couldn't legitimately be created through the real
  `create` rule at all, and that's not what this script was testing
  anyway) — the actual assertions all went through the normal client SDK
  under each identity's own real auth token, unchanged. Emulator and the
  scratch test script were fully cleaned up after (nothing left in the
  repo).
- `tsc --noEmit` (via `next build`) and the static export build are both
  clean.
- **Not independently live-verified**: a local Playwright pass against
  the exported `out/` confirmed no console/page errors and correct
  fallback rendering (`/find`'s gate, `/find/requests`'s empty state,
  `/find/wait`'s not-found state with no `?appt=`) — but this sandbox's
  own network egress to Firebase's Auth/Firestore domains isn't reliably
  reachable from a bare headless browser outside the request-interception
  pattern used elsewhere in this file for live dev-server passes, so the
  actual end-to-end prompt-appears-live-and-deletes-successfully flow
  was **not** exercised against the real project this pass — same class
  of gap as the camera-scanning path in the Patient Passport feature
  above. Recommended before treating this as fully verified: a real
  clinic marking a real appointment "completed" while a real patient has
  `/find/wait` (or `/find`) open, confirming the popup appears, and both
  branches (delete → lands on `/find`; keep → doesn't ask again on
  reload).
**Deployed** (in a later turn, once the user shared a fresh service-
account key and asked explicitly): `firestore.rules` was pushed live via
the direct Rules API technique (ruleset
`projects/mawid-app-d1d03/rulesets/3a1fcb04-35ca-46b3-88e7-3d331ad18542`)
and the rebuilt `apps/web/out/` via `firebase deploy --only hosting`,
verified FINALIZED (release
`sites/mawid-app-d1d03/releases/1788558164419000`). The service-account
key was deleted immediately after, from both the location it was used
from and the original upload. The "not independently live-verified"
gap above (a real clinic completing a real appointment while a real
patient watches the prompt appear) is unaffected by deploying — still
worth doing once there's a real clinic/patient pair to test with.

## Clinic landing menu + live queue-position waiting screen

The user's next request, framed as a real-time/UX re-architecture: move
"شاشة الانتظار" so it's reachable only after entering a specific clinic's
own page (two clear buttons there — "تثبيت حجز" / "شاشة الانتظار" — not
straight into the booking grid), and make the waiting screen itself show
the clinic name, the patient's own name, their live queue number, and
how many people (or how much time) are still ahead of them — all synced
live with whatever the clinic's own reception dashboard does.

- **New collection: `clinic_queue_slots/{apptId}`** (same deterministic
  id as its matching `appointments/{apptId}` doc) — a small, deliberately
  **PII-free mirror**: `clinicSlug`/`date`/`startTime`/`status` only,
  never `patientName`/`patientPhone`. That absence of PII is what makes
  `allow read: if isSignedIn()` safe for the whole collection — any
  patient can read a clinic's entire day's queue board (needed to count
  "how many are ahead of me") without ever seeing who anyone else is,
  the same privacy posture `getSlotAvailability()` already established
  for the booking grid, just applied to a live board instead of a
  one-shot per-slot check. `lib/firebase/queue.ts` (new) holds:
  - `syncQueueSlot()` — best-effort (own try/catch, never throws) write,
    called from two places that already know the real, current status:
    `bookSlot()` right after its transaction commits (writes the very
    first "requested" entry) and `setAppointmentStatus()` on every
    status change the clinic makes. Neither call blocks or fails its
    real operation if this write fails — the board is a live convenience
    view, not the source of truth (that stays `appointments/{apptId}`,
    unchanged, still governed by its own existing rules).
  - `watchClinicQueue(clinicSlug, date, cb)` — one live `onSnapshot`
    query (`clinicSlug == X && date == Y`, two equality filters, no
    composite index needed — same shape `listAppointmentsForClinic()`
    already uses successfully) instead of the old capacity check's one
    `getDoc()` per possible slot. A real efficiency win, not just a
    refactor: for a clinic with e.g. 30 slots, the old
    `getSlotAvailability()`-based "X of Y booked" stat on `/find/wait`
    cost up to 30 reads on every load; the new board costs one query
    that scales with *actual appointments today*, not *possible slots
    today*.
  - `computeQueueStanding(slots, myStartTime)` — pure: `aheadCount` =
    slots with an earlier `startTime` still in a non-terminal status
    (`requested`/`booked`/`arrived`/`in_progress` — a completed/
    cancelled/no-show slot is out of the way and shouldn't inflate
    anyone's wait estimate); `position` = `aheadCount + 1`. Works even if
    the patient's own slot-doc write hasn't landed yet, since it only
    needs to compare *other* slots against the patient's own known
    `startTime`.
- **`firestore.rules`**: two writers into the same collection, kept
  structurally honest —
  - the owning clinic (`ownsClinic()`) may write any slot, any status,
    any time (its own reception dashboard driving real transitions);
  - a signed-in patient may create/update **only their own slot**,
    proven the same way `hasActiveGrant()`/the Passport feature's rules
    already prove ownership elsewhere in this file: `exists()` +
    `get()` against the real `appointments/{apptId}` doc, checking
    `patientUid == request.auth.uid`. Critically, the status they may
    write **must equal** their real appointment's own current status
    (`request.resource.data.status ==
    matchingAppointment(...).data.status`) — a patient can never write
    `appointments/{apptId}.status` directly (that rule stays
    `ownsClinic()`-only, unchanged), so requiring the mirror to match it
    exactly means a patient can never self-advance or forge their own
    queue standing either, even on a document they're otherwise allowed
    to touch. `delete` stays admin-only, matching every other collection
    in this file.
  - **A real bug caught and fixed by the emulator test itself, before
    this shipped**: the first version of this rule let a patient set
    *any* valid status on their own slot (not just whatever their real
    appointment already had) — a live assertion ("patientA cannot
    self-advance their own queue-slot status") caught this immediately
    (it unexpectedly succeeded), which is exactly why the
    `matchingAppointment(...).data.status` equality check above was
    added; re-run after the fix, denied as intended.
- **`/find/book` restructured into a two-step clinic landing page**: a
  new `view: "menu" | "book"` state, default `"menu"` — entering a
  clinic now shows its name/info plus two large buttons, **"تثبيت حجز"**
  (switches to the existing, unchanged slot-grid/booking flow — same
  component tree, same `bookSlot()` call, same auto-navigate-to-
  `/find/wait`-on-success behavior, just one tap behind this menu
  instead of the very first thing shown) and **"شاشة الانتظار"**
  (enabled only when the local `ActiveBooking` pointer's `clinicSlug`
  matches *this* clinic — a patient with a booking elsewhere, or no
  booking at all, sees it correctly disabled with "لا يوجد حجز نشط لديك
  في هذه العيادة اليوم" rather than a dead/misleading button). A small
  in-page "‹ رجوع لقائمة العيادة" link returns from the booking view to
  the menu without leaving the clinic page entirely — the page's own top
  `BackButton` (→ `/find`) is left untouched for "actually leave this
  clinic," so the two "back" actions stay distinct and predictable.
- **`/find/wait` redesigned**: now shows the patient's own name
  (`appt.patientName`, previously never displayed here) alongside the
  clinic name, plus a new two-tile "دورك رقم N" / "أمامك N مراجع" stat
  block and an "الوقت المتوقع للانتظار: ~M دقيقة" estimate
  (`aheadCount * clinic.slotMin`, explicitly labeled "~" /estimated,
  never claimed as exact) — replacing the old "X من Y محجوز" capacity
  bar entirely, which answered a less useful question than "how long
  until *my* turn." Both the appointment's own live status
  (`watchAppointment`) and the new queue board (`watchClinicQueue`) are
  independent `onSnapshot` subscriptions, so a clinic marking someone
  else "completed" on its reception dashboard shrinks every later
  patient's `aheadCount` on their own already-open `/find/wait` tab with
  no manual refresh — the actual "real-time sync with what the
  reception dashboard does" the request asked for.
- **`setAppointmentStatus()`'s signature changed** (`firestore.ts`) —
  from `(appointmentId, status)` to `(appt: Pick<AppointmentDoc,"id"|
  "clinicSlug"|"date"|"startTime">, status)`, since syncing the queue
  board needs those three extra fields and they were already sitting in
  the caller's own hands (the full `AppointmentDoc` row) at every real
  call site — `/clinic`'s reception tab and `/admin/user`'s status
  dropdown, both updated to pass the row instead of just its id. The
  unrelated Postgres/`apps/server`-track `setAppointmentStatus()` in
  `lib/api/client.ts` (used only by the legacy, unhosted
  `/dashboard`/`/display` pages) was untouched — different function,
  different track.
- **Verified against a real, locally-running Firestore emulator**
  (same jar/technique as every rules change in this file) — a dedicated
  7-assertion script (two patients, one clinic owner, real anonymous
  Firebase Auth identities) confirmed: a patient can create their own
  queue-slot with a status matching their real appointment; a patient
  cannot create one for someone else's appointment; a patient cannot
  forge a queue-slot with no matching appointment at all; a patient
  cannot self-advance their own slot's status (the bug/fix above); the
  clinic owner can update any slot, including creating one from scratch;
  a different patient still can't touch another patient's slot even
  after the clinic has written to it. All 7 passed. Emulator + scratch
  test script fully cleaned up after.
- `tsc --noEmit` (via `next build`) and the static export build are both
  clean.
- **Not independently live-verified**: a local Playwright pass against
  the exported `out/` confirmed no *uncaught* page errors and correct
  fallback rendering (the patient gate still shows on `/find/book`; the
  not-found state still shows on `/find/wait` with no `?appt=`) — one
  expected, pre-existing console error appeared (`FirebaseError: Failed
  to get document because the client is offline`, from `/find/wait`'s
  own unmodified `getClinic()` call, which has no `.catch()` and was
  already exactly this shape before today's changes) — this sandbox's
  network egress to Firebase's own domains isn't reliably reachable
  from a bare headless browser outside the request-interception pattern
  used elsewhere in this file for live dev-server passes, so the actual
  live queue-count-decreasing-in-real-time behavior was **not**
  exercised against the real project this pass — same class of gap as
  the two features immediately above this one in this file. Recommended
  before treating this as fully verified: two real patients booking
  consecutive slots at a real clinic, both watching `/find/wait`, then
  the clinic marking the earlier one `"arrived"`/`"in_progress"`/
  `"completed"` on its own dashboard and confirming the later patient's
  `aheadCount` drops live with no refresh.
- **Deliberately out of scope this pass**: no cleanup of a
  `clinic_queue_slots` doc when its matching appointment is later
  deleted (see the patient end-of-visit deletion feature above) — a
  deleted-but-still-"completed"-flagged queue-slot entry is harmless for
  `computeQueueStanding()` (completed slots never count as "ahead"
  anyway), so this was left as a small, disclosed bit of intentionally
  unswept data rather than widening `deleteAppointment()`'s signature
  for a cosmetic-only gap.
**Deployed** (in a later turn, once the user shared a fresh service-
account key and asked explicitly): `firestore.rules` was pushed live via
the direct Rules API technique (ruleset
`projects/mawid-app-d1d03/rulesets/e8f50589-174f-4053-85e2-095ce2e58b9b`)
and the rebuilt `apps/web/out/` via `firebase deploy --only hosting`,
verified FINALIZED (release
`sites/mawid-app-d1d03/releases/1788560536355000`). The service-account
key was deleted immediately after, from both the location it was used
from and the original upload. The "not independently live-verified" gap
above (two real patients watching their queue position update live as a
real clinic drives status changes) is unaffected by deploying — still
worth doing once there's a real clinic/two-patient pair to test with.

## Clinic account settings drawer + foreground status alerts + auth persistence + audit

A four-part request, addressed to "a senior mobile/Firebase developer":
restructure `/clinic` so only الاستقبال/شاشة الانتظار stay as top-level
tabs and everything else lives in a new "إعدادات الحساب" drawer behind a
gear icon at the screen's physical top-left corner; give the clinic an
instant alert the moment admin approves/rejects its registration, no
manual refresh; fix a reported bug where a killed-and-reopened app forces
re-login; and do a general bug-audit pass.

- **`components/ClinicAccountDrawer.tsx`** (new): a slide-over panel
  (`fixed left-0`, physical left edge regardless of `dir="rtl"`, same
  reasoning as every other physical-positioning choice in this file)
  opened from a new gear-icon button pinned `absolute left-3 top-3` in
  `/clinic`'s own sticky header (`GearIcon`, a standard cog SVG). Menu
  order, top to bottom: مسح سجل المراجع (`ScanPatientTab`, reused
  unchanged), إعدادات أوقات الدوام (`ScheduleForm`), خطة الاشتراك
  (`SubscriptionTab`), then a divider, then a prominent red "تسجيل
  الخروج" pinned to the bottom via `mt-auto` — exactly the ordering
  asked for. Reuses the existing `markIntentionalSignOut()`/
  `signOutUser()`/`ConfirmPopup` pattern already used by `/admin`'s own
  sign-out button, for the same race-with-the-layout's-own-redirect-
  effect reason documented earlier in this file.
  - **Conditionally *mounted*, not conditionally hidden**: `open=false`
    renders `null` outright (same convention as `ConfirmPopup`) rather
    than toggling visibility, specifically so `ScanPatientTab`'s camera
    (`getUserMedia`) actually stops via its own existing unmount cleanup
    the moment the drawer or that specific tool closes — a hidden-but-
    still-mounted panel would leave the camera running in the
    background.
  - **`components/ClinicSettingsTools.tsx`** (new): `ScheduleForm` and
    `SubscriptionTab` were pulled out of `app/clinic/page.tsx` into this
    shared file rather than kept as extra named exports off the page
    module — caught by a real build failure ("X is not a valid Page
    export field"): a Next.js App Router `page.tsx` may only export its
    default page component (plus the small fixed set of special
    exports), so any other named export fails `next build` outright.
    Both the drawer and `/clinic`'s own page import these from this new
    file now.
  - `/clinic`'s top nav is now just الاستقبال/شاشة الانتظار — the other
    three tools/tabs it used to have are gone from the top level
    entirely, reachable only through the drawer.
- **`lib/notifications.ts`** (new) + **`lib/firebase/firestore.ts`**
  gained `watchClinicByOwner()`/`watchAppointmentsForClinic()` (live
  `onSnapshot` variants of the existing one-shot `getClinicByOwner()`/
  `listAppointmentsForClinic()`, same query shapes so no `firestore.rules`
  change was needed) — **this is a foreground Notification-API alert, not
  Firebase Cloud Messaging**, and that's a disclosed scoping decision, not
  a shortcut: a real push that reaches a *fully closed* app needs FCM
  plus a server-side trigger (a Cloud Function reacting to admin's
  approve/reject write), and Cloud Functions require the paid Blaze plan
  to deploy at all — the same wall this project has already hit for
  Storage and Phone Auth SMS, always disclosed rather than silently
  worked around. Building FCM token/service-worker plumbing with no way
  to ever trigger a send would be dead code. The user's own request
  explicitly named the Spark-compatible fallback ("أو استماع مستمر لحالة
  الحساب في Firestore"), so this was built rather than paused on: `/clinic`'s
  new live `watchClinicByOwner()` subscription (replacing the old
  one-shot fetch) compares the previous status against the new one via a
  `prevStatusRef`, and on a real pending→approved/pending→rejected
  transition calls `notifyClinicStatusChange()`, which shows a real OS-
  level `Notification` — this works while `/clinic`'s tab/installed
  PWA/TWA is open, even backgrounded, but genuinely cannot reach a fully
  closed app. A `NotificationOptIn` opt-in button (never auto-prompts)
  appears only on the pending-approval screen, with a green confirmation
  line once granted that says exactly this limitation out loud.
  `/clinic`'s appointments list is also now a live
  `watchAppointmentsForClinic()` subscription instead of the old
  one-shot-fetch-plus-manual-reload-after-every-status-change pattern —
  a new booking or this same clinic's own status write now shows up with
  zero manual refresh, a real correctness improvement independent of the
  notification feature.
- **`lib/firebase/config.ts`**: added an explicit
  `setPersistence(auth, browserLocalPersistence)` call right after `auth`
  is created. **Disclosed, not oversold**: the Firebase JS SDK already
  defaults to this exact persistence in a browser, so this is the
  standard, documented *defensive* fix for "signed out after the
  installed app is fully killed and reopened" reports — making the
  choice explicit removes any ambiguity across WebView/TWA edge cases an
  implicit default could behave differently under. **This could not be
  verified against a literal Android app-kill-and-reopen from this
  sandbox** (no Android device/emulator available here) — flagged rather
  than claimed fixed-and-confirmed; worth a real on-device check next
  time there's access to the actual installed APK/PWA.
- **Bug audit performed this pass**: a focused, bounded review (not a
  line-by-line rewrite of the whole codebase) covering the two areas most
  likely to actually regress from this segment's own changes —
  1. **Every `onSnapshot` call site in the project** (`find/wait/page.tsx`,
     `find/page.tsx`, `lib/firebase/queue.ts`, `lib/firebase/firestore.ts`
     — including the two new watchers this pass added — and
     `lib/firebase/passport.ts`) was checked for a returned unsubscribe
     function actually reaching its `useEffect`'s own cleanup return.
     All of them do — no leaked listeners found, new or pre-existing.
  2. Two dead imports left over from mid-rewrite (`useRouter`,
     `ConfirmPopup` — both moved to `ClinicAccountDrawer` once sign-out
     left `/clinic`'s own page file) were caught and removed before this
     was considered done; two `<Link>` usages that had been accidentally
     changed to plain `<a>` tags during the same rewrite were reverted
     back to `<Link>` for consistency with the rest of the app's
     navigation.
  - **Not exhaustively re-audited this pass**: the broader "track down
    any hidden bug anywhere in the project" ask is open-ended by nature;
    a full line-by-line pass of every file wasn't performed. What was
    checked is listed above — flagged here rather than implicitly
    claiming a wall-to-wall audit that didn't happen.
- **Verified**: `npm run build --workspace=apps/web` (typecheck + static
  export) clean. A local Playwright pass against the exported `out/`
  confirmed zero console/page errors on `/`, `/find`, `/clinic`
  (signed-out — correctly redirects to `/signup`), and `/admin`
  (signed-out — same redirect). **Not independently live-verified**: the
  drawer's actual open/close/tool-switch behavior and the live
  notification firing on a real admin approve/reject were not exercised
  against the real `mawid-app-d1d03` project this pass (no fresh
  service-account key was on hand) — same disclosed-gap pattern as the
  Patient Passport and queue features earlier in this file. Recommended
  before treating this as fully verified: a real clinic account signed
  into `/clinic`, opening the drawer and switching between its three
  tools, then a real admin approving/rejecting that same clinic's pending
  request while the clinic's tab stays open, confirming the notification
  actually appears.
- **Deployed** (in a later turn, once the user shared a fresh service-
  account key and asked explicitly): no `firestore.rules` changes were
  needed this segment, so only the rebuilt `apps/web/out/` was pushed via
  `firebase deploy --only hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788615342398000`). The service-account
  key was deleted immediately after — both the copy used for the deploy
  and the original upload — along with several older leftover
  service-account key uploads found sitting in the same session-scratch
  location from earlier turns, cleaned up as good hygiene rather than
  left around unused.

## Real bug: "Missing or insufficient permissions" deleting an already-gone appointment

The user reported, with screenshots from their own live installed app: (1)
tapping "موعدك الحالي" on `/find` opened `/find/wait` showing "تعذّر
العثور على هذا الحجز" (not found); (2) separately, pressing "حذف الحجز"
(on `/find/requests`, the only screen with that exact button, for an
appointment shown there with status "انتهى"/completed) showed a raw
`Missing or insufficient permissions.` error instead of deleting it.

- **Root cause, reasoned from the rules and code, not guessed**:
  `deleteAppointment()` (`firestore.ts`) called `deleteDoc()` directly with
  no existence check. `firestore.rules`' patient-delete rule reads
  `resource.data.patientUid`/`resource.data.status` — evaluating that
  against a document that's **already gone** (deleted a moment earlier by
  the exact same automatic end-of-visit prompt on `/find`, or by a stale
  one-shot `listAppointmentsForPatient()` fetch on `/find/requests` that
  had loaded the row before an earlier deletion actually landed) makes the
  rule deny with a plain `Missing or insufficient permissions.` — Firestore
  reports this identically to a real ownership violation, from the
  client's point of view, even though "the appointment is already gone" is
  exactly the end state a delete call wants. This is fully consistent with
  both screenshots: the same already-deleted appointment reads back as
  "not found" via `watchAppointment()`'s existing null-on-error handling
  on `/find/wait`, and as a delete-time permission error on
  `/find/requests`, which was reading from an independent one-shot fetch
  rather than the same live subscription.
- **Fix**: `deleteAppointment()` now calls `getDoc()` first — allowed even
  for a nonexistent doc, per the read rule's own `resource == null` clause
  (the same clause `getSlotAvailability()`'s per-slot existence checks
  already rely on) — and returns immediately if the document doesn't
  exist, instead of attempting (and having denied) a delete against it.
  A real permission violation (someone else's appointment, or one not yet
  "completed") still surfaces normally, since that document genuinely
  exists and the read itself succeeds before the delete is even attempted.
  This one shared function is reused by all three call sites
  (`/find`, `/find/wait`, `/find/requests`), so the fix covers all of them
  at once.
- **Self-healing added on top, so the same stale appointment can't keep
  sending the patient back into this loop**: both `/find`'s own live
  `watchAppointment()` subscription and `/find/wait`'s existing one now
  clear the local `ActiveBooking` pointer the moment the watched
  appointment resolves to `null` (gone or denied — `watchAppointment()`
  can't tell the two apart, and neither case is ever usable again), not
  only on a genuine terminal-status transition as before. Previously
  nothing cleared the pointer for this case at all, so "موعدك الحالي"
  would keep linking to the same dead appointment indefinitely until the
  patient manually found and used `/find/requests`' delete button — which
  itself was the thing throwing the error.
- **The reported appointment could not be deleted from here directly**:
  no Firebase service-account key was attached to this report, and by this
  point in the session the previous one had already been deleted per this
  project's own standing key-hygiene practice. Per the root-cause analysis
  above, this isn't actually needed — the appointment is already gone
  server-side; what was broken was purely the client mishandling that
  already-gone state. The self-healing fix means the user's own next
  visit to `/find` (or `/find/wait`, or `/find/requests`) clears the
  stale local pointer automatically, with nothing left to manually
  delete.
- **Verified**: `tsc --noEmit` (via `next build`) and the static export
  build both clean. A local Playwright smoke pass against the exported
  `out/` confirmed zero console/page errors on `/`, `/find`, `/clinic`,
  and `/admin`. **Not independently live-verified against the real
  project this pass** (no service-account key on hand) — the fix's logic
  was validated by re-reading `firestore.rules`' exact delete/read clauses
  against the exact error message and screenshots reported, not by a
  fresh emulator/live run. Worth a real live check next time a key is
  shared: delete an already-deleted appointment twice in a row and
  confirm the second attempt no longer errors.
- **Deployed** (in a later turn, once the user shared a fresh service-
  account key and asked explicitly): no `firestore.rules` changes were
  needed for this fix, so only the rebuilt `apps/web/out/` was pushed via
  `firebase deploy --only hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788616436086000`). The service-account
  key was deleted immediately after — both the copy used for the deploy
  and the original upload.

## Clinic dashboard visual polish: centered header, link moved into drawer, restyled menu

A UI/UX-focused request, addressed to "a UI/UX designer and software
architect": three precise cosmetic/structural fixes to `/clinic`.

- **"رابط العيادة" moved into the settings drawer**: the shareable public
  booking-link box (readonly input + copy button) used to sit in the
  dashboard's own header, next to the clinic name. It's now its own
  fourth tool in `ClinicAccountDrawer`'s menu (`ClinicLinkTab`, new,
  `components/ClinicAccountDrawer.tsx`) alongside مسح سجل المراجع /
  إعدادات أوقات الدوام / خطة الاشتراك, with sign-out still pinned at the
  very bottom. Same link/copy behavior as before, just relocated —
  freed the header to give the clinic name a single, uncluttered focal
  point instead of sharing a row with it.
- **Clinic name centered and enlarged**: `/clinic`'s header no longer
  puts the clinic name in a `justify-between` row against the booking-
  link box — it's now its own centered block (`text-2xl sm:text-3xl
  font-extrabold`), the clear visual anchor of the screen the user asked
  for. The الاستقبال/شاشة الانتظار tab buttons moved to their own
  centered row underneath (`flex justify-center`, was left-aligned by
  default before).
- **Reception table + waiting-room TV now sit in a shared, width-capped,
  horizontally-centered column** (`main` gained `mx-auto max-w-3xl`)
  instead of stretching to the page's physical edges — both tabs render
  inside the same centered container, so switching between them doesn't
  shift the content's horizontal position.
- **Drawer background/menu restyled for contrast and polish**: the panel
  background is now a soft top-to-bottom gradient from the brand's own
  `#F5FBF9` tint into white (was flat white) — ties it visually into the
  app's teal identity instead of reading as a generic system sheet. Each
  menu row is now its own white, shadow/ring-bordered card with the
  tool's emoji inside a small teal-tinted circle (`#EAF6F3` background,
  `#0F7A6C` icon color) rather than a floating icon on a plain hover
  row — clearer separation between items and better icon/text contrast
  against the new tinted backdrop. The backdrop overlay gained a light
  `backdrop-blur` for a softer, more modern dim. Bumped icon-row/heading
  text weights (`font-bold`/`text-lg font-extrabold`) for stronger
  contrast on the lighter background.
- **Verified visually, not just by a clean build**: a throwaway route
  (`app/uitest-scratch/`, mounting the same header/drawer/tab components
  with mock clinic/appointment data — no Firebase needed) was built,
  screenshotted with Playwright at a real phone viewport (420×900) in
  all four states — الاستقبال, شاشة الانتظار, the settings-drawer menu,
  and its new "رابط العيادة" tool panel — confirming the centered
  clinic name, centered tabs/content, the restyled card-based menu, and
  the relocated link tool all render correctly with zero console/page
  errors, then deleted before this was considered done (confirmed gone
  from the rebuilt `apps/web/out/`, and `/clinic`'s own bundle size back
  to its prior value). Screenshots sent to the user for review. `tsc
  --noEmit` (via `next build`) and the static export build are both
  clean; the existing signed-out-redirect smoke pass for `/clinic`,
  `/`, `/find`, `/admin` still shows zero errors.
- **Not independently live-verified**: no fresh service-account key was
  on hand this pass, so the actual restyled dashboard/drawer wasn't
  screenshotted against a real signed-in clinic account on the live
  project — the mock-data verification above is what stands in for that
  this time, same disclosed-gap shape as several earlier features in
  this file. Recommended before treating this as fully verified: a real
  clinic account signed into `/clinic`, opening the drawer, and using
  its new "رابط العيادة" tool to confirm the copied link is correct.
- **Deployed** (in a later turn, once the user shared a fresh service-
  account key and asked explicitly): no `firestore.rules` changes were
  needed for this pass, so only the rebuilt `apps/web/out/` was pushed
  via `firebase deploy --only hosting`, verified FINALIZED (release
  `sites/mawid-app-d1d03/releases/1788617483905000`). The service-account
  key was deleted immediately after — both the copy used for the deploy
  and the original upload.

## Next steps if resumed

Paid subscription tiers remain undecided and unbuilt, in either track —
ask before building, per the artifact's "لم يُحدَّد بعد" pricing note.
`/subscribe`'s free-month framing is the same placeholder, not a real
decision to build billing against.
