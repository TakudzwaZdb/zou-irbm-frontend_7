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
  Programme tier, a real **Programme Head** account (see below) approves
  or returns each of their own Sub-programmes' plans and compiles/submits
  their own Programme's narrative (its budget is, again, always the
  derived sum of its sub-programmes) — CPU can still do the same for any
  Programme, as org-wide oversight, but it's no longer standing in for a
  role that doesn't otherwise exist. CPU alone compiles and submits the
  single University Annual Plan for the cycle, gated by `submit_annual_plan`.
- **Programme Head — a real account tier, not a CPU stand-in**: one
  Programme Head account per Programme (`role: "programme"`, scoped to
  that Programme's id), with genuine, server-checked authority — never a
  role label alone. On Overview, they land straight on their own
  Programme and can drill into every Sub-programme beneath it (and
  everything under those), read-only, the same drill-down every other
  role uses — but never another Programme's. On Annual Plan & Budget,
  they approve/return their own Sub-programmes' plan proposals and
  compile/submit their own Programme's plan — `POST /api/plans/subs/:id/approve`
  and the Programme-tier routes check `role === 'programme' && scope_id
  === <that Programme's id>` server-side, not just role, so a Programme
  Head can't act on another Programme's plan even by calling the API
  directly (verified with a real 403). ICT admin can promote any existing
  account to Programme Head from the Permissions page, choosing which
  Programme it's scoped to.
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
- **A Sub-programme's own KPI performance submission now goes through its
  Programme Head before CPU, not straight to CPU**: previously every
  sub-owned KPI (`kpis.owner_type = 'sub'`) had exactly one approver — CPU
  — the same single-stage shape as every other tier. It's now a genuine
  two-stage review: the Sub Rep submits (`status: 'submitted'`), their own
  Programme Head reviews it first, and approving moves it to a new
  intermediate status, `'programme_approved'`, and forwards it on to CPU
  for the real final sign-off (`status: 'approved'`) — CPU is blocked with
  a 403 from acting on it at the first stage, and the Programme Head is
  equally blocked from acting on it once it's already moved past them.
  Individual- and Unit-owned KPIs are completely unaffected — still their
  original single approver, one stage, exactly as before. The automated
  cumulative-value computation (`previousOfficialValue + entered_value`,
  see above) deliberately still only ever happens at the one true final
  approval — CPU's — never at the Programme Head's intermediate sign-off,
  so a KPI's official running total is never provisional. A return, at
  either stage, always resets the submission all the way back to a plain
  `'draft'` with the reviewer's comment attached — it never bounces
  sideways to the other reviewer to pass along, matching how every other
  return in this app already works.
  - **Server-enforced**: `kpi_values.status`'s CHECK constraint was widened
    (SQLite requires the create-table-and-copy migration technique used
    elsewhere in this codebase, since a CHECK can't be altered in place —
    see `db.js`, detected idempotently off the table's own stored schema
    text) to allow `'programme_approved'` alongside the existing
    draft/submitted/approved values, with a new `programme_approved_at`
    timestamp column alongside the existing `submitted_at`/`approved_at`.
    `routes/kpis.js`'s `isApprover(user, kpi, status)` now takes the row's
    current status as a real parameter — for a sub-owned KPI it resolves to
    the Programme Head while status is `'submitted'`, or CPU once it's
    `'programme_approved'` — and both `POST /:id/approve` and
    `POST /:id/return` check the row's actual current status against this
    before allowing the action, so nobody can skip ahead or act out of turn
    by calling the API directly regardless of what the UI shows them.
    `programme`'s default permission set gained `approve_own_tier` (already
    held by Sub Reps/Unit Heads) — and, since permissions are granted
    per-user only once at seed time rather than re-derived from the role at
    request time, a one-time idempotent backfill in `db.js` grants it
    directly to every already-seeded Programme Head account too, so this
    works immediately on a database that predates the feature, not only on
    a freshly reseeded one.
  - **Frontend**: `lib/scope.js`'s `isApprover` mirrors the backend exactly,
    including the `status` parameter; Programme Head gained a real
    Approvals Queue nav item (`lib/nav.js`) now that they hold
    `approve_own_tier`, which correctly buckets a sub-owned KPI as pending
    only while it's actually at the stage they can act on, and files a
    forwarded-to-CPU item under "Decided this period" rather than either
    losing track of it or leaving it stuck looking "pending" forever
    (`pages/Approvals.jsx`). The submitter's own My Data Entry groups
    `'programme_approved'` together with `'submitted'` under "awaiting
    review" (`pages/Entry.jsx`) — from the Sub Rep's own point of view it's
    still just waiting on someone else, whichever of the two reviewers that
    currently is. `components/KpiCard.jsx` locks the entry field through
    both pending stages and shows a distinct "Approved by Programme — with
    CPU" chip (new `.chip-st-programme_approved` style) so the two stages
    read as visibly different, without borrowing the "done" green already
    reserved for a true final approval. The pending-review item in the
    Alerts bell (`lib/alerts.js`) now correctly reaches whichever of the two
    reviewers actually owns the current stage.
  - **Verified**: a full submit → Programme Head approve → CPU approve run
    via direct API calls, confirming CPU is 403'd at the first stage and
    the Programme Head is 403'd once it's moved past them, that the
    cumulative value is computed only at CPU's final approval (not the
    Programme Head's), and the return path resets all the way back to
    draft at both stages, with a resubmit-and-retry run through the whole
    cycle a second time; a regression check confirming Individual- and
    Unit-owned KPIs still run their original single-stage approval
    completely unchanged; and a full browser walk-through (Sub Rep submits
    → Programme Head's Approvals Queue shows and approves it → CPU's own
    Approvals Queue shows it with the new status chip and gives final
    approval), plus a role-by-role sweep of every page for all eight
    account types with zero console errors.
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
- Automated cumulative performance (see "What's real here" above) doesn't
  cascade retroactively: amending an already-approved period leaves its
  stored `value` frozen at the old official figure until that period is
  re-approved, at which point it recomputes from whatever the *current*
  previous-period total is. Later periods that were already approved off
  the old figure are not automatically walked forward and recalculated —
  a deliberate scope boundary, not an oversight, to avoid a single edit
  silently rewriting a long chain of already-signed-off history.
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
deployment. Before putting it in front of real ZOU staff or data:

- Replace every seeded account and the shared demo password with real
  individual credentials (and consider adding password-reset and
  multi-factor authentication).
- Set a long, random `JWT_SECRET` in `.env` — never use the default.
- Put it behind HTTPS, on real hosting, with a real backup strategy for
  the SQLite file (or migrate to a managed database).
- Have ZOU's IT/security team review authentication, data-retention, and
  access-control requirements before go-live.

## API reference (summary)

All endpoints are under `/api`. Authenticated endpoints require an
`Authorization: Bearer <token>` header from `POST /api/auth/login`.

- `POST /api/auth/login`, `GET /api/auth/me`,
  `POST /api/auth/change-password` (any signed-in user, own account,
  requires their current password), `PUT|DELETE /api/auth/me/avatar`
  (any signed-in user, own profile photo — a `data:` URL, capped size)
- `GET /api/org` (now also returns `executiveOwner: { id, name, title } | null`
  — the single account, if any, currently designated Executive Owner),
  `POST /api/org/units` (requires `manage_org_units`),
  `POST /api/org/individuals` (`manage_org_units` OR the narrower,
  scope-restricted `add_individual` — a Unit Head may only target their own
  unit, a Sub Rep only a unit within their own sub-programme) /
  `DELETE /api/org/individuals/:id` (`manage_org_units` only — adding or
  removing an individual also provisions or removes their login account
  and, on removal, any KPIs they directly own)
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
  here, see "What's real here" above) / `DELETE /api/kpis/:id` (`create_kpi`
  — a real delete; values/assignments/contributions all cascade),
  `PATCH /api/kpis/:id/targets` (`edit_targets` — baseline/target only, the
  narrower tier),
  `PUT /api/kpis/:id/value` / `POST /api/kpis/:id/submit` (`data_entry`, the
  KPI's owner only — an assigned Individual no longer owns the KPI's own
  value, only their own contribution row; see below — `PUT .../value` now
  writes the submitter's figure to `entered_value`, this period's own
  number, not the cumulative `value` column),
  `POST /api/kpis/:id/approve` / `POST /api/kpis/:id/return` (`approve_own_tier`,
  approver only — approving now automatically computes and stores the new
  cumulative `value` as the previous official total plus `entered_value`;
  see "What's real here" above for the automated cumulative-performance
  feature),
  `POST|DELETE /api/kpis/:id/override` (`apply_override`, automated KPIs only),
  `PUT /api/kpis/:id/explanation`,
  `GET /api/kpis/assignments` (every current KPI→Individual assignment),
  `POST /api/kpis/:id/assign` / `DELETE /api/kpis/:id/assign/:individualId`
  (`data_entry`, and only the Unit Head who owns that Unit-scoped KPI,
  targeting someone in that same unit) — (`POST/DELETE /api/kpis/:id/claim`,
  the individual self-claim of a Unit-owned KPI, has been removed; see
  `/api/kpi-templates` below for its replacement)
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
  `POST /api/kpi-templates` (`create_kpi` — `{ unitId, name, type, measure,
  baseline, target }`, creates the definition once against a Unit, owned by
  nobody yet), `DELETE /api/kpi-templates/:id` (`create_kpi` — removes it
  from the pool only; anyone who already picked it up keeps their own KPI,
  see `kpis.template_id`'s `ON DELETE SET NULL`),
  `POST /api/kpi-templates/:id/pick` (`data_entry`, Individual role only,
  and only for a template scoped to their own unit — instantiates a real,
  independent `kpis` row owned solely by them; rejects a second pick of the
  same template by the same person)
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
  `DELETE /api/users/:id` (remove an account — a user can't change their own
  role or remove their own account) — all `ictadmin` role only
- `GET /api/audit` (`view_audit`)
- `GET /api/settings`, `PATCH /api/settings` (`manage_settings`)
- `GET /api/compliance?year&month` — late-submission compliance per
  Sub-programme and Red-KPI performance escalation, computed live from
  real timestamps and values against the thresholds in Settings
