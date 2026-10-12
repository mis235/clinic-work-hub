# Clinic OS — End-to-End Architecture & Workflow

This maps directly to the multi-device / mobile-first requirement. It's split into
**what's built and tested right now** and **what's a defined next phase** — nothing
below is aspirational marketing copy; every claim in "Built" was verified by
`backend/test-e2e.sh` in this repo.

---

## 1. The core principle, and how the code actually satisfies it

> "Use one centralized backend, database, authentication system, permission system,
> workflow engine, task engine, notification engine and integration layer."

There is exactly **one** Express API (`backend/`) and **one** SQLite database. Every
device — phone, tablet, laptop, desktop browser, installed PWA — talks to that same
API over the same endpoints. There is no separate "mobile backend" or "admin backend."

```
                          ┌─────────────────────────┐
                          │   ONE CENTRAL BACKEND     │
                          │  (Express + SQLite)       │
                          │                           │
   Android / iPhone ────▶│  Auth (JWT)               │
   Android / iPad  ────▶ │  RBAC (role→permission)   │◀──── WhatsApp Cloud API
   Windows laptop  ────▶ │  Task engine              │      (webhook + send)
   Mac laptop      ────▶ │  Integration layer        │
   Any browser     ────▶ │  Notification layer       │
                          └───────────┬───────────────┘
                                      │
                              ┌───────▼────────┐
                              │  SQLite (one    │
                              │  source of      │
                              │  truth)         │
                              └────────────────┘
```

The React frontend (`frontend/`) is a single codebase, not one build per device. It
adapts via CSS breakpoints (mobile portrait → tablet → laptop → large desktop) —
see `frontend/src/theme.css`, the media queries at the bottom. Same bundle, same
logic, same permissions, different layout.

---

## 2. RBAC: USER → ROLE → DEPARTMENT → PERMISSION → ACTION

This is implemented literally, not just conceptually:

- `roles` table: `admin`, `manager`, `staff` (add more anytime — no code changes needed
  for a new role, just new rows).
- `permissions` table: fine-grained actions (`task:assign`, `task:view_all`,
  `staff:manage`, `leave:approve`, etc.)
- `role_permissions` joins the two.
- `users.role_id` + `users.department_id` place every person in the model.
- Every route checks `requirePermission('some:action')` — never `if (device === mobile)`
  or `if (role === 'admin')` hardcoded. Confirmed by the test suite: a staff user's
  token is correctly rejected with 403 when it tries to hit an admin-only action.

This means **device type never determines authorization** — a manager on their phone
has exactly the same permissions as on their desktop, because the permission check
happens once, server-side, keyed to their role.

---

## 3. Multi-channel task interaction — the exact example from the spec, working

> "Task assigned → WhatsApp notification → employee accepts through WhatsApp →
> central task status = ACCEPTED → employee opens laptop → same task shows ACCEPTED..."

This exact chain is implemented and tested:

1. Admin/manager assigns a task (web or mobile browser — same form, same API call).
2. Backend sends a WhatsApp template message (`backend/src/whatsapp.js`).
3. Staff replies `1` on WhatsApp → Meta calls the webhook
   (`backend/src/routes/webhook.js`) → task status becomes `accepted` in the one
   central `tasks` table.
4. Staff (or their manager) opens the app on any other device → same status, same
   task, because it's the same row in the same database — there is no sync step,
   because there was never a second copy to sync.
5. Every status change (`sent`, `accepted`, `in_progress`, `done`,
   `extension_requested`, `issue_reported`) is logged in `task_events` with which
   `channel` produced it (`web` or `whatsapp`), so you get a full audit trail of who
   did what, from where.

Full lifecycle keywords supported over WhatsApp: `1`=accept, `2`=start, `3`=done,
`4`=request extension, `5`=report an issue.

---

## 3a. Biometric attendance — phone fingerprint/Face ID, no hardware needed

Since attendance only needs to work through staff's own phones, this uses **WebAuthn**
— the same standard behind "Sign in with Face ID" on banking apps — instead of a
physical biometric scanner:

1. Staff registers their phone once (Register this device button). This triggers the
   phone's own fingerprint/Face ID prompt and creates a cryptographic key pair —
   the private key never leaves the phone's secure hardware, and the clinic's server
   only ever stores the public half.
2. To check in/out, staff taps one button, the phone re-prompts for the same
   fingerprint/Face ID, and the signed response is verified server-side
   (`backend/src/routes/attendance.js`) before an `attendance` row is written.
3. Because it's biometric-bound to that specific phone, someone else can't check in
   on your behalf even if they have your phone unlocked for other reasons — the
   biometric prompt happens fresh, every time.
4. Admin has a manual-override endpoint (`attendance:manual_override` permission) for
   the day someone's phone is broken — always logged with `method: 'manual'` so it's
   never confused with a genuine biometric check-in in reports.

**Important deployment requirement:** WebAuthn only works over HTTPS (or `localhost`
for local testing) — browsers refuse it over plain HTTP for security reasons. This is
automatically satisfied once you deploy to Vercel/Render (both give you HTTPS by
default), so it's not an extra step, just something to know if you test on your local
network's IP address instead of localhost or the deployed URL.

**What I could test here without a real phone:** the server-side logic — that
registration options require a platform (phone) authenticator, that check-in is
correctly blocked before a device is registered, that a staff member can't call the
admin-only manual override, and that a recorded check-in shows up in the admin view.
All of that is in `test-e2e.sh` and passing. **What needs your phone to confirm:** the
actual fingerprint/Face ID prompt appearing and working end-to-end — that's the one
piece of this feature that a server-side test genuinely cannot simulate.

---

## 3b. AI Advisors — the first slice of the "AI Management Assistant"

Seven specialist agents are wired in as a real chat feature (`backend/src/agents/`,
`backend/src/routes/advisors.js`, `frontend/src/pages/AdvisorsPage.jsx`):
Provider Recruiting Strategist, Credentialing & Licensing Manager, Staffing Ratio
Analyst, Onboarding & Training Program Manager, Compensation & Incentive Architect,
Locum/Float Coverage Coordinator, and Staff Retention & Culture Manager.

**Deliberate scope boundary:** these agents are read/advise-only. They call the
Anthropic API with their specialist system prompt and whatever the admin/manager types
in; they do not read the app's live database and cannot write to any table. This is on
purpose — an AI agent silently changing staffing, pay, or credentialing records without
a human approving first is a real risk, not a convenience worth the tradeoff at this
stage. Tested: permission gating (staff correctly denied), unknown-agent 404, and
graceful (not crashing) failure when no API key is configured.

**What "AI Control Tower" would add beyond this:** the agents currently work from
whatever the person pastes into the chat. Connecting specific agents to live data —
e.g., the Staffing Ratio Analyst reading actual attendance/task-completion numbers
instead of being told them — is the natural next step, but should happen deliberately,
one agent at a time, once you know which ones get used enough to justify it.

---

## 4. PWA / responsive / offline

**Built:**
- `frontend/public/manifest.json` + `sw.js` — the app is installable on Android and
  iOS home screens, and the app shell (HTML/CSS/JS) loads even with no connection.
- Responsive breakpoints in `theme.css`: sidebar collapses into an off-canvas drawer
  with a hamburger button below 880px width (phones, small tablets); stat cards
  reflow from 5 columns to 2; modals become bottom sheets on small screens; desktop
  gets extra breathing room above 1440px.
- The service worker deliberately **never caches `/api/` or `/webhook/` responses** —
  task data is always fetched live, so nobody ever acts on stale status.

**Honest gap — not built:** true offline task actions (mark a task done with no
signal, queue it, replay automatically on reconnect). The spec asks for this
("limited offline capability, automatic synchronization after reconnection") and it's
a real, well-scoped next step: it needs a local queue (IndexedDB) plus a
background-sync event in the service worker, and idempotent server-side handling of
replayed actions. Flagging this explicitly rather than claiming it works.

