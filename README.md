# ZOU Strategic Plan Monitor — Full-Stack Reference Application

A real, working full-stack implementation of the ZOU IRBM strategic-plan
monitoring system: a genuine Node.js/Express + SQLite backend with bcrypt
password hashing, JWT session authentication, and server-enforced
role-based access control, plus a browser frontend that consumes it over a
real HTTP API. This replaces the earlier single-file HTML prototype's
simulated login and in-memory JavaScript state with an actual backend that
persists data, validates every request, and cannot be bypassed by editing
the page in the browser. The frontend itself is a proper React + Tailwind
CSS single-page app (built with Vite) rather than hand-rolled HTML/CSS/JS,
while still talking to the same real backend over the same REST API.

## What's real here

- **Authentication**: passwords are hashed with bcrypt and checked
  server-side; sessions are signed JWTs; there is no client-side password
  list to inspect.
- **Authorization**: every protected endpoint re-derives the caller's
  current role, scope, and permissions from the database on each request.
  The frontend hides controls a user shouldn't see, but the backend is what
  actually blocks unauthorized actions — for example, a Sub Rep cannot
  approve their own KPI submission even if they call the API directly,
  and permission management is only reachable by the `ictadmin` role,
  structurally, not just permission-gated.
- **Data**: a persistent SQLite database file (`backend/data/zou.db`),
  not an in-memory mock that resets on refresh.
- **Audit trail**: every permission change, org-structure change, KPI
  creation/edit, and data-entry/submit/approve/return/override action is
  written to an `audit_log` table with who did what and when.
- **Soft-delete & traceability, across every removal in the app, and every
  removal is confirmed before it happens**: "removing" a Programme,
  Sub-programme, Unit, Individual, KPI, KPI template, KPI assignment, or user
  account is a stamp (`deleted_at`, nullable — NULL means active), never a
  real SQL `DELETE`. A `deleted_at IS NULL` filter on every query that lists
  "the current/active" structure — the org tree, KPI lists and ownership
  lookups, the User Directory, Plans, Compliance & Escalations, the KPI
  template pool, who's assigned to a shared KPI — is what makes a removed
  item disappear from every active view at once, while the row itself, its
  full performance history (`kpi_values`), and its audit trail stay exactly
  as they were: nothing about who owned what or what was ever recorded
  against them is destroyed. Removal still cascades the same way it always
  did (removing a Programme takes every Sub-programme/Unit/Individual
  beneath it, every KPI any of them own, and every login account that only
  exists because of them, with it — see `routes/org.js`'s
  `cascadeSoftDeleteProgramme/Sub/Unit/Individual`), just as a stamp instead
  of a destructive delete, so it's fully reversible: a `POST .../restore`
  route for each of Programmes, Sub-programmes, Units, Individuals, KPIs and
  KPI templates (`routes/kpis.js` / `routes/kpiTemplates.js`), a KPI
  assignment (re-assigning the same person restores their original row
  rather than inserting a duplicate — the `UNIQUE(kpi_id, individual_id)`
  constraint on `kpi_assignments` means it has to), and user accounts
  (`routes/users.js`) clears the stamp on the row (and, for the cascading
  ones, everything structurally beneath it) in one transaction. Every one of
  those `GET /removed` routes now backs a real, reachable **"Recently
  Removed"** panel with a one-click Restore per row — Organisation & People
  for Programmes/Subs/Units/Individuals, a new panel on KPI Management for
  KPIs and templates, and a new one on Permissions &amp; User Directory for
  accounts removed directly from there. The KPI Management and Permissions
  panels are new this round — `GET /api/kpis/removed` and
  `POST /api/kpis/:id/restore` already existed and worked correctly, but
  had no frontend anywhere at all, so "recoverable" was only true in the
  database, not reachable by an actual user without calling the API by
  hand; `GET /api/users/removed` didn't exist until now either. A
  deactivated login is blocked from signing in (`routes/auth.js`'s
  `POST /login`) and, just as importantly, a token issued *before* the
  account was deactivated stops working on its very next request
  (`middleware/auth.js`'s `requireAuth`) rather than staying valid for the
  rest of its natural expiry — restoring the account immediately lets both
  sign-in and any still-open session work again. And separately from all of
  the above: every single removal in the UI — Programmes/Subs/Units/
  Individuals, a KPI, a KPI template, an account, a message, clearing a
  manual override, unassigning someone from a shared KPI, even removing
  your own profile photo — now asks for confirmation first with
  `window.confirm`, describing exactly what's about to happen and, for
  anything soft-deleted, saying plainly that it's recoverable rather than
  destructive. Two of those confirmations used to say **"This cannot be
  undone"** for actions that were already genuinely reversible (deleting a
  KPI, removing a user account) — leftover wording from before soft-delete
  landed, contradicting what the backend actually did; both are corrected
  now.
- **Manual overrides are soft-deleted too, down to the individual field
  pair**: clearing a manual override on an automated KPI used to really
  erase the override value and the reason someone typed for it — the one
  place left in this app where a genuine, user-entered figure was destroyed
  outright with no way back. `kpi_values` now carries a shadow
  (`override_cleared_value` / `override_cleared_note` / `override_cleared_at`)
  that "Clear override" (`DELETE /api/kpis/:id/override`) fills in from the
  live fields before nulling them, and a new
  `POST /api/kpis/:id/override/restore` copies them straight back — the
  same shadow-and-restore shape every other deletion in this app uses, just
  scoped to one field pair on an existing row instead of a whole entity,
  since there's no separate row here to stamp `deleted_at` on. The shadow is
  retired the moment a genuinely new override is applied over it (a fresh
  value supersedes stale "undo" history, the same as everywhere else), and
  restore requires a clean slate — no live override already in place —
  so it can never silently clobber one applied since the clear. Both
  `KpiCard.jsx` and `ApprovalsTable.jsx` show a "Restore override (value)"
  button the moment there's something to restore, right next to where
  "Clear override" was clicked.
- **Data refresh**: every action you take (saving a value, submitting,
  approving, returning, an override) reloads its own data immediately
  afterwards, so what you just did is reflected right away. There's also
  a manual refresh control in the header ("Synced Xs ago") if you want to
  pull in a change someone else made — it used to poll automatically
  every 20/60 seconds, but that background refresh was re-rendering the
  whole app on a timer regardless of what you were in the middle of
  doing (typing a value, or looking at a drilled-down part of the
  Overview tree), so it's on-demand now instead.
- **Drill-down Overview navigation**: a "Programme structure" tree in the
  sidebar — the same click-through navigation as the original prototype
  — lets you walk Programme → Sub-programme → Unit → Individual and see
  each one's own breadcrumb, own headline stats, and own KPIs, with its
  children one click further in. A global role (Exec/CPU/ICT Admin) can
  browse the whole structure from "All Programmes" down; a scoped role
  (Sub Rep/Unit Head/Individual) sees only their own branch, and the tree
  is only shown while they're on Overview (elsewhere, the sidebar is just
  their nav). Every KPI a role could already see, they can still see —
  this only changes how you get to it.
- **Charts**: RAG (on track / at risk / off track / no data) distribution
  is now a real chart — a bar chart on Overview for the KPIs in your own
  scope, and a per-programme grouped bar chart on Reports — not just the
  status chips and counts. Both keep the same colors as the RAG chips
  used everywhere else, and the underlying numbers are also still shown
  in the Reports table.
- **Alerts**: a bell icon in the header surfaces, in one place, anything
  that needs your attention right now — a submission of yours that was
  returned with a comment, a submission waiting on your approval, or a
  KPI in your scope that's currently off track — computed live from the
  real data, not a separate notification system to keep in sync.
- **Timestamps**: submitted/approved timestamps are shown directly on
  each KPI card once they exist, in addition to the full audit log.
- **A smooth submission → approval → return → feedback → reports flow**:
  My Data Entry groups a submitter's KPIs into "Needs your action" (never
  started, or returned with feedback), "Submitted — awaiting review", and
  "Approved" — so it reads as a queue, not a flat list. A return always
  carries a reviewer's comment, which follows the KPI everywhere it's
  shown (a warning banner on Overview, a highlighted feedback box right
  on the card) until it's resubmitted. Approvals Queue shows counts up
  front and keeps a "Decided this period" section so an approver can see
  what they already acted on. Reports adds a live "Submission flow" tile
  (not started / returned / awaiting review / approved, org-wide) and a
  "Recent activity" feed of the latest submissions, approvals, and
  returns — so performance (RAG) and process (is the data even in yet)
  are visible side by side, for anyone holding `view_audit`.
- **Compliance & Escalations** (CPU and Executives): two distinct concerns,
  computed live from real timestamps and real values, exactly like the
  rest of the app — nothing pre-baked. Late-submission compliance checks,
  for each Sub-programme's own KPIs, whether this period's submission came
  in within the cut-off days set in Settings, and escalates (Programme
  Head, then VC/Council) once it's late enough. Red-KPI performance
  escalation is separate: it counts how many reporting periods in a row a
  KPI has been Red — a KPI can be submitted perfectly on time and still
  escalate this way. Both trigger thresholds live in Settings. As the page
  itself says, there's no email/notification engine behind either — it's a
  live view for a person to act on, the same honest scope as the alerts
  bell.
- **Structural-change proposals** (CPU by default, via `manage_framework`):
  a durable, real log — not a mock list — for recording a proposed
  Programme/Sub-programme change (e.g. "split this Sub-programme in two")
  ahead of a planning checkpoint. Anyone can see the queue; only
  `manage_framework` holders can add to it. There's no approval workflow
  wired to an entry yet — it's a record for CPU/exec to review manually,
  kept separate from the immediate, direct unit/KPI creation elsewhere on
  Framework.
- **Monthly/quarterly/bi-annual/annual performance appraisals, automated
  at every tier**: data entry itself always stays monthly (that's the real
  unit of truth), but Overview and Reports carry a separate, read-only
  "performance lens" — a period-type picker (Monthly / Quarterly /
  Bi-annual / Annual) that fetches the real range of months involved
  (`GET /api/kpis/values-range`) and reports each KPI's progress as of the
  latest actual value filed within that range. The appraisal itself is
  never manually scored: the same `performanceRollup()` math (average
  progress %, and a green/amber/red/no-data breakdown) runs identically at
  every tier, over the real, live **cascade** of KPIs a node is built from
  (`nodeOwnKpis()`) — an Individual's own KPIs; a Unit's own KPIs plus every
  one of its Individuals'; a Sub-programme's own plus every one of its
  Units' (Individuals included, transitively); a Programme's own
  Sub-programmes' KPIs plus everything beneath them (Reports' three-tier
  table). A real Individual's own monthly number is never siloed at the
  tier it was entered — it moves their Unit's average, which moves their
  Sub-programme's, which moves their Programme's — so a person's self-view
  and CPU's oversight view are always built from the same real figures,
  never a separate re-scoring at each tier. The appraisal card on both
  Overview and Reports now also carries a real RAG-distribution pie chart
  and a variance bar chart, both driven by the same period-type picker —
  switch Monthly/Quarterly/Bi-annual/Annual and both recompute live.
- **A genuine variance-vs-pace tool, with attention alerts**: variance here
  means the honest M&E sense — not "how close to the target", but whether a
  KPI is running ahead of, on, or behind the pace it would need to be at
  *by this point* to reach its target on schedule (a KPI moving in a
  straight line from baseline to target sits at 0 variance; a long way
  from its target in January can still be perfectly on pace). Crucially,
  "this point" is always pinned to the month the KPI's own latest value was
  actually recorded for — never the nominal end of whichever period type
  happens to be selected — so switching to "Annual" mid-year doesn't
  falsely penalize every KPI for a year that hasn't finished yet. Any KPI
  running 10+ points behind its expected pace is flagged for attention (a
  banner on Overview/Reports listing every one, plus a badge right on its
  own card); 10+ points ahead is flagged too, just not as an alert.
- **Generated reports**: Reports produces two real, tangible artifacts from
  whatever period is currently selected — a "Download CSV" button that
  builds and downloads an actual `.csv` file of the full Programme /
  Sub-programme / Unit appraisal table, and a "Print report" button that
  triggers the browser's print dialog against dedicated `@media print`
  styles that hide the app's navigation/controls and leave just the report
  content.
- **Annual Plan & Budget** (a real submission/approval cascade, structurally
  parallel to the KPI one): each Unit/Department/Faculty/Region enters its
  own next-cycle planning narrative and a requested budget figure and
  submits it to their Sub-programme Rep, who approves or returns it with a
  comment. The Sub-programme's own budget is never typed in separately —
  it's always the live sum of its units' requests — and once approved, the
  Rep submits their own sub-level narrative up for approval. At the
  Programme tier, a real **Programme Head** account (see below) — and
  only that Programme's own Programme Head, not CPU — approves or returns
  each of their own Sub-programmes' plans, then compiles/submits their own
  Programme's narrative (its budget is, again, always the derived sum of
  its sub-programmes). CPU alone compiles and submits the single
  University Annual Plan for the cycle, gated by `submit_annual_plan`.
- **Programme Head — a real account tier, and the sole approver of its own
  Sub-programmes' plans, not a CPU stand-in**: one Programme Head account
  per Programme (`role: "programme"`, scoped to that Programme's id), with
  genuine, server-checked authority — never a role label alone. On
  Overview, they land straight on their own Programme and can drill into
  every Sub-programme beneath it (and everything under those), read-only,
  the same drill-down every other role uses — but never another
  Programme's. On Annual Plan & Budget, they approve/return their own
  Sub-programmes' plan proposals and compile/submit their own Programme's
  plan — `POST /api/plans/subs/:id/approve` and the Programme-tier routes
  check `role === 'programme' && scope_id === <that Programme's id>`
  server-side, not just role, so a Programme Head can't act on another
  Programme's plan even by calling the API directly (verified with a real
  403). CPU deliberately has **no** alternate path into this one approval:
  `approve_own_tier` sits in CPU's permission set for other tiers, but
  `POST /api/plans/subs/:id/approve|return` checks `isProgrammeHeadOwner`
  and nothing else — CPU calling either route directly gets the same 403
  a Programme Head from a different Programme would (also verified live).
  The CPU-facing Annual Plan & Budget screen shows each Sub-programme's
  status for oversight but renders no Approve/Return controls on it — only
  the Programme Head who owns that Sub-programme's Programme sees those.
  ICT admin can promote any existing account to Programme Head from the
  Permissions page, choosing which Programme it's scoped to.
