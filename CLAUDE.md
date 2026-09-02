# موعد (Mawid) — project memory

Offline-first clinic booking system. This file is the persistent record of
what exists, why it's built this way, and what's still only prototyped.

## Repo state

- Branch `claude/mawid-clinic-booking-mvp-td9qxz` → PR #1 on
  `Mahdi-PH/Mawid-1-app` (open, not merged).
- Monorepo: `apps/server` (Express + Prisma/Postgres), `apps/web` (Next.js 14
  App Router + Tailwind), `packages/shared` (types + the slot-scheduling
  engine, used by both server and web so offline slot math never drifts).

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

What the artifact currently demonstrates end-to-end (all client-side,
localStorage-backed, no server):

1. **Home**: choose "عيادة" or "مراجع" — both role-card titles set in the
   teal accent color (not the default near-black ink) for prominence. No
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

No live hosted URL exists for the real Next.js/Express app — nothing has
been deployed to Vercel/Railway/etc. (no hosting credentials available in
this environment). What *does* work as a "try it now" link is the demo
artifact above, and the PWA install flow once/if the real app is deployed
somewhere. Asked the user once about deployment strategy (quick
frontend-only demo vs full real deploy vs "not yet") — they chose to see
the artifact demo instead of pursuing a real deploy at that point.

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