---

## 5. What's fully built and tested vs. what's next

| Area | Status |
|---|---|
| Auth (JWT, email+password, phone+PIN) | ✅ Built & tested |
| RBAC (role → permission → action) | ✅ Built & tested |
| Departments & roles model | ✅ Built & tested |
| Task engine (assign, accept, progress, done, extension, issue) | ✅ Built & tested |
| WhatsApp send + webhook (Cloud API) | ✅ Built (needs your Meta credentials to go live — see backend README) |
| Multi-channel single-source-of-truth sync | ✅ Built & tested (web ↔ WhatsApp) |
| Responsive layout (mobile/tablet/laptop/desktop) | ✅ Built |
| PWA installable + offline app-shell | ✅ Built |
| True offline task queue + background sync | ⏳ Scoped, not built |
| Biometric attendance (phone fingerprint/Face ID via WebAuthn) | ✅ Built & tested (server-side; the actual biometric prompt needs a real phone to fully verify — see note below) |
| Leave management workflow | ⏳ Not started — permissions (`leave:apply`, `leave:approve`) already exist in the RBAC model, ready for the feature |
| Performance / KPI engine | ⏳ Not started |
| Payroll / payslips / incentives | ⏳ Not started — this needs your compliance requirements (PF, ESI, TDS slabs) defined first |
| Expenses, documents, training, assets | ⏳ Not started |
| Approvals / escalations workflow engine | ⏳ Not started — task engine's status model is the pattern to extend |
| AI Management Assistant / AI Control Tower | 🟡 First 7 specialist advisor agents built & tested (workforce/staffing domain) — see below. Broader "control tower" that reads live app data and takes multi-domain action is still ahead. |
| Device/session management UI + remote revocation | 🟡 Data model exists (`sessions` table, logged on every login); no admin UI yet |
| Policies (versioned, staff acknowledgment tracking) | ✅ Built & tested — 5 starter drafts seeded (marked clearly as drafts, not final) since the source site's Policies page was empty |
| Reports (task completion, attendance, policy sign-off gaps) | ✅ Built & tested — pure aggregation from existing data, no new input needed |
| About / clinic info | ✅ Built & tested — real content from the source site's actual About page |
| Team / Management profiles | ✅ Built & tested — starts empty (source page was empty), admin adds real profiles |
| HR / Offer Letters | ✅ Built & tested — real generator, not a static folder link |
| Learning & Resources / Training Videos | ✅ Built & tested — per-staff watch tracking, starts empty pending real video links |
| Upcoming Events (birthdays, festivals, years of experience) | ✅ Built & tested — birthdays/tenure computed live from user records; festivals/dates admin-entered |
| Multi-company payroll (payslip PDF generation) | ✅ Built & tested — verified against a real payslip, exact numbers match |
| Automated payslip emailing (monthly cron) | ✅ Built & tested (server logic); needs your Gmail App Password to actually send |
| Automated checklist digest emailing (daily cron) | ✅ Built & tested (server logic); same Gmail setup enables it |
| Push notifications | ⏳ Not built — needs Web Push (VAPID keys) wired into the notification layer |

---

## 6. Suggested build order for the remaining phases

Given everything shares the same backend and RBAC spine, the lowest-risk order is:

1. **Attendance** (biometric or QR/geofence check-in) — feeds performance and payroll later.
2. **Leave** — permissions already exist; mostly a new table + two screens (apply, approve).
3. **Performance & KPIs** — depends on task-completion data you're already collecting.
4. **Approvals/escalations** — generalize the task-status pattern into a reusable workflow engine.
5. **Payroll/incentives/expenses** — highest compliance risk; needs your accountant's
   input on statutory rules before writing logic.
6. **AI Management Assistant** — most valuable once attendance, performance, and
   approvals produce real data for it to reason over; premature before that.

Each phase can reuse the same `users`/`roles`/`permissions` tables — you're not
rebuilding auth or RBAC six more times, just adding tables and permissions per module.