- **University Council — a real approval gate on the Annual Plan, not just
  CPU's word for it**: a new `council` role (permission `validate_annual_plan`,
  its own permission group "Governance") sits above CPU on the University
  Annual Plan cascade. CPU still compiles and submits the single University
  Annual Plan for the cycle, but it no longer takes effect on submission —
  it moves to `submitted` and waits for the University Council to review the
  full compiled structure (every Programme, Sub-programme, and Unit beneath
  it, the same live data the rest of the app already shows) and either
  **approve** it (`status: 'approved'`, and only then is it "the official
  Annual Plan in effect for" that cycle, called out as such everywhere it's
  shown) or **return** it with a required comment, which reopens it as a
  draft for CPU with the feedback attached, the same return/resubmit pattern
  already used at every other tier. Both actions are gated server-side by
  `validate_annual_plan`, not just hidden in the UI — a non-Council account
  gets a real 403 calling the approve/return endpoints directly. While a
  plan is submitted or approved, CPU's own edit and (re)submit endpoints are
  now genuinely locked (previously an oversight: unlike every other tier in
  the same file, the University-level routes had no server-side lock at
  all, so CPU could silently overwrite an in-effect plan — closed as part of
  this feature).
- **Vice Chancellor — designated Executive Owner, accountable for overall
  institutional performance**: a single-holder `is_executive_owner` flag on
  `users` (enforced in one DB transaction — setting it on one account always
  clears it from every other), assigned by default to the seeded VC account
  and reassignable by ICT admin from the Permissions page. It's a real,
  publicly-visible designation (`GET /api/org` returns `executiveOwner:
  {id, name, title}`, the same visibility as the rest of the plain org-chart
  data) rather than an extra approval gate: it surfaces as a badge next to
  the holder's name in the header everywhere they're signed in, and as an
  accountability note directly above the "Overall Institutional Performance
  — All Programmes" appraisal on Overview — the same live, real rollup every
  other tier already had, just named and attributed at the top.
- **Admin-grantable Overview navigation limits**: ICT admin can now cap, per
  account, how deep that account's Overview drill-down is allowed to go —
  no restriction (the overall structure), or capped at Programme,
  Sub-programme, or Unit level — from a new control on the Permissions page,
  independent of role or permissions (an account can hold every reporting
  permission there is and still be capped from drilling past its own
  Programme in the Overview tree, if that's what ICT admin sets). This is
  enforced in three places, not just one: the node-selection handler itself
  refuses to select anything past the cap (the real backstop, not a UI
  nicety), the main content area shows a lock note instead of the next
  tier's cards, and the sidebar's Programme-structure tree dims and
  locks the same rows with a 🔒 icon — so a capped account sees the shape of
  the structure it can't enter (transparency about what exists) but can't
  actually open it from anywhere in the app.
- **Automated quarterly and bi-annual targets**: alongside the existing
  monthly figures, every KPI card now also shows its own automatically
  computed "Automated Q_ target" and "Automated H_ target" — the same
  straight-line baseline-to-target pace math the variance tooling already
  uses (`expectedValueForMonth`), evaluated at the end of the current
  quarter and half-year rather than the current month. Nobody enters or
  edits these — they're derived live from each KPI's own baseline, target,
  and current month, exactly like the rest of the app's rollups, and they
  update automatically as the KPI's baseline/target change or the period
  rolls forward.
- **Performance, automated all the way up to "overall"**: this was mostly
  already true of the existing rollup architecture (every tier's appraisal —
  Individual → Unit → Sub-programme → Programme → All Programmes — is a live
  computation over real KPI values, never a manually re-entered summary at
  a higher tier), so the real gap closed here was giving that top-of-cascade
  number an explicit owner and framing: it's now presented as "Overall
  Institutional Performance", directly under the Executive Owner
  accountability note described above, rather than just another
  "All Programmes" card among several.
- **Actual vs. expected pace chart — every KPI, labeled by owner and tier,
  scrollable**: the per-KPI variance chart on Overview's appraisal card no
  longer caps or samples down the number of KPIs shown — every KPI with a
  value in the selected period gets its own pair of bars, however many that
  is. Each bar's tick carries three lines: the KPI's own name, who owns it
  (the same "owner" resolution already used elsewhere in the app), and —
  underneath that — which tier the owner is: Individual, Unit, or
  Sub-programme. That third line is what actually disambiguates two KPIs
  that happen to share the exact same name but belong to two different
  people (e.g. two different Individuals each holding their own "Vacuum
  Cleaning" duty KPI in two different Units) — the name alone can't tell
  them apart, but the owner name plus tier always can, both on the chart
  itself and in its tooltip. All three lines are shortened only as far as a
  single chart slot's width genuinely requires — hovering any bar's tooltip
  always shows the complete, untruncated name, owner, and tier regardless of
  how the on-chart label was shortened. Each KPI keeps a fixed minimum slot
  width, so once there are enough of them to genuinely not fit the card, the
  chart scrolls horizontally in both directions, all the way to the last
  KPI, rather than squeezing every label into an unreadable sliver. Whether
  the "↔ Scroll, drag, or use the arrows to see all N KPIs" hint and the
  ‹ › buttons show up is decided by actually measuring the chart's real
  width against its card's real width in the browser (with a `ResizeObserver`
  watching for layout changes — a resized window, a toggled sidebar), not by
  guessing from a fixed KPI count — a count-based guess is wrong on a
  narrower window or a phone (needs scroll sooner) and on a very wide
  monitor (needs it later), so measuring live is what makes the hint/arrows
  appear exactly when scrolling is genuinely possible, no more and no less.
  Scrolling itself works four ways, not just one: an ordinary vertical
  mouse-wheel scroll over the chart moves it left/right (a plain wheel
  doesn't scroll a horizontally-overflowing element by default in any
  browser, and React's own default wheel handling is passive and silently
  blocks the conversion — this is wired up with a real, manually-attached,
  non-passive browser listener instead, so it works cleanly on the first try
  on every browser), a genuine horizontal trackpad swipe or shift+wheel
  still passes straight through unconverted, click-and-drag ("grab to
  scroll") works for a plain mouse with neither, and the ‹ › buttons step
  the chart by a few KPIs at a time for anyone who'd rather click than
  gesture. A short list that genuinely fits its card renders exactly as it
  always did — no hint, no buttons, no scrollbar, filling the
  available width. The "N KPIs need attention" list right below the chart
  gets the same treatment vertically: once more than 6 KPIs are flagged,
  that list caps to
  a fixed height and scrolls up/down (with its own "↕ Scroll to see all N"
  hint) instead of growing the page indefinitely — again, only once it's
  actually long enough to need it.
- **Internal messaging, across every tier**: a real "Messages" page open to
  every signed-in account regardless of role — write to anyone else in the
  system directly (an Individual can message the Vice Chancellor, not just
  their own chain of command), with a real Inbox/Sent split and read/unread
  state that persists (`messages`/`message_recipients` tables, not
  component state that resets on refresh). There's no outbound SMTP/email
  delivery configured for this reference deployment — same honest scope as
  the admin-assisted password reset — so this is the genuine, working
  answer: an in-app inbox addressed by each account's real `@zou.ac.zw`
  email, with an unread-count badge on the nav item. Sent messages carry a
  real WhatsApp-style double-tick delivery/read marker — gray once
  delivered, colored once every recipient has actually opened it — built
  directly off each recipient's real `read_at` timestamp, never a guess
  (open the same message as the recipient and the sender's tick genuinely
  changes color on their next look at Sent). A short notification tone
  (synthesized in the browser, no audio file to ship) plays when a message
  you compose is sent, and again when your unread count goes up on a
  refresh — with a mute toggle in the header (🔔/🔕, remembered per device)
  for anyone who'd rather it stayed silent.
- **Light / dark / system theme**: a toggle in the header (cycling
  Light → Dark → Match system) persisted to `localStorage` and applied
  before first paint (no flash of the wrong theme on reload). Built as a
  small set of semantic CSS custom-property tokens (`bg-page`, `bg-surface`,
  `text-ink`, `border-line`, …) rather than a `dark:` variant bolted onto
  every element, so the whole app — including the RAG bar charts, which
  render as inline SVG and need their colors read explicitly — re-themes
  from one attribute on `<html>`.
- **Mobile-responsive dashboard**: the Overview drill-down (org tree,
  breadcrumb, KPI cards, the RAG chart, the appraisal card), the sidebar
  (a slide-over on narrow screens, opened from the header's ☰ button), and
  every other page were verified at a 375px-wide viewport — no horizontal
  overflow, no unreachable controls, the same real data and real actions
  as desktop. The sidebar and the main content area scroll fully
  independently of each other on mobile — the app shell is locked to
  exactly the viewport height (`h-dvh`, not just a minimum), so there's
  never a second, page-level scrollbar fighting the two nested ones, and
  the body is locked while the mobile sidebar overlay is open so a touch
  drag over it can't rubber-band the page underneath.
- **Admin user directory**: the ICT Systems Administrator's Permissions
  page is also a searchable directory of every account in the system — one
  search box matches name, email, title, role, and where the person sits
  in the org tree (e.g. searching a unit or sub-programme name surfaces
  everyone under it) — and an "Edit profile" action lets ICT admin correct
  a user's name, title, or email directly (separate from, and in addition
  to, the existing role-change and permission-grant controls).
- **Two more real, revocable permissions — `view_overview` and
  `view_framework`**: Overview and Framework used to be visible to every
  signed-in user unconditionally; every account is still seeded holding
  both, but ICT admin can now actually take either away from one specific
  person from the Permissions page, exactly like Reports/Audit/Settings
  already worked — a genuine server-enforced gate (`GET`-level nav
  filtering plus a route-level check on the frontend router), not a
  cosmetic toggle.
- **A narrower `add_individual` permission**: creating a Unit and creating
  an Individual used to both live behind the one broad `manage_org_units`
  grant. ICT admin can now instead hand a Sub-programme Rep or Unit Head
  just the ability to add an Individual — and it's genuinely
  scope-restricted server-side: a Unit Head holding only this permission
  can add someone into their own unit and nowhere else, a Sub Rep into any
  unit within their own sub-programme and nowhere else — verified with a
  real 403 when either tries to add outside their scope.
- **Finer-grained org-structure permissions — `create_org_units` and
  `edit_org_units`**: the broad `manage_org_units` grant used to be the only
  way to reach Organisation Builder's create/update forms at all (removal
  and restore still work this way — see below for why). Two new,
  independently-grantable permissions narrow that down the same way
  `edit_targets` already narrows `create_kpi`: `create_org_units` lets ICT
  admin hand someone the ability to build new Programmes/Sub-programmes/
  Units without also letting them touch or remove anything that already
  exists; `edit_org_units` lets someone correct an existing entity's own
  name/head/kind without letting them create new ones or remove anything.
  Neither grants remove/restore — that authority deliberately stays behind
  `manage_org_units` alone, since undoing a removal should require the same
  authority that could remove it. Both are genuine, server-enforced gates on
  every POST/PATCH route under `/api/org` (`requireAnyPerm`, not a frontend-
  only check) — verified live with a real 403 hitting the wrong route from
  an account holding only one of the two, and a real 200/201 on the route
  each permission is actually meant to unlock.
- **Profile photos**: every user can upload, replace, or remove their own
  photo from the new "My Profile" page (reachable from the header, or the
  sidebar on mobile). The image is resized and re-compressed to a small
  square client-side before it's ever sent, then stored as a real, persisted
  `data:` URL on their account — it shows up immediately in the header, the
  sidebar (mobile), and the ICT admin user directory, not a mocked preview
  that resets on refresh. Every photo (your own on My Profile, or anyone
  else's small thumbnail in the ICT admin user directory) is also clickable
  — it opens a full-size lightbox view, since the thumbnails everywhere
  else are deliberately tiny for layout and were otherwise the only way to
  see a photo at all.
- **Self-service password change, and a real answer to "forgot it"**: every
  user can change their own password from My Profile (their current
  password is verified server-side first). There's no email or SMS
  infrastructure behind this app to send a "reset your password" link
  through, and faking that flow with nowhere for the email to go would be
  exactly the kind of mocked feature this project avoids — so instead, an
  ICT Systems Administrator can reset anyone's password directly from the
  Permissions page (typing a specific new one, or generating a random one),
  the same immediate, real pattern already used elsewhere in this app for
  provisioning a new Unit Head's or Individual's account password.
- **Individuals see their whole unit, and can be assigned to contribute to
  one of its KPIs — with their own figures approved by their Unit Head and
  automatically summed into the Unit's total**: an Individual used to only
  ever see their own personally-owned KPI(s) — nothing about the
  Department/Unit/Faculty/Regional Campus they actually belong to.
  Overview now also shows every KPI their own unit owns, read-only, so
  "what is my unit being measured on" is visible even for KPIs someone
  else enters. On top of that, a Unit Head can assign one specific Unit
  KPI to one or more named people in their unit — "this is one of your
  duties" — from an "Assign to a team member" control right on that KPI's
  card (a real, persisted grant, `kpi_assignments`, checked server-side; a
  Unit Head can only assign their own unit's KPIs to people in that same
  unit). Where this used to hand the assignee the KPI's own value outright,
  it's now a genuine two-step chain, because several people are routinely
  assigned the same KPI (e.g. three advisors each counting the students
  they mentored) and their figures need combining, not overwriting one
  another: each assignee gets their own monthly figure — a **contribution**
  (`kpi_contributions`), with its own draft → submit → approve lifecycle,
  entered and submitted from a dedicated card in their own My Data Entry.
  Their Unit Head reviews each teammate's contribution individually from
  the Approvals Queue (a "Contributions from your team" section, alongside
  a per-assignee breakdown right on the KPI card) and approves or returns
  each one with a comment, exactly like any other submission. The moment a
  contribution is approved, the KPI's own value is automatically
  recomputed as the live sum of every currently-approved contribution for
  that period (`recomputeUnitTotal`, server-side) — the KPI is permanently
  marked automated once it has any assignees, and its own existing
  override control (already built for automated KPIs) is what lets the
  Unit Head hand-correct the computed total if it's ever genuinely wrong.
  The Unit Head then submits that real, computed total onward to the
  Sub-programme Rep exactly like any other Unit KPI — the approval chain
  above the Unit Head never changed, only how the Unit's own number gets
  built underneath them. If an assignee's contribution is amended after
  the Unit's total was already approved by the Sub Rep, the total is
  recomputed and — if it actually changed — the Unit's own approval
  reverts to "submitted" for re-review, the same amendment-safety rule
  already used everywhere else values can change after approval. A KPI
  assigned to no one behaves exactly as before — this table, and this
  whole flow, is only ever touched once a KPI actually has assignees.
- **Creating a KPI can seed its custodians in the same step, and a KPI can
  be edited or deleted afterward**: assigning several people to a shared
  Unit KPI (see above) used to always mean creating it first, then a second
  trip to "Assign to a team member" per person. Framework's "Create a KPI"
  form now shows a multi-select of that unit's own Individuals the moment a
  Unit owner is picked — check as many as apply and they're all assigned in
  the same `POST /api/kpis` call (`assigneeIds`, validated server-side
  exactly like the existing single-assign endpoint: every id must actually
  belong to that unit). Separately, "Edit or delete a KPI" is a genuine
  update/delete pair, not just the narrower baseline/target patch that
  existed before: `PUT /api/kpis/:id` (gated by `create_kpi` — a bigger
  authority than `edit_targets`, since it can rename a KPI or redefine what
  it measures, not just adjust its numbers) and `DELETE /api/kpis/:id`,
  which really does remove the row along with everything that points at
  it — its values, assignments, and contributions all cascade (`ON DELETE
  CASCADE`) — while past audit_log entries about it are left exactly as
  the individual-removal route already treats them: a real historical
  record, each entry self-contained, not tidied away just because the KPI
  itself is gone now. Holding only `edit_targets` still gets the narrower
  baseline/target-only form, unchanged, with no Delete button.
- **A message can be deleted — genuinely, per participant, like real
  email**: deleting a message from your Inbox only ever removes YOUR copy
  of it (`message_recipients.deleted_at`) — the sender's Sent view, and
  every other recipient's Inbox, are untouched; deleting from your own
  Sent only clears your copy (`messages.sender_deleted_at`) and never pulls
  the message out of anyone's Inbox. Once every participant — the sender
  AND every recipient — has cleared their own copy, the underlying row has
  nothing left pointing at it and is purged outright, so deleted mail
  doesn't sit around forever once nobody can actually see it.
- **A real PDF, generated for whatever cadence is selected**: alongside the
  existing CSV/print, Reports now has a genuine "Download PDF" button — an
  actual multi-page PDF document (via `jspdf`/`jspdf-autotable`, built
  client-side) containing the same three-tier Programme/Sub-programme/Unit
  table, the same flagged-variance list, and the same org-wide RAG counts
  already on screen, for whichever Monthly/Quarterly/Bi-annual/Annual
  period is currently picked. It's built from the exact same computed
  `programmeRows`/`orgVariance`/`orgRagCounts` the page renders — never a
  second computation that could quietly drift from what's on screen, and
  never dependent on someone remembering to "print to PDF" themselves.
- **A one-time welcome after signing in**: a small "Welcome back, `<name>`"
  banner appears the moment the authenticated app shell first mounts and
  fades away after 10 seconds on its own — a genuine one-shot (it fires
  once per sign-in, keyed to that account, never again while navigating
  around the app afterward), not a toast that could be confused with a
  save confirmation.
- **Real protection against losing typed-but-unsaved work to an
  interruption** — a power cut, a crashed tab, a closed laptop lid — before
  anyone got to click Save: KPI value/note entry, a contributor's own
  figure, and composing a message all mirror every keystroke into
  `localStorage` (synchronously — already durable before any network
  request would even fire), scoped per user/KPI/period so it can never
  bleed into someone else's entry. This changes nothing about when data
  actually reaches the server — the explicit Save/Submit buttons are still
  what writes a real value, deliberately, since a KPI's draft/submit/
  approve lifecycle depends on the user choosing when something is ready.
  What it adds is the safety net underneath: if the tab reopens later and
  finds a draft that disagrees with what the server has, the field starts
  from that draft instead of silently discarding it, with a small banner
  explaining it hasn't actually been saved yet — verified by typing a
  value, reloading with nothing saved, and confirming it comes back.
  Saving for real clears the draft, since the server now agrees.
- ~~An Individual can browse and self-claim their unit's KPIs~~ — **superseded**
  by the Unit-scoped KPI template pool further down ("What's real here" →
  the `kpi_templates` entry): this self-claim mechanism (and its
  `POST/DELETE /api/kpis/:id/claim` routes) has been removed outright, since
  it let an Individual volunteer into their Unit Head's own aggregate KPI
  just by browsing it. An Individual now only ever picks up KPIs genuinely
  created for individuals; a Unit Head can still explicitly delegate one of
  their Unit's own KPIs via the unchanged `POST/DELETE /api/kpis/:id/assign`.
- **Refresh is reachable everywhere, and has a fast path**: the header's
  refresh control used to disappear below the desktop breakpoint —
  invisible on mobile/tablet, a real accessibility gap now fixed. It's also
  no longer a single action: clicking it now runs a genuine "quick
  refresh" — only the fast-changing, period-scoped data (values,
  contributions, the performance lens, unread messages) — while the small
  caret opens a two-item menu offering that same quick refresh alongside
  the slower full refresh (also reloading the org chart, KPI catalogue,
  settings, and assignments, for the rarer case one of those changed).
  Verified by watching actual network calls: quick refresh fires 4 requests,
  full refresh fires all 8 — never a difference in what each shows on
  screen, just how much it re-fetches to get there.
- **The Annual Plan & Budget page now has a real "Download PDF"**,
  mirroring Reports' pattern exactly: a genuine multi-page PDF (`jspdf`/
  `jspdf-autotable`, built client-side) with the University Annual Plan's
  status and budget, the full Programme → Sub-programme → Unit proposal
  table, and every Programme's planning narrative — all built from the
  exact same `data` object (already scoped to the caller's role by
  `GET /api/plans`) the on-screen panels render, never a second
  computation that could drift from what's on screen.
