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
- To redeploy after future changes: `npm run build --workspace=apps/web`
  (regenerates `apps/web/out/`), then `firebase deploy --only hosting`
  from the repo root (needs `firebase login` or the same service-account
  key approach).

## Next steps if resumed

If the user wants the two-sided account/GPS/shareable-link feature set
built into the *real* codebase (not just the artifact), that needs actual
product decisions first (ask, don't assume): does a patient need an
account eventually, or stay anonymous forever; is location GPS-only or
also manual; do paid subscription tiers get built now or later; does a new
clinic signup also need to appear in the public directory (currently it
doesn't — only reachable via its direct link). Then it's a real Prisma
migration (Clinic auth: username/password hash, subscription/plan fields,
a `patientRequests` table) plus new Next.js routes — not a small patch.
