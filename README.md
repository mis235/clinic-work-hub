# Dr. Nishita's Clinic — Work Hub

A real, working replacement for the Google Sites work-hub: admin assigns tasks to staff,
tasks go out over WhatsApp, staff replies update status automatically, and a live
dashboard shows what everyone is doing.

This is a genuine two-part system, tested end-to-end in this environment:

- **backend/** — Node + Express + SQLite API, with a WhatsApp Cloud API webhook that
  listens for staff replies and updates task status automatically.
- **frontend/** — React (Vite) app with an admin dashboard and a staff checklist view,
  in a new visual theme (navy/gold/cream, serif headings).

---

## 1. Run it locally

### Backend

```bash
cd backend
npm install
cp .env.example .env        # then fill in the values (see section 3 below)
npm run seed                # loads your staff directory into the database
npm run dev                 # starts on http://localhost:4000
```

### Frontend

```bash
cd frontend
npm install
npm run dev                 # starts on http://localhost:5173
```

Open http://localhost:5173. Log in as Admin with the email/password from your `.env`,
or as Staff with any seeded name and PIN `1234` (change this before going live).

### Real staff data now seeded

`npm run seed` loads your **actual 19-person roster** from Staff_KRA-KPI.xlsx (Arshad's
responsibilities already merged into Asif's role, as done earlier), across all 8 real
departments (Front Desk, Therapist, MDO, Doctors, Pharmacy, Floor Coordinator, Finance,
Supporting Staff), plus **101 checklist templates** — every individual responsibility
line from the KRA sheet, ready to assign with one click via the "Use a checklist
template" dropdown in the Assign Task form.

**Before going live, you need to:**
1. Replace every placeholder phone number (`+9190000200xx` in `backend/src/seed.js`)
   with the real WhatsApp number for that person — or, once the app is running, use
   the "Staff" screen in the admin sidebar to edit phone, email, birthday, and join
   date directly, no code editing needed.
2. Decide who fills the 6 positions the sheet left unnamed (Frontdesk Executive,
   Process Coordinator, Lead Therapist, Patient Experience Manager & Therapists, one
   Therapist slot, Driver) — their responsibilities are already seeded as checklist
   templates so nothing is lost, they just don't have a login yet. Add them via the
   admin dashboard once you have names, or tell me and I'll add them to the seed.
3. Confirm the three manager assignments (Naga/COS, Asif/Pharmacy, Monika/Floor) match
   who should actually have assign/approve authority — change any of them anytime via
   `PATCH /api/users/:id/role`, no code change needed.

### Automated check
Before clicking through manually, you can run the whole backend loop automatically:

```bash
cd backend
npm install          # if you haven't already
bash test-e2e.sh
```

This spins up the server against a throwaway test database, seeds staff, logs in as
admin, creates a task, logs in as staff, simulates a WhatsApp "done" reply, and checks
that the task status updated correctly — printing PASS/FAIL for each step. It never
touches your real `clinic.db`, so it's safe to run any time, including after you make
code changes.

At this point everything works **except actually sending/receiving WhatsApp messages** —
that needs the Meta setup in section 3. Admin can still assign tasks and staff can still
update status by tapping the buttons in the app; only the "Send WhatsApp" button and the
auto-update-from-reply feature need Meta credentials.

---

## 2. How the WhatsApp loop works

```
Admin assigns task in app
        │
        ▼
Backend calls WhatsApp Cloud API → staff gets a WhatsApp message
        │
        ▼
Staff replies "1" (started) or "2" (done) on WhatsApp
        │
        ▼
Meta sends that reply to your webhook (POST /webhook/whatsapp)
        │
        ▼
Backend matches the phone number → staff member → their open task
        │
        ▼
Task status updates in the database → dashboard reflects it live
        │
        ▼
Backend sends a confirmation message back to staff on WhatsApp
```

This is implemented in `backend/src/whatsapp.js` (sending) and
`backend/src/routes/webhook.js` (receiving + auto-updating).

---

## 3. Setting up WhatsApp Cloud API (one-time, ~30–45 min)

1. **Create a Meta Business account** at business.facebook.com if you don't have one.
2. Go to **developers.facebook.com** → My Apps → Create App → choose "Business" type.
3. Add the **WhatsApp** product to the app.
4. Under WhatsApp → API Setup, note down:
   - **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`
   - **WhatsApp Business Account ID** → `WHATSAPP_BUSINESS_ACCOUNT_ID`
   - Generate a **permanent access token** (System User → generate token with
     `whatsapp_business_messaging` + `whatsapp_business_management` permissions) →
     `WHATSAPP_ACCESS_TOKEN`
5. **Add and verify a real business phone number** (not your test number) if you want
   this to go live with the whole team — Meta walks you through OTP verification.
6. **Create a message template** (WhatsApp → Message Templates → Create):
   - Name: `task_assignment` (must match `WHATSAPP_TASK_TEMPLATE_NAME`)
   - Category: Utility
   - Body:
     ```
     Hi {{1}}, you've been assigned a new task: *{{2}}*.
     Category: {{3}}. Due: {{4}}.
     Reply *1* when you start, *2* when it's done.
     ```
   - Submit for approval — usually approved within minutes to a few hours.
   - **Templates are required** for the *first* message in a conversation (outside a
     24-hour window); free-form replies only work within 24h of the staff member last
     messaging in, which is why the "confirmation" message after a reply works but the
     initial task message needs a template.
7. **Set up the webhook**:
   - Deploy the backend first (section 4) so you have a public URL.
   - In Meta's app dashboard → WhatsApp → Configuration → Webhook, enter:
     - Callback URL: `https://your-backend-url.com/webhook/whatsapp`
     - Verify token: whatever you set as `WHATSAPP_VERIFY_TOKEN` in `.env`
   - Subscribe to the **messages** field.
8. Fill in all the values from steps 4–7 into `backend/.env`.

---

## 4. Deploying (so it's live, not just local)

**Backend** (Render, Railway, or Fly.io all work well for a small Node app):
1. Push the `backend/` folder to a GitHub repo.
2. On Render: New → Web Service → connect the repo → root directory `backend`.
   - Build command: `npm install`
   - Start command: `npm start`
   - Add all the `.env` variables in the dashboard's Environment tab.
3. Once deployed, you'll get a URL like `https://clinic-work-hub-api.onrender.com` —
   use this as your webhook callback URL in step 3.7 above, and as `VITE_API_URL` for
   the frontend.

**Frontend** (Vercel or Netlify):
1. Push `frontend/` to the same or a separate repo.
2. Import into Vercel → set the environment variable `VITE_API_URL` to your backend URL.
3. Deploy. You'll get something like `https://clinic-work-hub.vercel.app` — this
   replaces the Google Sites link for your team.

**Database note:** SQLite (used here) is fine for a single clinic's traffic and keeps
things simple. If you outgrow it, swap `backend/src/db.js` for a hosted Postgres
(e.g. Supabase or Render's managed Postgres) — the rest of the code doesn't need to
change much since the queries are plain SQL.

---

## 5. Biometric attendance (phone fingerprint/Face ID)

No extra hardware or setup needed beyond the `.env` values already in
`.env.example` (`WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_ORIGIN`):

- For local testing, the defaults (`localhost`) work as-is.
- For production, set `WEBAUTHN_RP_ID` to your bare domain (e.g.
  `workhub.drnishitaranka.com`, no `https://`) and `WEBAUTHN_ORIGIN` to the full URL
  including `https://`. These **must** exactly match where the frontend is served —
  WebAuthn will silently reject mismatches as a security measure.
- WebAuthn requires HTTPS in production (localhost is exempted for dev). Both
  Vercel and Render provide this automatically, so once deployed there's nothing
  extra to configure.

Each staff member registers their own phone once (in their dashboard), then taps
"Check in / out" — their phone's fingerprint or Face ID prompt appears, and on
success the attendance record is written centrally, visible to admin immediately.

## 6. AI Advisors (specialist workforce/staffing agents)

Seven specialist agents (Provider Recruiting Strategist, Credentialing & Licensing
Manager, Staffing Ratio Analyst, Onboarding & Training Program Manager, Compensation &
Incentive Architect, Locum/Float Coverage Coordinator, Staff Retention & Culture
Manager) are available under "AI Advisors" in the admin/manager sidebar.

**These are advisory only** — an admin or manager asks a question, the agent responds
using its specialist system prompt, and nothing is written back to any other table
automatically. A human always decides whether to act on the recommendation.

To enable it:
1. Get an API key from console.anthropic.com.
2. Add it to `backend/.env` as `ANTHROPIC_API_KEY=sk-ant-...`.
3. Restart the backend. Without a key, the feature shows a clear "not configured yet"
   message instead of failing silently or crashing — you can deploy the rest of the
   app first and add this later.

Each agent will ask you for the specific data it needs (staffing levels, turnover
data, compensation figures, etc.) — it doesn't currently pull that automatically from
the app's own database. Wiring specific agents to real app data (e.g., having the
Staffing Ratio Analyst read live attendance/task-completion numbers) is a reasonable
next step once you've tried the advisory-only version and know which agents you use most.

## 7. Policies and Reports

**Policies:** the app now has 5 starter policy drafts (Attendance, Leave, Code of
Conduct, Patient Confidentiality, Grievance Process) — clearly marked `[DRAFT --
REVIEW AND EDIT]` in their text. These exist because your site's actual Policies page
was empty; they are NOT your finalized policies. Every staff member sees "Policies" in
their sidebar and must tap "I've read this" to acknowledge the current version.
**If you edit a policy's text, everyone's acknowledgment resets automatically** — this
is intentional, so admin can always trust that "acknowledged" means they read the
current wording, not an old version.

To edit a policy: currently via direct API call (`PATCH /api/policies/:id`) or editing
`backend/src/seed.js` before running `npm run seed` on a fresh database. A proper
in-app edit screen is a natural next addition once you've reviewed the drafts.

**Reports:** a new "Reports" section shows task completion by department, attendance
over the last 30 days, and — usefully — exactly which staff haven't yet acknowledged
the current version of each policy. All of this is built from data the app already
collects; nothing new to configure.

## 8. About, Team, HR Offer Letters, Learning, and Events

Full parity with the remaining sections of your Google Site:

- **About**: real content, pulled directly from your site's actual About page
  (Dr. Nishita's bio, clinic vision/mission). Nothing invented here.
- **Team/Management**: starts empty (the source page was empty) — admin adds real
  profiles via "+ Add profile" in the app.
- **HR → Offer Letters**: a real generator, not a static folder. Admin fills in
  candidate/role/salary/start date, gets a ready letter, and it's saved for later —
  admin-only (`staff:manage` permission).
- **Learning & Resources**: a training video library by department, with per-staff
  "watched" tracking — this is the real time-to-productivity data an onboarding
  program needs. Starts empty; admin adds real video links.
- **Upcoming Events**: festivals and important dates are admin-entered; **birthdays and
  years-of-experience are computed automatically** from each staff member's birthday
  and join date — **now editable directly via the "Staff" screen in the admin sidebar**,
  no API calls needed. Until those are set, the page tells you plainly that no data is on
  file yet rather than showing fake entries.

## 9. Payroll and Automated Emails (Payslips + Checklist Digests)

Real, multi-company payroll — built from an actual payslip you shared, not a
generic template:

- **Companies**: three legal entities on file (Shanta's Derma Pharmacy, Dr.
  Nishita's Clinic, Dr. Nishita Skin Hair & Aesthetics). Only Shanta's Derma
  Pharmacy has a real address (from your payslip) — add the other two addresses
  whenever you have them.
- **Pay profiles**: one real profile is seeded (Neelima — Basic ₹20,000, Retention
  ₹2,000 deduction, matching her actual June 2026 payslip exactly, verified by
  rendering a generated PDF and comparing it against your upload). Every other
  employee needs their salary structure entered via "Payroll → + Set up an
  employee's pay" before payroll can run for them.
- **Payslip PDFs** match your existing letterhead layout precisely (company
  name, address, employee info block, earnings/deductions table, net payable in
  words).
- **Automatic monthly payroll**: a scheduled job (`PAYROLL_CRON` in `.env`,
  default 9am on the 1st of each month) generates and emails that month's
  payslip for every employee with a pay profile.
- **Daily checklist digest**: a second scheduled job (`CHECKLIST_DIGEST_CRON`,
  default 8am daily) emails each staff member their currently open tasks.

### Setting up Gmail sending

1. On the Gmail account to send from: Google Account → Security → 2-Step
   Verification (must be on) → App Passwords → create one for "Mail".
2. Add `GMAIL_USER=...` and `GMAIL_APP_PASSWORD=<16-char password>` to
   `backend/.env` (not your normal Gmail password).
3. Restart the backend. Without this, everything still works — the app just
   says plainly that emailing isn't configured yet.
4. Add an email address for each staff member via the "Staff" screen in the admin sidebar.

### Manual triggers (test without waiting for the schedule)
"Payroll → Run this month's payroll for everyone" in the admin UI, or
`POST /api/jobs/run-monthly-payroll` / `POST /api/jobs/run-checklist-digest`.

## 10. Migrating content from the Google Site

The current site (sites.google.com/drnishitaranka.com/work-hub) has per-department and
per-person checklists (Front Desk, Pharmacy, Therapist, 3rd Floor, Doctor EA, etc.),
plus Policies, HR, and Reports pages. Suggested order:

1. Copy each department's checklist items into `backend/src/seed.js` as a starting
   template (there's a `checklist_templates` table ready for this — currently unused
   by the API, wire it into an admin "assign from template" dropdown next).
2. Policies/SOPs/HR content that's static (not task-tracking) can stay as simple pages
   in the frontend, or continue living on the Google Site linked from the app's nav —
   no need to migrate everything at once.
3. Once admin is comfortable assigning tasks and staff are replying on WhatsApp
   reliably, retire the old checklist pages on the Google Site.

---

## 11. What's real vs. what's a next step

**Working end-to-end right now** (tested in this build): admin login, staff PIN login,
task creation, task list scoped by role, manual status updates, the WhatsApp webhook
correctly parsing an inbound reply and flipping task status + logging the event trail.

**Needs your Meta credentials to go live**: actually sending the WhatsApp template
message (code is complete in `whatsapp.js`, just needs real `WHATSAPP_ACCESS_TOKEN` etc).

**Reasonable next additions**: checklist templates you can assign in one click instead
of typing a task from scratch each time; recurring daily tasks (e.g. "open pharmacy
register" every morning) via `node-cron`, already a dependency; a reports/export view
for month-end review; SMS fallback for staff without WhatsApp.