- **The notification bell and the sound toggle are two different icons
  now**, not the same 🔔/🔕 emoji reused in two places — a real bell shape
  for alerts, a distinct speaker shape (with sound waves when on, an X
  when muted) for the message-tone toggle, both drawn in the same sky-blue
  accent so they read as a matched pair of controls without being
  mistakable for each other.
- **Every KPI card now shows an automated monthly pace, not just the
  static Baseline/Target/Current figures**: alongside those three, a real
  progress bar and two computed numbers — "Expected by `<month>`" (where a
  straight-line pace from the KPI's baseline to its annual target says it
  should be by this point) and "Assumed baseline this month" (that same
  pace's position at the end of the PREVIOUS month) — turn "progress to
  date" into a genuine monthly performance figure: the gap between this
  month's actual entry and the assumed baseline is what this one month
  alone was expected to move the needle by, shown as "This month so far:
  `±n` (expected `±n`)" plus an On/Behind-pace badge. None of it is typed in
  or stored anywhere — `lib/scope.js`'s `expectedValueForMonth`/
  `assumedMonthlyBaseline`/`monthlyPace` compute it fresh from the KPI's own
  baseline/target and whatever value is on screen, the same automated-pace
  math Reports' variance analysis already used in % terms, just expressed
  here in the KPI's own real units and surfaced at the point of entry
  instead of only in a later report.
- **Every year dropdown in the app — data entry, the performance lens, the
  Annual Plan cycle — now reaches out to 2065**, not just a year or two
  around today, via one shared `yearRange()` helper so extending how far
  any of them looks into the future is a single number to change.
- **A contributor sees the whole KPI they're submitting toward, not just
  their own figure**: `ContributionCard` — the surface an assigned or
  self-claimed Individual submits their own number through — now shows the
  shared KPI's real Baseline, annual Target, its current live automated
  total (the sum of everyone's approved contributions), and its automated
  score (the same RAG % a Unit Head or owner sees), plus a red alert banner
  right on the card whenever that score is off track, telling them their
  figure is what would help bring it back on pace. Previously they could
  only see their own submitted value in isolation — asking someone to
  submit "their part" without ever showing them the whole they're part of.
  This is purely additive: the automated total, its RAG score, and the
  existing off-track alert in the notification bell were all already
  computed elsewhere in the app (see the pace/variance math above); this
  just surfaces the same real numbers at the point they matter most —
  right where the person is about to submit.
- **Data entry is more readable, and approval actions moved out of it**:
  every KpiCard/ContributionCard on My Data Entry now groups its automated
  figures (Baseline/Target/Current, the monthly-pace bar and its stats)
  into one visually distinct panel instead of a dense run of small inline
  text, with a labeled legend on the pace bar (expected pace vs. actual vs.
  the assumed-baseline marker) so the colors don't have to be guessed, and
  larger type throughout (KPI names, RAG chips, section spacing) for
  quicker scanning. Separately, a Unit Head's own My Data Entry used to
  ALSO show their team's Approve/Return buttons for shared-KPI
  contributions — the exact same decision Approvals Queue exists for,
  duplicated in two places. That's now split cleanly: My Data Entry shows
  a read-only "N of M approved · N awaiting your review in Approvals
  Queue" summary, and the actual Approve/Return actions live only on the
  Approvals Queue page. The underlying KPI lists were already correctly
  scoped per role before this (an Individual only ever sees their own
  KPIs, a Unit Head only their own unit's, a Sub-programme Rep only their
  own sub's — see `canEnterData`/`isOwner` in `lib/scope.js`) — this only
  removed the duplicated approval UI, it didn't change who sees what KPI.
- **Anyone, at any tier, can mark a KPI "not relevant to me" and hide it
  from their own browsing view — genuinely per-person, never shared**: a
  new `kpi_hidden` table (`user_id`, `kpi_id`) backs a real
  `GET/POST/DELETE /api/kpis/:id/hide` — no permission gate beyond being
  signed in, since it's a personal display preference, not a data change.
  It shows up wherever someone browses KPIs beyond their own duties —
  Overview's drill-down into any node, and an Individual's "your unit's
  other KPIs" self-claim list — as a small "Not relevant — hide" link, with
  a transparent, reversible "N hidden from your view — show" toggle right
  next to the section heading (nothing is ever silently gone for good).
  Two safeguards keep this from being real functionality dressed up as a
  toggle: it can never hide a KPI that's actually the viewer's own duty
  (computed via `canEnterData`/`canContribute`, regardless of which page
  passes the option in) — canceling any risk of using it to dodge an
  accountability item — and it only ever filters the list of individual
  KPI cards rendered, never the objective rollup numbers (headline stats,
  RAG distribution, variance) on the same page, which stay accurate
  regardless of what one person chose to declutter. Verified directly
  against the database: hiding a KPI as one user leaves a second user's own
  hidden list completely untouched, and a hide survives a full page reload
  (it's a real server-side preference, not a client-side illusion).
- **The monthly pace tracker (see above) is now shared, not duplicated,
  and reaches contributors too**: `MonthlyPaceBar` and the small `Fig`
  stat tile were pulled out into their own components so KpiCard and
  ContributionCard render the exact same pace picture from the exact same
  code, instead of two copies that could quietly drift apart. It also
  picked up a couple of real readability improvements — Baseline and
  Target are now labeled directly on the two ends of the bar itself, and a
  "no value recorded yet" note appears when there's nothing to compare
  against yet — and, since ContributionCard now renders it against the
  shared KPI's own value row, an assigned contributor sees the identical
  automated pace picture their Unit Head sees, not just their own
  isolated figure.
- **A KPI meant for individuals is now created once, against a Unit, not
  once per named person**: a new `kpi_templates` table (see `db.js`) backs
  a real `GET/POST /api/kpi-templates`, `DELETE /api/kpi-templates/:id`,
  and `POST /api/kpi-templates/:id/pick`. In Framework's "Create a KPI"
  form, choosing "Individuals (under a unit)" as the owner type swaps the
  usual owner picker for a Unit picker — submitting creates the definition
  once, owned by nobody yet, scoped to that unit. Anyone in that unit then
  sees it in their own My Data Entry, under "KPIs for individuals in your
  unit", and picking it up ("This is mine — add it") instantiates a real,
  independent `kpis` row for that person alone (owner_type='individual',
  their own baseline/target/value to enter and submit) — never a number
  shared or summed with anyone else who also picks it up. Framework also
  gained a "KPIs for individuals — by unit" management list showing real
  adoption (`N of M in this unit picked up`) and a way to remove a template
  (removing it only takes it out of the pool for anyone who hasn't picked
  it up yet — see `kpis.template_id`'s `ON DELETE SET NULL` — it never
  touches anyone's already-instantiated personal KPI).
- **Individuals no longer browse and self-claim their whole Unit's own
  aggregate KPI** — the self-claim feature from an earlier round
  (`POST/DELETE /api/kpis/:id/claim`) has been removed outright in favor of
  the template pool above, so an Individual's actionable lists only ever
  show KPIs genuinely created for individuals, never "the unit's" KPI
  (which belongs to the Unit Head's own official reporting number). A Unit
  Head can still explicitly delegate one of their Unit's KPIs to a specific
  person via the unchanged `POST/DELETE /api/kpis/:id/assign` — that
  remains a duty assigned TO someone by their Unit Head, which is a
  different, still-legitimate path from browsing and helping yourself.
  Verified server-side: `POST /api/kpis/:id/claim` now 404s, a template
  pick is rejected across unit boundaries, picking twice is rejected, and a
  picked KPI runs through the completely ordinary data-entry/submit/approve
  pipeline with zero special-casing. (Adding an Individual into the system
  already required picking their Unit from a dropdown — Framework's "Add an
  individual" form — before this round; that was already real and needed
  no change.)
- **Performance is now automatically cumulative — everywhere, across every
  tier**: what a submitter types into a KPI's period entry is treated as
  that period's own figure alone (stored in the new `kpi_values.entered_value`
  column), never a running total. The moment their Unit Head/Sub Rep/CPU
  approves it, the backend automatically computes the new official running
  total — `previousOfficialValue + entered_value` — and stores it in the
  existing `kpi_values.value` column (see `previousOfficialValue()` and the
  rewritten `POST /api/kpis/:id/approve` in `routes/kpis.js`), which is why
  every existing reader of `value` (RAG scoring, the monthly pace tracker,
  Reports, the Annual Plan PDF export) needed zero changes — it was always
  "the official cumulative figure" and still is, it's just computed for you
  now instead of typed by hand. `previousOfficialValue()` walks backward
  through real prior periods (skipping months nobody entered anything for,
  and correctly crossing year boundaries, e.g. Dec 2026 → Jan 2027), and
  falls back to the KPI's baseline when there's no earlier approved period
  at all. This is uniform across every ownership tier (Individual, Unit,
  Sub-programme) and also covers shared/contribution-based Unit KPIs —
  `recomputeUnitTotal` applies the identical previous-total-plus-this-period
  rule the moment a Unit Head approves the combined contributions for a
  period. The UI reflects the split honestly: KpiCard's editable field is
  now explicitly labelled "This period's entry", pre-filled from
  `entered_value` (never from the cumulative figure), with a line explaining
  what it'll be added to; the read-only "Current" figure is now labelled
  "Current (cumulative)" everywhere it appears, including on
  ContributionCard for people submitting into a shared total. Verified via
  direct API calls across a normal month-to-month run (15→20→23), a run
  with a skipped month in between, a Dec→Jan year-boundary rollover, and
  the shared-KPI contribution path (70→74→80) — all producing the correct
  automatic total with zero manual arithmetic.
- **Cumulative values now cascade forward automatically — a real,
  previously-confirmed correctness bug, now fixed**: amending and
  re-approving an already-approved period correctly recomputed *that*
  period's own total, but every LATER period that had already built its own
  approved total on top of the old figure silently kept it — reproduced live
  during a correctness audit (Jan 100→300, re-approved; Feb stayed frozen at
  the old 150 instead of becoming 350). `cascadeRecomputeForward()` in
  `routes/kpis.js` closes this: whenever a period's own effective value
  changes — final approval of a directly-entered KPI, `recomputeUnitTotal`
  reacting to a contribution being approved/amended/returned, or an override
  being applied/cleared/restored (which changes what `previousOfficialValue`
  resolves to for everyone after it, since an override always wins over the
  plain `value`) — it walks every later period forward in chronological
  order and rebuilds each one from the same rule that produced it
  originally: the now-correct `previousOfficialValue` plus that period's own
  already-recorded contribution (`entered_value` for a directly-entered KPI,
  a fresh sum of that period's own approved contributions for an automated
  one — never read back from a total that might itself have been stale). A
  period is only touched if its recomputed total actually differs, and each
  correction is written to `audit_log` as a `cascade_recompute` entry naming
  the old and new figure, so a downstream number that moves without anyone
  directly touching that period is still fully traceable. An
  already-approved directly-entered period's `status` is deliberately never
  reverted by this walk — the figure is corrected in place, not silently
  un-approved out from under whoever signed off on it — while a period still
  mid-amendment (value present but no longer `'approved'`) is skipped, since
  its own upcoming re-approval will call `previousOfficialValue` itself and
  pick up the right base automatically. Verified live end-to-end: a
  two-hop chain (amending Jan cascaded correctly through both Feb and March)
  and the shared/contribution-based Unit path (amending an individual's
  approved Jan contribution correctly cascaded the Unit's own Feb total),
  both cleaned up afterward with zero trace left in the database.
- **A read notification only ever quiets the bell, never hides the duty
  it's about**: opening the Alerts bell now clears its red unread-count
  badge (tracked per-account in the browser via `lib/seenAlerts.js`,
  keyed by an alert's id **and** message so if the same kind of alert
  recurs with different content — say, returned a second time with new
  feedback — it reads as new again), but the dropdown itself always lists
  every alert that's still genuinely true, seen or not: a pending review,
  a returned submission, an off-track KPI doesn't disappear from the list
  just because someone glanced at the bell once. This mirrors the same
  principle already established by the "hide a KPI from your own view"
  feature elsewhere in this app — a personal display preference is allowed
  to quiet an attention cue, never to make a real accountability item
  invisible.
- **A Sub-programme's own KPI performance submission is approved once,
  finally, by its own Programme Head — CPU has no role in this cascade at
  all.** This tier briefly went through a two-stage design (Sub Rep submits
  → Programme Head reviews → CPU gives the real final sign-off); that's
  been reverted by deliberate request back to the same single-stage shape
  every other tier already has — Individual-owned by its Unit Head,
  Unit-owned by its Sub-programme Rep, Sub-owned by its own Programme Head,
  one real approver, straight from `'submitted'` to `'approved'`. The
  automated cumulative-value computation (`previousOfficialValue +
  entered_value`, see above) now happens immediately at the Programme
  Head's own approval — the moment it does, the newly-approved figure is a
  real, non-null `kpi_values.value`, which is the only thing
  `computeRag`/`performanceRollup` on the frontend ever check to decide
  whether a KPI counts toward its Programme's own performance rollup: a
  Programme Head's approval of a sub-owned KPI now contributes to that
  Programme's rollup right away, with no separate CPU step needed to
  "activate" it. A return always resets the submission all the way back to
  a plain `'draft'` with the reviewer's comment attached, matching how
  every other return in this app already works.
  - **Server-enforced**: `routes/kpis.js`'s `isApprover(user, kpi)` is
    single-stage for every owner type, `POST /:id/approve` and
    `POST /:id/return` both gate on `status === 'submitted'` only (no
    intermediate status), and CPU gets a real 403 attempting to act on a
    sub-owned KPI submission — there's no code path left that grants it
    one. The `'programme_approved'` status value and its
    `programme_approved_at` timestamp column stay in `kpi_values`' schema
    for backward compatibility with old audit history (no new row is ever
    written into it again), and a one-time idempotent migration in `db.js`
    auto-finalizes any row still sitting at that now-retired status to
    `'approved'` — computing its official cumulative value the same way a
    normal approval would — so a database that was live during the
    two-stage window never has a submission stuck half-approved and
    invisible to its Programme's own rollup.
  - **Frontend**: `lib/scope.js`'s `isApprover` mirrors the backend's
    single-stage signature exactly (the `status` parameter is gone);
    Programme Head keeps their Approvals Queue nav item (`lib/nav.js`) —
    now their one true decision, not a stage that gets forwarded on
    (`pages/Approvals.jsx`); My Data Entry's "awaiting review" bucket, the
    Alerts bell's pending-review alert (`lib/alerts.js`), and every
    `STATUS_LABEL`/locked-field check across `components/KpiCard.jsx`,
    `ApprovalsTable.jsx`, and `DataEntryTable.jsx` all dropped their
    `'programme_approved'` branch back to the plain
    submitted/approved/returned/draft set every other tier already used.
  - **Verified**: a submit → Programme Head approve run via direct API
    calls confirming the cumulative value is computed immediately at that
    one approval and CPU gets a real 403 attempting to act on it at all; a
    regression check confirming Individual- and Unit-owned KPIs are
    unaffected; and a full browser walk-through (Sub Rep submits →
    Programme Head's Approvals Queue shows and approves it, status becomes
    `'approved'` with a real cumulative figure, no intermediate chip
    anywhere → the newly-approved figure shows up in that Programme's own
    performance rollup on Overview immediately, with CPU having no
    approve/return affordance for it at all), plus a role-by-role sweep of
    every page for all eight account types with zero console errors.
- **An approver can now actually see what they're approving**: a
  submitted-but-not-yet-approved KPI's own `value` is deliberately still
  NULL until the moment it's approved (see above) — which previously meant
  the person about to approve or return it saw a completely blank "Current"
  figure and a "No data" score, with nothing to actually judge the
  submission against. `routes/kpis.js`'s new `attachPreview` helper now
  computes a read-only `preview_value` — `previousOfficialValue +
  entered_value`, the identical math final approval itself uses, recomputed
  fresh on every read and never stored — and attaches it to exactly these
  rows in both `GET /kpis/values` (the batch read Approvals Queue/My Data
  Entry use) and `GET /kpis/:id/values`. Automated (shared/contribution-
  summed) KPIs are excluded — their `value` is already kept live by
  `recomputeUnitTotal` the moment a contribution is approved, so there's
  nothing to preview. On the frontend, `KpiCard` builds a display-only
  synthetic row with this preview standing in for `value` — used for the
  score chip, the "Current" figure (relabeled "Projected total if
  approved"), and the monthly pace bar (labeled "(projected)" throughout) —
  while every write action still reads and writes the real row underneath,
  never the preview. The raw submitted figure itself now also gets its own
  clearly labeled figure ("Submitted this period") that was previously only
  ever visible inside the submitter's own (locked) entry box, invisible to
  anyone reviewing it; and `mode="approver"` cards gained an explicit
  callout right next to the Approve/Return buttons restating exactly what's
  being decided on — the submitted figure, the projected new total, its
  score, and the submitter's own note, all in one place, so nobody has to
  approve blind or piece it together from elsewhere on the card. Verified
  via direct API calls confirming `preview_value` appears exactly while a
  row is pending (at both the Programme Head's and CPU's stage for a
  sub-owned KPI) and disappears once real approval sets the official
  `value`, plus a full browser check of the Approvals Queue showing the
  submitted figure, projected total, and score before a decision is made.
  In the course of this, a separate pre-existing display bug was also
  found and fixed: `kpi.is_automated` is a raw SQLite 0/1 integer, not a
  real boolean, so `{kpi.is_automated && ...}` rendered the literal digit
  "0" on every non-automated KPI's approver card — fixed with `!!`.
- **The "Actual vs. expected pace" chart's owner label is now unmissable**:
  each bar's owner name (added earlier — see `ownerName`/`ownerKindLabel`
  in `lib/scope.js`) was previously a small, muted, grey line easy to miss
  next to the KPI's own name above it. It's now bold and set in the accent
  color, distinctly larger than the tier label beneath it, so it reads as
  real information under every bar rather than faint chrome — the KPI name,
  who owns it, and what tier that owner is are now three visually distinct
  lines instead of one that stands out and two that blend together.
- **"Overall Institutional Performance" is now the average of the 3
  Programmes' own averages, not a flat average across every KPI**: the
  headline Avg. progress/Avg. variance figures on Overview's "All
  Programmes" root previously came from `performanceRollup`/`varianceRollup`
  run flat across every KPI in the system regardless of which Programme it
  belonged to — which meant whichever Programme happened to have the most
  KPIs silently dominated the institutional figure. `lib/scope.js`'s new
  `institutionalRollup(org, kpis, valuesByKpiId, settings)` instead computes
  each Programme's own rollup (the exact same `performanceRollup`/
  `varianceRollup` that Programme's own Overview card already uses, via
  `nodeOwnKpis`'s full cascade) and averages THOSE — one Programme, one
  vote — excluding a Programme with genuinely nothing scored yet rather than
  dragging the institutional figure toward zero, the same "no data never
  scores as 0" rule a single KPI already follows. The RAG counts and
  variance-chart bars stay real, flat totals across every KPI org-wide —
  only the two headline averages changed. `AppraisalCard` (shared by every
  Overview node) now accepts an optional pre-computed `rollup`, used only by
  "All Programmes"; every Programme/Sub-programme/Unit/Individual's own card
  is unaffected, since a flat average of that one node's own cascade was
  already the honest figure for it. Verified with demo data spread
  unevenly across Programmes (one Programme scored at 100%, another at 0%,
  a third with several mid-range KPIs) and confirmed the new institutional
  average lands on the mean of the three Programmes' own percentages, not
  the KPI-count-weighted figure the old flat calculation would have shown.
- **Overall Institutional Performance now requires a real, admin-granted
  permission to view or navigate to at all**: previously any account with
  one of four hardcoded roles (exec/cpu/ictadmin/council) automatically saw
  and could navigate the university-wide "All Programmes" rollup — no
  permission gated it, unlike Overview/Framework/Reports which already
  worked as real per-user permissions ICT admin could grant or revoke. A
  new `view_institutional_performance` permission
  (`utils/permissions.js`) now gates it the same way: seeded by default to
  those four roles (preserving today's access as the starting point, via an
  idempotent backfill in `db.js` for databases that predate this
  permission — including inserting the new permission into the
  `permissions` catalog table itself, a real foreign key
  `user_permissions.permission_key` references), but genuinely revocable
  per person from the existing Permissions & User Directory page, exactly
  like every other permission there — no new UI needed, since that page is
  already driven generically off the permission catalog. `pages/Overview.jsx`
  shows a clear "restricted — ask your ICT System Administrator" card in
  place of the aggregate for anyone missing it, and `components/OrgTree.jsx`
  (the sidebar's clickable, multi-Programme tree — a second way to browse
  the institution-wide picture) is gated identically rather than left as a
  back door around the same restriction. A scoped role (Sub-programme
  Rep/Unit Head/Individual/Programme Head) is unaffected either way — they
  already never reached "All Programmes" before this, since their own place
  in the structure was always their forced default. As with Overview/
  Framework's existing visibility permissions, this gates the FRONTEND
  navigation and display, matching this app's established pattern for
  visibility permissions — `GET /kpis`/`GET /org` themselves return the
  full organisation to any authenticated user exactly as they always have,
  the same honest scope every other visibility permission in this codebase
  already operates within. Verified by revoking the permission from a live
  CPU account: the aggregate card and sidebar tree both switched to the
  restricted message with zero console errors, then regranting restored
  full access immediately (permissions are re-checked live, not cached to
  login) — plus a role-by-role sweep of every page for all eight account
  types with zero console errors.
- **Local draft-recovery autosave now waits for a pause in typing instead of
  writing on every keystroke.** `KpiCard`/`ContributionCard`'s "actual value"
  and "notes" fields used to call `writeDraft` (the `localStorage` mirror
  that recovers an unsaved figure after a crashed tab or a lost connection —
  never a save to the server; see `lib/autosave.js`) synchronously in every
  `onChange`. A new `debounce(fn, delay=500)` helper wraps it instead, so the
  on-screen field still updates instantly via React state on every keystroke
  — nothing about typing itself changed — but the localStorage write only
  actually happens ~500ms after the last keystroke ("on release" rather than
  mid-type), cutting a burst of redundant writes down to one per pause.
- **"My Data Entry" is now one table per section instead of one card per
  KPI**, with a real Save/Submit flow that covers everything selected in a
  single action rather than one round-trip per KPI. The new
  `components/DataEntryTable.jsx` lists every KPI in "Needs your action" as
  a row — checkbox, name/owner/type, status, baseline, target, current,
  an editable "this period's actual" figure, score (RAG), pace-vs-target
  flag, and an editable notes field, i.e. everything the old per-KPI card
  showed, now as columns on one row — with a real bulk save via `PUT
  /api/kpis/bulk-value` and a combined save-and-submit via `POST
  /api/kpis/bulk-submit` (see the API reference below), plus a
  per-row `PUT .../explanation` for any changed notes (there's no bulk-note
  endpoint yet — same server-side validation either way). A newly-created or
  newly-picked-up KPI appears in the table automatically and pre-selected
  the moment it lands in the shared app context, no separate step to add it
  — the table renders directly off the same live KPI list every other page
  reads, and a `knownIdsRef`-based effect adds only genuinely new ids to the
  selection so it never silently re-selects a KPI someone deliberately
  unchecked earlier in the same session. The "Submitted — awaiting review"
  and "Approved this period" sections reuse the exact same table
  (`interactive={false}`) so the whole page now reads as one consistent
  table-based layout instead of switching between cards and lists. A shared
  Unit KPI's "actual" cell is shown as a read-only, computed-from-the-team
  figure rather than an input, matching how it already worked on the old
  card. Rebuilding this also surfaced a real regression risk before it
  shipped: `AssignmentManager` (a Unit Head's "assign this KPI to a team
  member" control) previously only existed inside the old per-KPI card, so
  removing that card would have quietly removed the only way to reach it.
  It's now exported from `KpiCard.jsx` and reused as an inline expandable
  "Manage team" row in the new table. Verified live end to end (Playwright,
  as a Unit Head): typed a value and a note, "Save selected" persisted both
  and showed a real confirmation toast, "Save & submit selected" moved the
  KPI to "Submitted" and re-rendered it in the read-only section with the
  same figures, "Manage team" correctly expanded the real assignment panel,
  and zero console/page errors throughout.
- **Admin KPI/org-structure/people management split into dedicated pages,
  out of what used to be one long Framework.jsx scroll.** Framework now
  shows exactly what its nav entry has always promised — the read-only org
  chart plus the structural-change proposal log, visible to every
  signed-in account — and nothing else; every create/update/remove/restore
  action that used to live there moved out, each to the page where it
  structurally belongs (KPI catalogue vs. building the org structure vs.
  maintaining/retiring it — see Organisation Builder and Organisation &
  People below), reachable from the sidebar by whoever actually holds the
  relevant permission (`lib/nav.js`'s `currentNav` accepts an array of
  permissions per nav item — "any one of these" — since some of these, like
  `edit_targets`/`add_individual`, are real, independently-grantable
  permissions a specific person can hold without holding the broader one):
  - **KPI Management** (`pages/KpiManagement.jsx`) — create a KPI, manage the
    "KPIs for individuals" template pool, and edit or delete an existing
    KPI's definition/targets. Same forms, same endpoints, same permission
    split (`create_kpi` full edit vs. the narrower `edit_targets`) as
    before — just its own page now.
  - **Organisation Builder** (`pages/OrganisationBuilder.jsx`) — the BUILD
    half of admin org management, on its own dedicated page, deliberately
    separate from removal/maintenance below: create a Programme,
    Sub-programme, or Unit/Department/Faculty/Region; correct an existing
    one's own name/head (and a Unit's Kind) without deleting and recreating
    the whole thing; and add a new Individual under a Unit. These used to
    be four bare creation forms bolted onto the bottom of the org-management
    page, in whatever order they happened to be added, with no way to
    correct a typo afterward. The page went through an intermediate shape —
    four numbered sections each showing its Create and Update form side by
    side, all visible at once — before landing on its current, simpler
    design: a top-level **Create / Update** switch, then a second row of
    pills for which entity (Programme, Sub-programme, Unit/Department/
    Faculty/Region, and — Create only — Individual), with exactly **one
    form visible at a time**. Both rows reuse the sidebar nav's own
    active/inactive pill styling, so the in-page navigation reads as an
    extension of the app's own nav rather than a new pattern. Each mode and
    each entity option only appears at all if the signed-in account
    actually holds a permission it would succeed against — nobody is ever
    shown a switch that would just 403 — and if someone holds neither
    switch's permission at all, the page shows a plain explanation of which
    permission to ask for instead of an empty page. `POST /api/org/programmes`
    and `POST /api/org/subs` provision a genuine Programme Head /
    Sub-programme Rep account exactly like every other creation route in
    this app; the matching `PATCH /api/org/programmes/:id` / `subs/:id` /
    `units/:id` keep that same account's own `users.name`/`title` in sync
    with whatever the Update form just saved, the same sync
    `PATCH /api/org/individuals/:id` already did, so "who's signed in" and
    "who the org chart says leads this" never drift apart. The Unit "Kind"
    field (and a Sub-programme's "what its Units are called" field) is an
    explicit dropdown (Unit / Department / Faculty / Region / Regional
    Campus / Other…) instead of a blank free-text box defaulting to "Unit".
    Real, independently-grantable permissions gate the two switches — two
    of them new this round, narrower siblings of the existing
    `manage_org_units` (see "Finer-grained org-structure permissions"
    below): `create_org_units` alone reaches the Create tab's
    Programme/Sub/Unit forms, `edit_org_units` alone reaches the entire
    Update tab, and `add_individual` alone reaches the Create tab's
    Individual form (scoped to the holder's own unit/sub-programme, same as
    before, unless they also hold `manage_org_units`); `manage_org_units`
    alone still reaches everything. Verified live: an ICT admin
    (`manage_org_units`) sees both tabs and all entity pills with zero
    console errors switching between every combination; an account holding
    only the new `create_org_units` sees just the Create tab (Programme /
    Sub-programme / Unit pills, no Individual, no Update tab at all — the
    mode switch itself doesn't render when there's only one reachable mode)
    and a direct `PATCH`/`DELETE` against the API from that same account's
    token comes back a real 403, confirming the tab gating isn't cosmetic;
    an account holding only the new `edit_org_units` lands straight on the
    Update tab pre-populated with the entity's current values, a real
    Update-a-Programme round trip through it persists correctly end to end,
    and a direct `POST`/`DELETE` from that account's token also 403s; a
    Unit Head/Sub Rep holding only the pre-existing `add_individual`
    permission still sees just the Individuals option, scoped to their own
    unit(s); and a full Create Programme → Create Sub → Create Unit → Add
    Individual chain through the new navigation, followed by a real cascade
    remove of that same Programme from Organisation & People, leaves
    nothing behind in any active view or dropdown — zero console errors
    throughout.
  - **Organisation & People** (`pages/OrgStructure.jsx`) — the MAINTAIN
    half: removing a Programme, Sub-programme, or Unit (and restoring one
    from "Recently Removed"), plus editing, removing, or role-changing an
    existing Individual. This page is options only, not a tree — it went
    through several earlier shapes (a full "Organisation Structure" tree
    page and a separate "People & Roles" tree page, then one page sharing a
    merged tree, then one page mixing create/update/remove/restore for four
    entity types) before landing here: the org chart itself is
    Framework.jsx's job alone, and creating/updating now lives on
    Organisation Builder above, so a `manage_org_units` holder gets four
    independent "pick from a dropdown, then act" panels — Remove a
    Programme / Remove a Sub-programme / Remove a Unit (each its own
    select-plus-delete-button card), Manage individuals (pick a Unit from a
    dropdown, then edit/remove/role-change whoever's in it), and Recently
    Removed — with no tree rendered on this page at all. Each dropdown
    auto-corrects to a still-existing entry the moment its own selection is
    removed, rather than pointing at something that no longer exists. A
    Unit Head/Sub Rep who holds only the narrower `add_individual`
    permission (not `manage_org_units`) still gets the same compact,
    scoped-to-their-own-unit(s) edit-only view this page has always given
    them — never a tree, never the whole org, and (since adding moved to
    Organisation Builder) never a create button either.
    **Removing anything here is a real, reversible change, never data loss**
    (see the "Soft-delete & traceability" bullet below for the full
    architecture) — every DELETE cascades exactly the way it used to (a
    removed Programme takes every Sub-programme, Unit, and Individual
    beneath it, every KPI any of them own, and every login account that
    only exists because of them, out of active use, atomically, inside one
    transaction, with zero orphaned rows or foreign-key errors), except now
    nothing is actually destroyed: every one of those rows is stamped
    `deleted_at`, not deleted, and a **"Recently Removed"** panel right on
    this page (backed by `GET /api/org/removed`) lists everything currently
    removed with a one-click **Restore** per row (`POST
    /api/org/{programmes,subs,units,individuals}/:id/restore`) that clears
    the stamp on it and everything structurally beneath it in one
    transaction — values, assignments, KPI history, and the login account
    all come back exactly as they were. The confirmation dialogs and toasts
    say this explicitly now, instead of the old (and, once this landed,
    inaccurate) "this cannot be undone". An ICT System Administrator keeps
    **Framework** in their nav (`lib/nav.js`'s `ROLE_NAV_KEYS.ictadmin`) —
    the read-only org chart, the same page every other role sees, so they
    can browse the whole structure at a glance without hopping between the
    scoped dropdowns on KPI Management / Organisation Builder / Organisation
    & People to find what they're looking for — alongside the three pages
    that actually act on the org. (An earlier round of this app briefly
    removed Framework from ICT admin's nav on the reasoning that they "act
    on the org rather than browse it"; it's back, since acting on something
    doesn't remove the need to see the whole of it first.) Verified live:
    an ICT admin's sidebar confirmed to have "Framework" alongside both
    "Organisation Builder" and "Organisation & People"; a real cascade
    create through Organisation Builder (Programme → Sub → Unit →
    Individual) followed by a cascade remove of that same Programme from
    Organisation & People, confirmed gone from every active view and every
    dropdown across both pages afterward; and a CPU account (who also has
    Framework) getting the identical pages — zero console errors
    throughout.
- **Approvals Queue rebuilt as tables, same pattern as My Data Entry's
  DataEntryTable.** The old one-KpiCard-per-KPI layout is now
  `components/ApprovalsTable.jsx`: every figure a reviewer used to hunt for
  in a tall card — baseline, target, current, what was actually submitted,
  score, and a new dedicated pace-vs-target column — is a table column
  instead, with Approve/Return reached via the row itself and a "Review ▾"
  toggle that expands a detail row (the submitter's full note, the return
  reason textarea, manual-override controls, and a shared KPI's team
  breakdown) rather than always occupying screen space. The Unit Head's own
  team-contributions queue gets its own compact `TeamApprovalsTable` variant
  (no top-level Approve/Return there — only per-contributor decisions, via
  the same `ContributorsBreakdown` `KpiCard.jsx` already used, now exported
  for reuse). Return feedback — previously an inline colored box on every
  returned KPI's own card — is now pulled into its own dedicated
  `FeedbackTable`, hidden by default behind a "Return feedback (N) — show"
  toggle, so the main table stays scannable and the actual comment text is
  still one click away rather than gone; this needed a real fix along the
  way, since `return_comment` lives on a value row whose RAW `status`
  column is still `'draft'` (only DERIVED as "Returned" by
  `lib/scope.js`'s `valueStatus` — the raw `'draft'` is what lets the
  submitter edit and resubmit it), so a first pass checking the raw column
  directly silently matched nothing; fixed to check `valueStatus(valueRow)`
  like the rest of the app already does. Verified live end to end: a real
  submission through the interactive table (Approve outright; separately,
  Return with a reason via the expanded row), the read-only "Decided this
  period"/"Not yet submitted" table variants, and the feedback table's
  hide/show toggle actually hiding and re-revealing the comment text — zero
  console errors throughout.
- **Approvals readability fix, hideable Submitted/Approved tables on My
  Data Entry, and uniform KPI input styling.** A report of "not seeing the
  approval option" led to an exhaustive re-run of every approver-tier/
  owner-type combination (two-stage Sub-owned KPI through Rep → Programme
  Head → CPU; an Individual-owned KPI through their Unit Head;
  team-contribution review via `TeamApprovalsTable`) — all passed with the
  Approve button present and working and zero console errors, so nothing
  was actually broken end to end. The real issue was readability: the
  Decision (Approve/Return) column sat at the far right of a wide,
  horizontally-scrolling table, so on a narrower window it could scroll out
  of view without looking like anything was wrong. Fixed by making that
  column (and `TeamApprovalsTable`'s equivalent "Review team" column)
  `position: sticky; right: 0` with a solid background and a divider
  border, so it now stays on screen regardless of scroll position —
  verified live at a deliberately narrow 1180px viewport: the Approve
  button's own bounding box confirmed on-screen with no scroll needed, and
  a real approval went through from that same narrow view. (Also fixed
  along the way: the expanded detail row's `colSpan` was one short of the
  table's real column count — a leftover from before the Decision column
  existed — which didn't break anything visibly but was wrong regardless.)
  Separately, "My Data Entry"'s "Submitted — awaiting review" and "Approved
  this period" sections (and the equivalent contribution sections) are now
  hideable behind the same "▸ Title (N) — show/hide" toggle pattern
  `ApprovalsTable.jsx`'s `FeedbackTable` already established, open by
  default only for "Needs your action" — so a long-running period's settled
  work doesn't push what still needs doing further down the page. And every
  inline KPI-value/note/override input across `DataEntryTable.jsx`,
  `ContributionCard.jsx`, and `ApprovalsTable.jsx`'s override controls now
  shares the same vertical padding (`py-1.5`, previously an inconsistent
  mix of `py-1`/default/`py-1.5` across the three files) and matching
  widths for the same kind of field (an override's value/reason box is now
  identical wherever it appears); the actual-value inputs also gained a
  measure-aware placeholder (e.g. "Actual (%)") and a live "X% of target"
  readout underneath as you type — computed from the KPI's own
  baseline→target span, so someone entering a figure sees right away
  whether it's below baseline, on track, or past target, without waiting
  for Save to recompute the Score column. Verified live: the sticky column
  at a narrow viewport (above), the collapse/expand toggle on My Data
  Entry's Approved section, and the live percentage readout appearing and
  computing correctly while typing — zero console errors across all three.
- **A full project debug pass — one real crash bug found and fixed, everything
  else came back clean**: 8 of the 12 Annual Plan submit/approve/return
  routes in `routes/plans.js` (every Unit/Sub-programme/Programme-tier
  action, plus `university/return`) were missing the same `cycleYear`
  presence check their sibling PUT (save-draft) routes already had — a
  request reaching one of them without a valid `cycleYear` didn't get a
  clean 400 like everywhere else in this app, it crashed the handler outright
  with an unhandled `TypeError` ("Provided value cannot be bound to SQLite
  parameter 1"), returning a raw 500. Fixed by adding the same
  `if (!cycleYear) return res.status(400)...` guard to all 8. Verified: the
  old crash now returns a clean 400, and the full four-tier cascade
  (Unit → Sub-programme → Programme → University, submit and approve/return
  at every stage) was re-run live end-to-end with correct input and worked
  throughout. Beyond that one bug, this pass covered: every backend route
  file re-syntax-checked; every GET endpoint smoke-tested across all eight
  roles with zero unexpected errors; the full messaging lifecycle
  (send/read/delete); a clean frontend production build; every nav page
  clicked through for every role with zero console errors, failed requests,
  or broken navigation (the one console message that did appear —
  `net::ERR_CERT_AUTHORITY_INVALID` on the Google Fonts stylesheet — is an
  artifact of this sandbox's own outbound TLS proxy having no route to
  fonts.googleapis.com, not an app bug; the font just falls back to the
  system sans-serif, and a real deployment's browser fetches it normally);
  the Overview org-tree drill-down and Reports page's period/filter controls
  exercised directly; and a full SQLite `integrity_check` /
  `foreign_key_check` pass with zero issues. No other genuine bugs surfaced.
- **A final hardening & polish round, covering everything the security
  review had flagged as open plus real operational and accessibility gaps**:
  server-side scope-filtering on every `GET` endpoint (detailed under
  "Before using this for anything real" below — a scoped account can no
  longer read past its own branch by calling the API directly); optional
  TOTP-based two-factor authentication with recovery codes and
  admin-assisted reset (same section); real cursor-based pagination on the
  Audit Log (`GET /api/audit` — `before`/`limit` params, no more hard
  1,000-row cap, verified live with no gaps or overlaps between pages);
  frontend code-splitting so the PDF-export libraries (`jspdf`,
  `jspdf-autotable` — together several hundred KB) and the Reports/Planning
  pages only load when actually needed, not in everyone's initial bundle
  (verified via before/after bundle sizes and live network-request tracing);
  a real, non-mocked automated backend test suite (`backend/test/`, `npm
  test` — 28 tests, Node's built-in `node:test` driving actual server
  processes and actual HTTP requests against disposable databases, covering
  auth/RBAC, soft-delete/restore, the cumulative cascade-recompute fix, plan
  validation, scope-filtering, and the backup script itself); a real,
  verified SQLite backup script (`npm run backup`, detailed in "Backing up
  the database" above); and an accessibility pass covering keyboard
  operability app-wide (including a full retrofit of the sidebar's
  Programme-structure tree, previously unusable without a mouse),
  screen-reader labels on icon-only controls and search inputs, live-region
  announcements for toasts, proper modal/dialog semantics with focus
  management and Escape-to-close, and a visible focus ring on every
  interactive element. One accessibility gap was found and deliberately
  deferred rather than rushed — see "Before using this for anything real".
- **The Approvals Queue / My Data Entry tables' "Pace" column now reflects
  the actual period being reviewed, not a disconnected default**: it was
  computing variance from `perfValues[kpi.id]` — a KPI's value under
  whatever period the separate Overview/Reports "performance lens" happened
  to be set to (see `PeriodTypePicker`/`perfPeriod` in `AppContext.jsx`) —
  while every other cell in that same table row (score, current figure,
  status) was already keyed off the real row for the period actually being
  worked in that table. The two periods rarely line up, so a row could show
  a genuinely off-track KPI as "On pace" (reading a different, on-track
  period's figure) or vice versa. Fixed in `ApprovalsTable.jsx` (both the
  main table and `TeamApprovalsTable`) and `DataEntryTable.jsx`: variance is
  now computed from `effectiveRow`/`valueRow` — the exact period-specific
  value row each table already resolves for every other cell — and the
  column also now correctly distinguishes "no data yet for this period"
  (shown as "—") from a genuinely on-pace KPI (shown as "On pace"), rather
  than defaulting every non-attention case to the same static label.
  `KpiCard.jsx`'s own separate pace badge was deliberately left as-is: it's
  explicitly the Overview/Reports performance-lens figure by design, not a
  per-period-review one, so it wasn't part of this bug. Verified live: a
  KPI whose entered figure is well behind its expected pace for the period
  actually open in the table now shows a real negative-points figure
  ("-38pts behind") in that same row, instead of "On pace".
- **The "Actual vs. expected pace" chart's hover tooltip now always matches
  the bar actually under the cursor, even when two or more KPIs share the
  exact same name** (a real scenario — e.g. a duty-KPI template like
  "Vacuuming" or "Bin collection" assigned to several different people):
  previously, hovering one bar of a duplicated name could show a
  *different* bar's owner and figures instead. Root-caused by reading
  Recharts' own tooltip data-selection code
  (`combineTooltipPayload.js`): for an axis-shared tooltip, it resolves the
  hovered bar's *position* correctly, but then looks up that bar's data by
  searching the chart's data array for the **first** entry whose XAxis
  `dataKey` **value** matches the hovered category label
  (`findEntryInArray`) — so once two rows share that value, every bar with
  that name resolves to the same first match, regardless of which one is
  actually under the pointer. Fixed in `VarianceChart.jsx` by giving each
  row a guaranteed-unique `_uid` field (`` `${name}__${index}` ``) and
  using that as the XAxis's own `dataKey`, while the human-readable name
  stays a separate field used everywhere a label is actually displayed (the
  custom two/three-line `OwnerTick`, and the tooltip's own
  `labelFormatter`) — nothing shown on screen changes, only the internal
  value Recharts uses to resolve which row was hovered. This is the shared
  chart component behind both Overview's and Reports' variance charts, so
  the fix covers both. An earlier attempt at this (forcing the chart to
  remount via a `key` prop whenever the performance-lens period changed)
  was tried, confirmed live to NOT fix the actual bug, and has been
  removed — the real cause was in the tooltip's data lookup, not stale
  component state. Verified live end-to-end: two real KPIs both named
  "Vacuuming", owned by two different individuals, were created for the
  same period specifically to reproduce the reported scenario; hovering
  each bar in turn now shows that bar's own distinct owner and value with
  zero cross-contamination, both on first load and after switching the
  performance-lens period more than once — the exact case that was broken
  before. The reproduction KPIs were removed afterward, and the full
  backend test suite (28 tests) still passes.
- **New: a system-enforced monthly submission window**, so figures can't be
  submitted for review at arbitrary times. Two admin-configurable settings
  (Settings → "Submission window", `manage_settings` permission — the CPU
  role by default) control it: **Opens on day** (default **25**, of the
  reporting month itself) and **Closes on day** (default **3**, of the
  *following* month). For any given month: before the open day, submitting
  is blocked ("not open yet"); from the open day through the last day of
  the month, submission is normal/on-time; from the 1st through the close
  day of the next month, submission is still accepted but flagged **late**;
  after the close day, submission is blocked outright until next month's
  window opens. Saving a draft is never blocked — only the final "Submit
  for review" step is affected, at every tier (Individual, Unit, Sub-
  programme direct-value submissions, `POST /:id/submit` and
  `/bulk-submit`, and Unit contribution submissions,
  `POST /:id/contribution/submit`), enforced server-side (403 with a
  human-readable reason) and mirrored client-side (the button is disabled
  with the same message as its tooltip, and a banner on "My Data Entry"
  explains why *before* anyone tries). A "Late" chip appears next to any
  KPI/contribution that was actually submitted inside the grace window, on
  My Data Entry, the Approvals Queue, and contribution cards, computed from
  each submission's own real timestamp rather than "now" — so it stays
  correct forever, not just at submission time. New backend module
  `backend/src/utils/submissionWindow.js`; new endpoint
  `GET /api/kpis/submission-window?year=&month=`; new settings keys
  `submissionOpenDay`/`submissionCloseDay` (validated server-side as whole
  numbers 1–31). Covered by 4 new backend tests (window-state transitions,
  settings validation, submit/bulk-submit blocking + late-flag persistence,
  contribution-submit blocking + late-flag persistence) using a test-only
  `X-Test-Now` clock-override header — gated behind an env var the test
  harness sets and production never does, so the real submit routes always
  use the real clock. Full suite: 32/32 passing. This is separate from the
  pre-existing "Late-submission cut-offs" / escalation-trigger settings
  just above it on the same Settings page, which govern something
  different — per-tier grace periods used only to decide *when to escalate*
  an overdue submission up the org hierarchy (see "Compliance &
  Escalations"), not whether submitting is technically possible. The two
  now sit side by side with overlapping "day-count" language; worth a look
  if that reads as confusing in practice.
  ⚠️ **Operational note:** under the default settings, a submission window
  is only ever open for 3–9 days out of every month (the 25th through the
  3rd of the next month) — everything else is "not open yet" or "closed".
  If every period looks blocked right after this ships, that's expected
  under the defaults, not a bug — adjust the open/close days in Settings,
  or wait for the next window.

## What's simplified versus the original prototype

This is an honest, from-scratch backend rebuild, not a port of every
simulated detail from the earlier prototype. The following were kept
deliberately simple so the project stays reviewable and correct rather than
sprawling:

- RAG (red/amber/green) status is a straightforward percentage-of-target
  calculation against configurable thresholds, not the prototype's
  pace-adjusted milestone math.
- There's no cross-cutting KPI linking (one KPI counted toward two
  Programmes at once).
- ~~Automated cumulative performance doesn't cascade retroactively~~ — this
  was a real correctness gap, not a deliberate boundary, and it's now fixed;
  see "Cumulative values now cascade forward automatically" above.
- Executive Owner is a display and accountability designation only — it
  marks who the app holds out as accountable for overall institutional
  performance and puts their name on it, but it is not an extra approval
  gate anywhere in the University Annual Plan cascade (that gate is the
  University Council's `validate_annual_plan`, described above). The VC
  isn't required to click anything for the Plan to take effect.
- The admin-grantable Overview navigation limit (`overview_limit`) caps
  only the Overview drill-down tree — it's a visibility ceiling on
  navigation depth, deliberately independent of the permission catalog. It
  doesn't touch what a capped account can do elsewhere (Reports, Approvals,
  messaging, …), and it isn't a data-scoping mechanism like a Sub Rep's or
  Unit Head's own scope — a capped global-role account still sees the
  correct rollup figures at its own capped tier, just not the tiers deeper
  than that.

Everything else — real auth, real RBAC, the full organisational hierarchy
(Programmes → Sub-programmes → Units/Departments/Faculties/Regions →
Individuals), the complete KPI submission → review → approval cascade,
override handling for automated KPIs, and the audit log — is implemented
and working end-to-end, and was verified with automated browser tests
covering every approval tier before this was packaged.

## Project layout

```
zou-fullstack/
├── backend/                  Node.js + Express + SQLite API
│   ├── src/
│   │   ├── db.js             Schema + database connection
│   │   ├── seed.js           Seeds the org structure, KPIs, and demo accounts
│   │   ├── server.js         Express app entry point (also serves the built frontend)
│   │   ├── middleware/auth.js
│   │   ├── routes/           auth, users, org, kpis, plans, messages, audit,
│   │   │                       settings, compliance
│   │   └── utils/            permissions catalogue, email-generation helpers
│   ├── package.json
│   └── .env.example
├── frontend/                  React + Tailwind CSS single-page app (built with Vite)
│   ├── src/
│   │   ├── main.jsx, App.jsx
│   │   ├── context/           auth/data state (AppContext), toast notifications
│   │   ├── components/        Layout (topbar+sidebar), OrgTree (drill-down nav),
│   │   │                       ThemeToggle, KpiCard, PeriodPicker,
│   │   │                       PeriodTypePicker (monthly/quarterly/bi-annual/annual)
│   │   ├── pages/              Login, Overview, Entry, Approvals, Framework, Planning
│   │   │                       (Annual Plan & Budget), Compliance, Reports, Audit,
│   │   │                       Settings, Users (Permissions & user directory),
│   │   │                       Profile (self-service photo & password, every role),
│   │   │                       Messages (internal messaging, every role)
│   │   └── lib/                 API client, RBAC/scope logic (mirrors the backend),
│   │                             performance-lens period helpers, nav config, theme
│   ├── public/assets/           ZOU logo
│   ├── dist/                    pre-built production bundle (ships ready to run)
│   └── package.json
└── README.md                    This file
```

The backend serves the frontend's built output (`frontend/dist`) directly,
so in normal day-to-day use you run one process and open one URL. A
pre-built `dist/` is included in this project so it runs immediately
without needing a frontend build step — see **Just run it** below. If you
edit the React source, rebuild it with `npm run build` (see **Developing
the frontend**).

## Just run it

Requires **Node.js 22.5 or later** (the backend uses Node's built-in
`node:sqlite` module — see "Why no database to install" below).

All commands below run **inside the `backend` folder only**. The
`frontend` folder has its own `package.json` for its own build tooling —
you don't need to touch it unless you're changing the React source (see
**Developing the frontend**).

```bash
cd backend
npm install
cp .env.example .env
npm run seed      # creates backend/data/zou.db and seeds it
npm start
```

Then open **http://localhost:4000/** in a browser. That one URL serves
both the pre-built React app and the API.

You'll see one or two lines like `ExperimentalWarning: SQLite is an
experimental feature` when the server starts — that's expected and
harmless; Node still marks its built-in SQLite support as experimental.

To reset to a clean demo state at any time, stop the server and re-run
`npm run seed` — it wipes and rebuilds all tables.

## Developing the frontend

If you want to change the React/Tailwind source in `frontend/src`:

```bash
# terminal 1 — the real backend API
cd backend && npm start

# terminal 2 — the frontend dev server, with hot reload
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173/** — Vite's dev server proxies every `/api/*`
request straight to the backend on port 4000 (see `vite.config.js`), so
you're developing against the same real API and real database the whole
time, not a mock. There is no separate frontend "connection setting" to
keep in sync; the dev proxy and the production build both simply call
`/api/...` on whatever origin is serving the page.

When you're done, build the production bundle so `backend`'s `npm start`
picks up your changes:

```bash
cd frontend
npm run build      # writes to frontend/dist
```

### Why no database to install

Earlier versions of this project used the `better-sqlite3` package, which
needs a native binary compiled for your exact OS/CPU/Node version — on
some Windows setups (especially very new Node releases without a
prebuilt binary available yet, or machines without Visual Studio Build
Tools/Python installed) that compilation step fails with errors like
`Could not locate the bindings file`. The backend now uses Node's
built-in `node:sqlite` module instead, so there is nothing to compile —
`npm install` only installs plain JavaScript packages.

## Backing up the database

```bash
cd backend
npm run backup
```

Writes a complete, independent snapshot to
`backend/data/backups/zou-<timestamp>.db` and verifies it immediately after
(`PRAGMA integrity_check`) before calling the run a success. This is safe to
run at any time, including while the server is up and being actively used —
it does not lock out writers, pause the app, or need any coordination with
`server.js`. It's real online backup, not a suggestion to stop the server
first: `src/backup.js` uses SQLite's own `VACUUM INTO`, which opens a read
transaction against the live database and streams a consistent copy to a
new file. A plain file copy (`cp data/zou.db backup.db`) would not be
reliable here — the live database runs in WAL mode (see `db.js`), so the
main `.db` file on disk can be missing recently-committed data still sitting
in the `-wal` side file at any given instant; `VACUUM INTO` accounts for
that, `cp` does not.

By default the last 14 backups are kept and older ones are pruned
automatically on each run (only files this script created, matching
`zou-*.db` in that directory — nothing else there is ever touched or
deleted). Override with environment variables in `.env` if needed:
`BACKUP_DIR` (default `backend/data/backups`), `BACKUP_KEEP` (default `14`,
set to `0` to keep everything), `DB_FILE` (which live database to back up —
same variable `server.js` and `seed.js` already use). A specific destination
path can also be passed directly — `node src/backup.js /path/to/out.db` —
which skips the automatic pruning, since a one-off destination usually means
you're managing retention yourself.

**Restoring** is the reverse of taking the backup: stop the server, then
copy a backup file over the live one —

```bash
cd backend
# stop the running server first
cp data/backups/zou-<timestamp>.db data/zou.db
rm -f data/zou.db-wal data/zou.db-shm   # stale WAL/shm files from the old db, if present
npm start
```

**Scheduling it** — this app has no built-in job scheduler (see "Still
genuinely open" below), so run it on a real schedule the same way you would
any other periodic maintenance task on whatever's actually hosting this:
a cron entry (`0 2 * * * cd /path/to/backend && npm run backup >> /var/log/zou-backup.log 2>&1`
for a nightly 2am backup), a systemd timer, or your hosting platform's
scheduled-jobs feature. Whichever you use, also copy the resulting files off
the same disk/VM on some cadence (object storage, a second machine) — a
backup that lives next to the database it protects doesn't survive the one
failure (disk death, VM loss) it most needs to survive.

## Test credentials — one account per access level

All seeded accounts use the same password:

```
Zou@2026
```

This same list is also shown right on the login page itself (under "Demo
accounts for testing"), so you don't need to come back to this file to
try a different role:

| Access level | Email | What they can do |
|---|---|---|
| Executive (Vice Chancellor) | `l.chareka@zou.ac.zw` | Read-only executive view (Reports only); designated **Executive Owner**, accountable for overall institutional performance against the Plan (badge in the header, accountability note on Overview) |
| University Council (Chairperson) | `f.museta@zou.ac.zw` | Reviews the fully compiled University Annual Plan (every Programme/Sub-programme/Unit beneath it) and approves it into effect, or returns it to CPU with a comment — the top validation gate on the Annual Plan cascade |
| Corporate Planning Unit (CPU) | `t.moyo@zou.ac.zw` | Approves sub-programme submissions, manages org structure, KPIs, and settings; compiles and submits the University Annual Plan to the Council |
| ICT Systems Administrator | `l.chikomo@zou.ac.zw` | The only role that can grant/revoke permissions, change a user's role, or remove an account — and by default can also add/remove units and individuals, create new KPIs, edit KPI targets, apply overrides, set a user's Overview navigation limit, and designate the Executive Owner |
| Programme Head | `s.chitiyo@zou.ac.zw` | Read-only oversight of every Sub-programme in their own Programme (Governance & Administration) only; approves/returns those Sub-programmes' Annual Plan proposals and compiles/submits their own Programme's plan |
| Sub-programme Representative | `b.gwatidzo@zou.ac.zw` | Enters KPI data owned by their sub-programme; approves the Unit Heads below them |
| Unit Head | `f.rusike@zou.ac.zw` | Enters KPI data owned by their unit; approves the Individuals below them |
| Individual staff member | `n.moyana@zou.ac.zw` | Enters only their own personally-owned KPI data |

Each row above is a genuinely separate account — its own database row, its
own email, its own password hash, its own permission grants — not one
account wearing different hats. Corporate Planning Unit and Sub-programme
Representative in particular are easy to conflate by name, but they don't
overlap: CPU (`t.moyo@zou.ac.zw`) is unscoped (`scope_type: null`) with 11
broad permissions including `manage_settings`, `manage_org_units`,
`create_kpi`, and `submit_annual_plan`; a Sub Rep like
`b.gwatidzo@zou.ac.zw` is scoped to exactly
one sub-programme (`scope_type: "sub"`) with only 4 permissions
(`data_entry`, `approve_own_tier`, and the `view_overview`/`view_framework`
pair every account gets by default) that only ever apply within that one
sub-programme. Signing in as each and comparing the sidebar is the
fastest way to see the difference for yourself — Settings only appears
for CPU, and the Framework page's "Add a unit", "Create a KPI" and "Edit
targets" forms only appear for accounts holding those specific
permissions (CPU and ICT admin, by default).

There are many more Sub Rep / Unit Head / Individual accounts beyond the
one of each shown above — `npm run seed`'s console output and the
Framework page (visible to CPU/ICT admin) show the full organisational
tree, from which you can find any of them by name to sign in and explore.
To try the full submission → review → approval chain end to end: sign in
as `n.moyana@zou.ac.zw` (Individual), enter and submit a KPI value, then
sign in as `m.chirisa@zou.ac.zw` (their Unit Head, Postgraduate Research
Unit) and approve it from the Approvals Queue. To try the University
Annual Plan's own top-level cascade: sign in as `t.moyo@zou.ac.zw` (CPU),
compile and submit the University Annual Plan from Annual Plan & Budget,
then sign in as `f.museta@zou.ac.zw` (University Council) and approve it
(or return it with a comment) from the same page.

## Before using this for anything real

This is a demonstration/reference implementation, not a production
deployment. A security review of this codebase (see
`SECURITY_REVIEW.md`) found and fixed several real issues — what's below
reflects the current, post-fix state.

Already addressed:

- **No more shared, predictable account password.** Every new Unit Head or
  Individual account (`POST /api/org/units`, `POST /api/org/individuals`)
  and every ICT-admin password reset (`POST /api/users/:id/reset-password`)
  now gets a real, cryptographically random one-time password
  (`utils/password.js`) and is flagged `must_change_password` — the account
  can sign in and see its own identity, but every other route 403s
  (`code: 'PASSWORD_CHANGE_REQUIRED'`) until it sets a real password of its
  own (see `pages/ForcedPasswordChange.jsx`). The seeded demo accounts keep
  their openly-documented shared password (`Zou@2026`, shown right on the
  sign-in screen) — deliberately: it's how you explore this build, not a
  production credential, and forcing every demo persona to rotate it on
  first login would defeat that purpose.
- **`JWT_SECRET` has no fallback anymore.** `middleware/auth.js` throws on
  startup if it's unset rather than silently signing tokens with the old
  `dev-secret-do-not-use-in-production` placeholder — a value anyone who's
  read this source could forge. Set a real one in `.env` (see
  `.env.example`) before starting the server.
- **Real, server-side session revocation.** Every user row now carries a
  `token_version`; each JWT embeds the value it was issued against
  (`routes/auth.js`'s `signToken`), and `requireAuth` rejects a token whose
  embedded version no longer matches. A password change, an admin password
  reset, or the self-service "Sign out everywhere" button (My Profile →
  `POST /api/auth/logout-everywhere`) bumps it, instantly invalidating every
  other outstanding token for that account instead of waiting out its
  natural 12h expiry.
- **`POST /api/auth/login` is rate-limited, two ways at once** — so the
  account-password fix above can't be undone by unlimited guessing, without
  the limiter itself becoming a way to lock out people who did nothing
  wrong. A single IP-keyed limiter (this app's original approach) has a real
  failure mode: everyone behind the same NAT gateway or campus proxy shares
  one apparent IP, so one person mistyping their own password repeatedly
  locked out everyone else on that network — confirmed live in an earlier
  pass, then fixed. Now: `accountLoginLimiter` throttles repeated guesses
  against ONE account (8 attempts per 3 minutes, keyed on the email being
  attempted, from any IP) without touching anyone else's ability to sign in
  from the same network; `ipLoginLimiter` is the backstop, a much larger cap
  (30 per 3 minutes per IP) that still catches someone spraying guesses
  across many different accounts from one source. See `routes/auth.js`.
- **`helmet()` on every response** (`server.js`) — a real
  Content-Security-Policy, `X-Frame-Options`, `X-Content-Type-Options`, etc.
  The one thing this actually required changing was moving `index.html`'s
  small inline theme-preference script out to `public/theme-init.js`, so
  `script-src` could stay at helmet's default `'self'` with no
  `'unsafe-inline'` exception carved out for it.
- **`cors()` no longer sends `Access-Control-Allow-Origin: *` by default.**
  This app is always same-origin in real use (Express serves the built
  frontend itself; Vite's dev server proxies `/api` rather than calling it
  cross-origin), so CORS is now off unless `CORS_ORIGIN` is explicitly set
  in `.env` to a real allowlist for a separately-hosted frontend.
- `PATCH /api/settings` now rejects any key outside the known settings list
  instead of writing whatever the request body contains into the table.
- `PUT /api/kpis/:id/value` and `PUT /api/kpis/:id/contribution` now reject
  a non-numeric `value` instead of silently storing it.
- **Every `GET` endpoint is now scope-filtered server-side, not just
  hidden by the frontend.** `GET /api/kpis` (and `/:id/values`, `/values`,
  `/values-range`, `/assignments`, `/contributions`), `GET /api/plans`, and
  `GET /api/compliance` used to return every KPI/value/contribution, the
  full org tree, and the full budget/compliance picture, system-wide, to
  any authenticated user — a scoped account (Individual, Unit Head, Sub
  Rep) could get data far outside what its own UI ever shows it by calling
  the API directly. `utils/scope.js` adds read-visibility predicates
  (`isGlobalReader`, `canReadKpi`, `canReadSub`, `canReadUnit`,
  `canReadProgramme`) and the three GET handlers above now filter every row
  through them before it reaches the response. Global oversight roles
  (CPU/ICT Admin/Executive/Council) are unaffected; verified with an
  automated test across all 8 roles (`backend/test/scope-filtering.test.js`)
  that no legitimate access regressed.
- **Optional two-factor authentication.** Any account can enroll a real,
  standards-based TOTP authenticator (RFC 6238, `utils/totp.js`, no new
  dependency — works with Google Authenticator, Authy, etc.) from My
  Profile; once enabled, login requires the 6-digit code (or a one-time
  recovery code) before a real session is issued. ICT Admin can also
  disable a lost account's MFA. See `SECURITY_REVIEW.md`'s "Low /
  hardening notes" for the full design (short-lived MFA ticket tokens,
  bcrypt-hashed recovery codes, audit logging).

Still genuinely open — outside what changes to this codebase alone can fix
(see `SECURITY_REVIEW.md` for the full reasoning on each):

- Put this behind HTTPS, on real hosting. `npm run backup` (see "Backing up
  the database" above) gives a real, verified way to snapshot the SQLite
  file — scheduling it and shipping the results off-box is a hosting-level
  step for whoever deploys this, not something a script running on the same
  disk can guarantee alone; migrating to a managed database at that point
  is also worth considering.
- Have ZOU's IT/security team review authentication, data-retention, and
  access-control requirements before go-live — including whether MFA
  (available now, opt-in) should be mandated for some or all roles.
- Real SMTP/email-provider integration for password-reset delivery — a
  reset currently has to be relayed by an ICT Admin (`POST
  /api/users/:id/reset-password`) rather than emailed directly to the
  account holder, since wiring up an actual outbound-mail provider needs
  real, external credentials (an SMTP relay or a service like SendGrid/SES)
  that can't be fabricated in this environment.
- A further accessibility pass: this build now covers keyboard operability
  (every interactive control, including the sidebar's Programme-structure
  tree, is reachable and operable without a mouse), screen-reader labeling
  on icon-only controls and search inputs, live-region announcements for
  toasts, proper modal/dialog semantics with focus management, and a
  visible focus ring app-wide — see `SECURITY_REVIEW.md`-adjacent commit
  history for specifics. Not yet done: roughly three dozen form
  `<label>`/`<input>` pairs across the admin pages (Framework, KPI
  Management, Organisation Structure/Builder, People & Roles) are visually
  adjacent but not programmatically associated (no `htmlFor`/`id` linking
  them) — they render correctly today only because full-width inputs
  happen to wrap onto their own line, which a screen reader can't rely on.
  Fixing it properly means giving each of those ~34 inputs a stable `id`
  and pointing its label's `htmlFor` at it — mechanical, but broad enough
  across enough files that it was deliberately left for a dedicated pass
  rather than rushed alongside everything else in this one.

## Performance & caching

`server.js` was single-process and uncompressed until this pass. Real,
measured changes, verified live against the running server (independent
concurrent processes, not one bottlenecked test client sharing this
sandbox's own 2 CPU cores — see the session's own load-test notes for why
that distinction matters):

- **Every CPU core, not just one.** `server.js` now forks one worker
  process per core (Node's `cluster` module) instead of running as a single
  process — override with `WEB_CONCURRENCY` in `.env` (`1` for simpler
  local debugging). Every schema migration in `db.js` runs exactly once, in
  the primary process, *before* any worker is forked — SQLite's WAL mode
  (already enabled) is explicitly designed for what happens after that:
  several processes, one file, one writer at a time, unlimited concurrent
  readers. Verified live: 200 real concurrent connections to an
  authenticated data endpoint (`GET /api/kpis/values`) all succeeded with a
  median response time of ~8ms and a 95th-percentile of ~29ms, spread
  across both worker processes (confirmed via each response's own
  `worker` field on `GET /api/health`).
- **Real HTTP compression** (`compression` middleware) on every response —
  API JSON and the static frontend build alike. Measured directly: the
  frontend's ~1.16MB JS bundle transfers as ~350KB over the wire, about a
  70% reduction.
- **The frontend's built JS/CSS get cached for real, safely.** Vite bakes a
  content hash into every built filename (`index-RrOGiTXd.js` — a code
  change always produces a different URL), so `server.js` now serves those
  specific files with `Cache-Control: public, max-age=31536000, immutable`
  — a repeat visitor's browser never has to ask the server about them
  again. Everything else served from the same folder — `index.html`
  itself, and the unhashed files copied verbatim from `frontend/public/`
  (the ZOU logo images, `theme-init.js`) — deliberately stays on Express's
  conservative `max-age=0` default instead, so an update to any of those is
  never stuck behind a stale year-long cache. Verified live via response
  headers on each file type.
- **Three missing indexes added**, `CREATE INDEX IF NOT EXISTS` in `db.js`:
  `kpi_values(year, month)` and `kpi_contributions(year, month)` — the
  batch "everything for this one period" reads every data-entry/approvals/
  reviews screen fires, which filter on columns that weren't the leading
  column of any existing unique constraint — and
  `message_recipients(recipient_id)` for the inbox view. Invisible at this
  app's current size (a few dozen KPIs, a few dozen recorded values — raw
  query time was already sub-millisecond) but a real, compounding saving
  once years of monthly history accumulate.
- **API responses are deliberately NOT cached.** This was a real decision,
  not an oversight: `requireAuth` already re-reads a user's permissions
  from the database on every request specifically so a revoked permission
  takes effect immediately rather than "eventually" (see
  `SECURITY_REVIEW.md`'s finding #6 area) — caching KPI values, approval
  status, or RAG/compliance state would work directly against that same
  guarantee, in a tool people use to make real institutional decisions.
  Given how small and fast the actual queries already are, the honest
  trade wasn't close.
- One correctness detail worth knowing: `routes/auth.js`'s login rate
  limiter (`SECURITY_REVIEW.md`'s finding #3) keeps its counter in memory,
  per-process. With multiple worker processes now round-robining
  connections, that counter is no longer truly global — `server.js` passes
  the resolved worker count down via `WEB_CONCURRENCY`, and the limiter
  divides its base limit (8 per 10 minutes) by that count so the
  cluster-wide total stays close to the original intent instead of
  silently becoming 8-per-worker.
- A second correctness detail the cluster change exposed on a real
  restart: `db.js` has a handful of unconditional write statements (the
  permissions-catalog sync, a few `INSERT OR IGNORE` backfills) that
  re-run on every process's own `require('./db')`, not just once in the
  primary. With two worker processes starting within milliseconds of each
  other, WAL mode's "one writer at a time" rule could make the second
  worker's write collide with the first's — and with no
  `PRAGMA busy_timeout` set, `node:sqlite` threw `SQLITE_BUSY` ("database
  is locked") immediately instead of waiting. Node's `cluster` module
  auto-restarted the crashed worker, so the app still ended up healthy,
  but a crash-and-restart on every boot isn't acceptable — fixed by
  setting `PRAGMA busy_timeout = 5000` in `db.js`, so a worker now waits
  up to 5s for the other's write to finish instead of failing outright.
  Verified live: both workers now start cleanly with no crash/restart in
  the log.

## API reference (summary)

All endpoints are under `/api`. Authenticated endpoints require an
`Authorization: Bearer <token>` header from `POST /api/auth/login`.

- `POST /api/auth/login` (rate-limited two ways — 8 attempts/3min per
  account, 30/3min per IP as a backstop; see "Security" above), `GET /api/auth/me`,
  `POST /api/auth/change-password` (any signed-in user, own account,
  requires their current password — also clears `must_change_password` and
  returns a freshly-signed token), `POST /api/auth/logout-everywhere`
  (any signed-in user — bumps `token_version`, invalidating every
  outstanding token for the account, including the one used to call it),
  `PUT|DELETE /api/auth/me/avatar`
  (any signed-in user, own profile photo — a `data:` URL, capped size),
  `GET /api/auth/ict-admins` (deliberately unauthenticated — reachable from
  the sign-in screen's "Forgot your password?" panel before anyone has a
  token; returns only name/title/email for `ictadmin` accounts, the real,
  live contacts who can actually reset a password — there is no email/SMS
  delivery behind this app, so this replaces a fake "we'll send you a
  link" form rather than faking one)
- `GET /api/org` (now also returns `executiveOwner: { id, name, title } | null`
  — the single account, if any, currently designated Executive Owner; only
  active rows — `deleted_at IS NULL` — on all four tables),
  `GET /api/org/removed` (`manage_org_units` — the soft-removed side of the
  same four tables, most-recently-removed first; backs the "Recently
  Removed" panel),
  `POST /api/org/programmes` / `PATCH /api/org/programmes/:id` / `DELETE
  /api/org/programmes/:id` / `POST /api/org/programmes/:id/restore`,
  `POST /api/org/subs` / `PATCH /api/org/subs/:id` / `DELETE
  /api/org/subs/:id` / `POST /api/org/subs/:id/restore`,
  `POST /api/org/units` / `PATCH /api/org/units/:id` / `DELETE
  /api/org/units/:id` / `POST /api/org/units/:id/restore` — POST/PATCH back
  Organisation Builder (create/update), DELETE/restore back Organisation &
  People (remove/restore). Every POST route requires `manage_org_units` OR
  the narrower `create_org_units`; every PATCH route requires
  `manage_org_units` OR the narrower `edit_org_units` (both new
  permissions — see "Finer-grained org-structure permissions" below).
  DELETE and every `/restore` route stay behind `manage_org_units` alone,
  deliberately: undoing a removal should require the same authority that
  could remove it in the first place. Creation
  provisions a real Programme Head / Sub-programme Rep / Unit Head account
  exactly like the org's existing accounts, same pattern throughout; PATCH
  updates the entity's own name/head (and a Unit's kind) and keeps the
  linked account's `users.name`/`title` in sync, the same sync
  `PATCH /api/org/individuals/:id` already did. Every DELETE genuinely
  cascades — see `routes/org.js`'s `cascadeSoftDeleteProgramme/Sub/Unit` —
  taking everything nested beneath it (every Sub-programme/Unit/Individual,
  every KPI any of them own, and every login account that only exists
  because of them) out of active use inside one transaction, and returns a
  `removed: { kpis, individuals, units, subs, programmes, accounts }` count
  so the frontend can confirm exactly what just disappeared — but as a
  `deleted_at` stamp, never a real SQL DELETE, so it's never data loss: the
  matching `POST .../restore` route clears the stamp on the row and
  everything structurally beneath it, in one transaction, and it all
  reappears exactly as it was. `DELETE /api/org/units/:id` didn't exist at
  all before the Unit-level delete/restore pair landed — Unit creation had
  no matching delete route, so a Unit created by mistake had no way to be
  removed short of editing the database directly),
  `POST /api/org/individuals` (`manage_org_units` OR the narrower,
  scope-restricted `add_individual` — a Unit Head may only target their own
  unit, a Sub Rep only a unit within their own sub-programme) /
  `PATCH /api/org/individuals/:id` (same scoping — edits `individuals.name`/
  `role_title` and keeps the linked login account's own `users.name`/`title`
  in sync, which `PATCH /api/users/:id/profile` never touched; those are a
  separate pair of columns, so an Individual's name could previously drift
  out of sync between "who's signed in" and "who the org chart says this
  is") /
  `DELETE /api/org/individuals/:id` / `POST /api/org/individuals/:id/restore`
  (`manage_org_units` only — adding an individual provisions a login
  account; removing one deactivates that account and soft-deletes any KPIs
  they directly own, all reversed together by restore)
- `GET /api/org/proposals`, `POST /api/org/proposals` (`manage_framework`) —
  the structural-change proposal log
- `GET /api/kpis`, `GET /api/kpis/values?year&month`,
  `GET /api/kpis/values-range?year&fromMonth&toMonth` (the performance-lens
  read used by the quarterly/bi-annual/annual view — reports the latest
  value in the range per KPI, not a value for every month),
  `GET /api/kpis/:id/values`,
  `POST /api/kpis` (`create_kpi` — optionally seeds `assigneeIds`, a Unit-
  owned KPI only, each id validated as actually belonging to that unit),
  `PUT /api/kpis/:id` (`create_kpi` — the KPI's real definition:
  name/type/measure/baseline/target; owner is deliberately not editable
  here, see "What's real here" above) /
  `DELETE /api/kpis/:id` / `GET /api/kpis/removed` / `POST
  /api/kpis/:id/restore` (`create_kpi` — removal is a `deleted_at` stamp,
  never a real delete: the KPI drops out of every active list, but its
  values/assignments/contributions are all left exactly as they were and
  restore brings the whole thing straight back, same soft-delete pattern as
  the org structure above; `GET /removed` is scoped to the caller's own
  jurisdiction the same way every other KPI action already is),
  `PATCH /api/kpis/:id/targets` (`edit_targets` — baseline/target only, the
  narrower tier),
  `PUT /api/kpis/:id/value` / `POST /api/kpis/:id/submit` (`data_entry`, the
  KPI's owner only — an assigned Individual no longer owns the KPI's own
  value, only their own contribution row; see below — `PUT .../value` now
  writes the submitter's figure to `entered_value`, this period's own
  number, not the cumulative `value` column),
  `PUT /api/kpis/bulk-value` / `POST /api/kpis/bulk-submit` (`data_entry` —
  the table-based "My Data Entry" screen's own endpoints, one call for
  however many KPIs were checked at once instead of one call per KPI: `PUT
  .../bulk-value` takes `{ year, month, entries: [{ id, value }, …] }`,
  `POST .../bulk-submit` takes `{ year, month, ids: […] }`. Both re-validate
  EVERY row server-side — real ownership via the same `isOwner` check as the
  single-KPI routes, automated KPIs rejected from `bulk-value`, a missing
  value rejected from `bulk-submit` — before writing anything, and apply the
  whole batch inside one `db.transaction()`: if any single row in the batch
  fails validation, the entire request 4xxs and nothing in it is written,
  not just the bad row. These two routes are deliberately registered
  immediately after `GET /`, before any `/:id`-pattern route in this file —
  Express otherwise matches `PUT /bulk-value` against the earlier `PUT
  /:id` route, treating `"bulk-value"` as an `:id` and returning the wrong
  permission error; confirmed live and fixed this way, see the comment in
  `routes/kpis.js`),
  `POST /api/kpis/:id/approve` / `POST /api/kpis/:id/return` (`approve_own_tier`,
  approver only — approving now automatically computes and stores the new
  cumulative `value` as the previous official total plus `entered_value`;
  see "What's real here" above for the automated cumulative-performance
  feature),
  `POST|DELETE /api/kpis/:id/override` (`apply_override`, automated KPIs
  only — DELETE never destroys the cleared value/note, see "Manual overrides
  are soft-deleted too" above) /
  `POST /api/kpis/:id/override/restore` (`apply_override` — puts a just-
  cleared override straight back; 404s if there's nothing recently cleared
  for that period, 400s if a live override is already there),
  `PUT /api/kpis/:id/explanation`,
  `GET /api/kpis/assignments` (every current, non-removed KPI→Individual
  assignment),
  `POST /api/kpis/:id/assign` / `DELETE /api/kpis/:id/assign/:individualId`
  (`data_entry`, and only the Unit Head who owns that Unit-scoped KPI,
  targeting someone in that same unit — DELETE stamps `deleted_at` on the
  `kpi_assignments` row rather than deleting it, and POST restores that same
  row instead of inserting a duplicate if this exact pairing was ever
  assigned before, since the table's `UNIQUE(kpi_id, individual_id)`
  constraint means a plain re-insert would collide with it) — (`POST/DELETE
  /api/kpis/:id/claim`, the individual self-claim of a Unit-owned KPI, has
  been removed; see `/api/kpi-templates` below for its replacement)
- `GET /api/kpis/contributions?year&month` (every assignee's own
  contribution row for the period, scoped the same as `/kpis/values`),
  `PUT /api/kpis/:id/contribution` / `POST /api/kpis/:id/contribution/submit`
  / `PUT /api/kpis/:id/contribution/explanation` (`data_entry`, only an
  assignee entering their own figure toward a KPI they're assigned to —
  never the KPI's own `kpi_values` row),
  `POST /api/kpis/:id/contribution/:individualId/approve` /
  `POST /api/kpis/:id/contribution/:individualId/return`
  (`approve_own_tier`, only the Unit Head who owns that Unit-scoped KPI —
  approving recomputes the KPI's own value as the live sum of every
  currently-approved contribution for that period, see above)
- `GET /api/kpi-templates` (any signed-in user — the Unit-scoped "KPI for
  individuals" pool, each with a real `picked_count`),
  `GET /api/kpi-templates/removed` (`create_kpi` — the soft-removed side of
  the same pool, most-recently-removed first; backs KPI Management's own
  "Recently Removed" panel),
  `POST /api/kpi-templates` (`create_kpi` — `{ unitId, name, type, measure,
  baseline, target }`, creates the definition once against a Unit, owned by
  nobody yet), `DELETE /api/kpi-templates/:id` (`create_kpi` — stamps
  `deleted_at`, never a real DELETE; removes it from the pool only, anyone
  who already picked it up keeps their own KPI regardless — see
  `kpis.template_id`'s `ON DELETE SET NULL`) /
  `POST /api/kpi-templates/:id/restore` (`create_kpi` — clears the stamp,
  reappears in the pool exactly as it was),
  `POST /api/kpi-templates/:id/pick` (`data_entry`, Individual role only,
  and only for a non-removed template scoped to their own unit —
  instantiates a real, independent `kpis` row owned solely by them; rejects
  a second pick of the same template by the same person)
- `GET /api/plans?year=<cycleYear>` — the whole compiled Annual Plan &
  Budget picture for one cycle year (units, sub-programmes, programmes,
  and the university row, each with its own proposal and, above Unit
  tier, a live-derived `approvedBudget`/`provisionalBudget`).
  `PUT /api/plans/units/:unitId` / `POST /api/plans/units/:unitId/submit`
  (`data_entry`, the unit's own head only),
  `POST /api/plans/units/:unitId/approve|return` (`approve_own_tier`, the
  unit's Sub-programme Rep only — `return` requires a `comment`).
  `PUT /api/plans/subs/:subId` / `POST /api/plans/subs/:subId/submit`
  (`data_entry`, the sub's own Rep only — budget is read-only, derived),
  `POST /api/plans/subs/:subId/approve|return` (CPU, or the Programme
  Head who owns that sub's Programme — checked server-side by role AND
  `scope_id`, not role alone).
  `PUT /api/plans/programmes/:programmeId` /
  `POST /api/plans/programmes/:programmeId/submit` (CPU, or that
  Programme's own Programme Head only).
  `PUT /api/plans/university` / `POST /api/plans/university/submit`
  (`submit_annual_plan`, CPU only — both now reject the request once the
  plan is `submitted` or `approved`, the same lock every other tier already
  enforced), `POST /api/plans/university/approve` (`validate_annual_plan`,
  University Council only — only while `status: 'submitted'`; sets
  `status: 'approved'`) / `POST /api/plans/university/return`
  (`validate_annual_plan` — requires a `comment`; reopens the plan as a
  `draft` for CPU with that comment attached).
- `GET /api/messages/directory` (every other account's name/title/email/role
  — who you can write to; open to any signed-in user, deliberately not
  scope-restricted), `GET /api/messages/unread-count`,
  `GET /api/messages?box=inbox|sent`,
  `POST /api/messages` (`{ recipientIds, subject, body }` — every id must be
  a real account), `POST /api/messages/:id/read` (only a real recipient of
  that message can mark it read), `DELETE /api/messages/:id` (deletes only
  the caller's own copy — their Inbox row if they're a recipient, their
  Sent row if they're the sender; the message is only actually purged once
  every participant has deleted their own copy).
- `GET /api/users`, `PATCH /api/users/:id/profile` (update name/title/email),
  `POST /api/users/:id/reset-password` (set a specific password or, if none
  given, generate a random one — returned once, in the response, to the
  admin who just set it — the real, working answer to a forgotten password
  in a system with no email/SMS delivery behind it),
  `POST /api/users/:id/permissions/:key/grant|revoke`,
  `PATCH /api/users/:id/role` (change a user's role/scope),
  `PATCH /api/users/:id/overview-limit` (`{ overview_limit: null|'programme'|
  'sub'|'unit' }` — caps that account's Overview drill-down depth,
  independent of role/permissions),
  `PATCH /api/users/:id/executive-owner` (`{ on: true|false }` — setting
  `true` clears any existing holder first, in one transaction, so there is
  never more than one),
  `GET /api/users/removed` (the soft-removed side of the Directory —
  accounts removed directly by DELETE below, most-recently-removed first;
  backs Permissions &amp; User Directory's own "Recently Removed" panel —
  an account deactivated as a side effect of removing the Individual/
  Unit-head/Sub-Rep/Programme-head it belongs to shows up on Organisation
  &amp; People's Recently Removed instead, not here),
  `DELETE /api/users/:id` / `POST /api/users/:id/restore` (remove/restore an
  account — a user can't remove their own account; removal is a
  `deleted_at` stamp, same soft-delete pattern as the org structure and
  KPIs above, so sign-in is blocked and the account drops out of the
  Directory without the row, its permissions, or its audit history ever
  actually being deleted) — all `ictadmin` role only
- `GET /api/audit` (`view_audit`)
- `GET /api/settings`, `PATCH /api/settings` (`manage_settings`)
- `GET /api/compliance?year&month` — late-submission compliance per
  Sub-programme and Red-KPI performance escalation, computed live from
  real timestamps and values against the thresholds in Settings
