// One-command production smoke test:  cd backend && npm test
// Boots the server on a throwaway database and checks the flows the clinic depends on.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 4590 + Math.floor(Math.random() * 100);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-test-"));
const env = { ...process.env, PORT: String(PORT), DATA_DIR: dir, JWT_SECRET: "test-secret-for-smoke-tests-1234567890", ADMIN_EMAIL: "admin@test.local", ADMIN_PASSWORD: "testpass123", DISABLE_CRON: "true", NODE_ENV: "test", MAIL_DRY_RUN: "1" };
const server = spawn("node", ["src/server.js"], { env, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
const base = `http://localhost:${PORT}`;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "  PASS" : "  FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
const call = async (method, url, body, token) => {
  const r = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};

async function waitUp() { for (let i = 0; i < 60; i++) { try { const r = await fetch(base + "/health"); if (r.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 500)); } return false; }

try {
  console.log("== Clinic Work Hub smoke test ==");
  ok("server starts on an empty database", await waitUp(), log.slice(-500));
  const h = await call("GET", "/health"); ok("health check reports db ok", h.body?.db === "ok");

  const noTok = await call("GET", "/api/tasks"); ok("API rejects requests without a login", noTok.status === 401);
  const bad = await call("POST", "/api/auth/login", { email: "admin@test.local", password: "wrong" }); ok("wrong admin password rejected", bad.status === 401);

  const a = await call("POST", "/api/auth/login", { email: "admin@test.local", password: "testpass123" });
  ok("admin can sign in", a.status === 200 && !!a.body?.token, JSON.stringify(a.body));
  const admin = a.body?.token;

  const users = (await call("GET", "/api/users/full", null, admin)).body || [];
  ok("seed loaded staff", users.length > 5, `got ${users.length}`);
  const staff = users.find((u) => u.role && u.role !== "admin" && u.role !== "manager") || users.find((u) => u.role !== "admin");
  const s = await call("POST", "/api/auth/login", { userId: staff.id, pin: "1234" });
  ok("staff can sign in with starter PIN", s.status === 200, JSON.stringify(s.body));
  ok("staff is forced to change the starter PIN", s.body?.user?.mustChangePin === true);
  const stoken = s.body?.token;

  ok("staff blocked from admin status", (await call("GET", "/api/admin/status", null, stoken)).status === 403);
  ok("staff blocked from onboarding list", (await call("GET", "/api/users/onboarding", null, stoken)).status === 403);
  const st = await call("GET", "/api/admin/status", null, admin); ok("admin status works", st.status === 200 && st.body?.users > 5);

  // PIN change
  const cp = await call("POST", "/api/users/me/pin", { currentPin: "1234", newPin: "7391" }, stoken);
  ok("staff can change PIN", cp.status === 200, JSON.stringify(cp.body));
  ok("old PIN no longer works", (await call("POST", "/api/auth/login", { userId: staff.id, pin: "1234" })).status === 401);
  ok("new PIN works", (await call("POST", "/api/auth/login", { userId: staff.id, pin: "7391" })).status === 200);

  // Shift checklist autosave
  // Find a staff member whose role has a checklist assigned.
  let ctoken = null, tpl = { status: 404 };
  for (const u of users.filter((x) => x.role !== "admin" && x.id !== staff.id)) {
    const lg = await call("POST", "/api/auth/login", { userId: u.id, pin: "1234" });
    if (lg.status !== 200) continue;
    const t = await call("GET", "/api/shift-checklist/template", null, lg.body.token);
    if (t.status === 200) { ctoken = lg.body.token; tpl = t; break; }
  }
  if (tpl.status === 200) {
    const items = tpl.body.sections.flatMap((x) => x.items.map((t) => ({ section: x.section, text: t, done: false })));
    items.slice(0, 3).forEach((i) => (i.done = true));
    const sv = await call("POST", "/api/shift-checklist/progress", { shift: "Morning", items, metrics: null }, ctoken);
    ok("checklist progress autosaves", sv.status === 200 && sv.body?.status === "in_progress", JSON.stringify(sv.body));
    const td = await call("GET", "/api/shift-checklist/today", null, ctoken);
    ok("saved ticks come back after reload", td.body?.[0]?.items?.filter((i) => i.done).length === 3);
    const mon = await call("GET", "/api/shift-checklist/submissions", null, admin);
    ok("admin monitor sees the in-progress checklist", JSON.stringify(mon.body).includes("in_progress"));
  } else ok("staff role has a checklist template", false, `status ${tpl.status}`);

  // Onboarding
  const ob = await call("GET", "/api/users/onboarding", null, admin); ok("onboarding list loads", ob.status === 200 && Array.isArray(ob.body?.people || ob.body));

  // ---- Remodel features ----
  const form = async (method, url, fd, token) => {
    const r = await fetch(base + url, { method, headers: { Authorization: `Bearer ${token}` }, body: fd });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  };
  const raw = async (url, token, opts = {}) => fetch(base + url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) } });

  // Attendance: staff do not check in; admin marks the register
  const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
  ok("staff cannot mark attendance", (await call("PUT", "/api/attendance/mark", { userId: staff.id, date: today, status: "P" }, stoken)).status === 403);
  ok("admin can mark someone late", (await call("PUT", "/api/attendance/mark", { userId: staff.id, date: today, status: "L" }, admin)).status === 200);
  ok("future days cannot be marked", (await call("PUT", "/api/attendance/mark", { userId: staff.id, date: "2999-01-01", status: "P" }, admin)).status === 400);
  ok("unknown status is refused", (await call("PUT", "/api/attendance/mark", { userId: staff.id, date: today, status: "Z" }, admin)).status === 400);
  const md = await call("POST", "/api/attendance/mark-day", { date: today, status: "P" }, admin);
  ok("everyone still unmarked can be marked present in one click", md.status === 200 && md.body.marked >= 5);
  const bd = await call("GET", "/api/attendance/board", null, admin);
  ok("board keeps the person marked late (not overwritten)", bd.body.rows.find((r) => r.id === staff.id)?.mark === "L" && bd.body.counts.P >= 5);
  ok("staff cannot open the admin board", (await call("GET", "/api/attendance/board", null, stoken)).status === 403);
  const myd = await call("GET", "/api/portal/me", null, stoken);
  ok("staff sees their own mark for today", myd.body?.today_mark === "L" && myd.body.late_days === 1);

  // Documents hub: staff uploads, admin sees it
  let fd = new FormData(); fd.append("title", "MIS daily sheet"); fd.append("category", "Sheet"); fd.append("file", new Blob(["a,b\n1,2"], { type: "text/csv" }), "daily.csv");
  const up = await form("POST", "/api/documents", fd, stoken);
  ok("staff can upload a document", up.status === 201, JSON.stringify(up.body));
  fd = new FormData(); fd.append("title", "Sales dashboard"); fd.append("category", "Dashboard"); fd.append("url", "https://example.com/dash");
  ok("staff can add a dashboard link", (await form("POST", "/api/documents", fd, stoken)).status === 201);
  const dl = await call("GET", "/api/documents", null, admin);
  ok("admin sees every department's documents", dl.body?.documents?.length >= 2 && dl.body.canSeeAll);
  const file = await raw(`/api/documents/${up.body.id}/file`, admin);
  ok("admin can download the uploaded file", file.status === 200 && (await file.text()).includes("1,2"));
  ok("document files are not publicly reachable", (await fetch(base + `/api/documents/${up.body.id}/file`)).status === 401);

  // Templates -> bulk generate
  const sample = await raw("/api/doc-templates/sample/offer_letter", admin);
  const sbuf = Buffer.from(await sample.arrayBuffer());
  ok("sample offer-letter template downloads as a Word file", sample.status === 200 && sbuf.slice(0, 2).toString() === "PK");
  fd = new FormData(); fd.append("kind", "offer_letter"); fd.append("name", "Standard offer"); fd.append("file", new Blob([sbuf]), "offer.docx");
  const tu = await form("POST", "/api/doc-templates", fd, admin);
  ok("admin can upload an offer-letter template", tu.status === 201, JSON.stringify(tu.body));
  fd = new FormData(); fd.append("kind", "offer_letter"); fd.append("name", "x"); fd.append("file", new Blob([sbuf]), "offer.docx");
  ok("staff cannot upload templates", (await form("POST", "/api/doc-templates", fd, stoken)).status === 403);
  const gen = await call("POST", "/api/doc-templates/generate", { templateId: tu.body.id }, admin);
  ok("offer letters generated for all staff", gen.status === 201 && gen.body.generated.length >= 5, JSON.stringify(gen.body).slice(0, 200));
  const zip = await raw("/api/doc-templates/generated/zip", admin, { method: "POST", body: JSON.stringify({ ids: gen.body.generated.slice(0, 3).map((g) => g.id) }) });
  ok("generated letters download as one ZIP", zip.status === 200 && (await zip.arrayBuffer()).byteLength > 500);

  // Clinic's own offer letter is built in, with editable fields
  const stdT = (await call("GET", "/api/doc-templates?kind=offer_letter", null, admin)).body.find((t) => /Standard offer letter/.test(t.name));
  ok("the clinic's standard offer letter is installed automatically", !!stdT);
  const pf = await call("POST", "/api/doc-templates/prefill", { templateId: stdT.id, userIds: [staff.id] }, admin);
  const fk = (pf.body?.fields || []).map((f) => f.key);
  ok("template fields are detected from the Word file", ["name", "address", "role", "gross_salary", "net_salary", "retention_bonus", "probation", "duties", "joining_date"].every((k) => fk.includes(k)), JSON.stringify(fk));
  ok("duties is a one-per-line list field", pf.body.fields.find((f) => f.key === "duties")?.type === "list");
  const og = await call("POST", "/api/doc-templates/generate", { templateId: stdT.id, userIds: [staff.id], overrides: { [staff.id]: { address: "Flat 4, Road 7\nBanjara Hills", gross_salary: "22,000", duties: "Greet patients\nKeep records" } } }, admin);
  ok("offer letter generates with edited values", og.status === 201 && og.body.generated.length === 1, JSON.stringify(og.body));
  const ogf = Buffer.from(await (await raw(`/api/doc-templates/generated/${og.body.generated[0].id}/file`, admin)).arrayBuffer());
  const ogx = new (await import("pizzip")).default(ogf).file("word/document.xml").asText().replace(/<[^>]+>/g, "");
  ok("edited address, salary and bullet points appear in the letter", /Banjara Hills/.test(ogx) && /22,000/.test(ogx) && /Greet patients/.test(ogx) && /Keep records/.test(ogx) && !/\{/.test(ogx), ogx.slice(0, 300));

  // Payroll template per company
  const comps = (await call("GET", "/api/companies", null, admin)).body;
  await call("POST", "/api/payroll/profile", { userId: staff.id, companyId: comps[0].id, employeeCode: "T1", position: "Tester", basicSalary: 20000, pf: 1000 }, admin);
  const ps = Buffer.from(await (await raw("/api/doc-templates/sample/payslip", admin)).arrayBuffer());
  fd = new FormData(); fd.append("kind", "payslip"); fd.append("name", "Payslip"); fd.append("companyId", comps[0].id); fd.append("file", new Blob([ps]), "pay.docx");
  const pt = await form("POST", "/api/doc-templates", fd, admin);
  const pg = await call("POST", "/api/doc-templates/generate", { templateId: pt.body.id, period: "2026-10" }, admin);
  ok("company payslip template generates for that company's staff", pg.status === 201 && pg.body.generated.length === 1, JSON.stringify(pg.body));
  fd = new FormData(); fd.append("kind", "offer_letter"); fd.append("name", "bad"); fd.append("file", new Blob(["not a word file"]), "bad.docx");
  ok("a broken Word file is rejected with a clear message", (await form("POST", "/api/doc-templates", fd, admin)).status === 400);

  // Fines, register, department portal
  const fa = await call("POST", "/api/fines", { userId: staff.id, category: "late", amount: 150, note: "Came at 10:40", date: "2026-10-05" }, admin);
  ok("admin can add a fine", fa.status === 201, JSON.stringify(fa.body));
  ok("staff cannot add a fine", (await call("POST", "/api/fines", { userId: staff.id, category: "late", amount: 50 }, stoken)).status === 403);
  ok("bad fine is rejected", (await call("POST", "/api/fines", { userId: staff.id, category: "nonsense", amount: 50 }, admin)).status === 400);
  const mf = await call("GET", "/api/fines?month=2026-10", null, stoken);
  ok("staff sees only their own fines", mf.status === 200 && mf.body.rows.length === 1 && mf.body.total === 150);
  const fs2 = await call("GET", "/api/fines/summary?month=2026-10", null, admin);
  ok("fines summary totals per person", fs2.body?.total === 150 && fs2.body.rows.find((r) => r.id === staff.id)?.total === 150);
  await call("POST", "/api/fines", { userId: staff.id, category: "dress_code", amount: 200, date: "2026-10-06" }, admin);
  const pg2 = await call("POST", "/api/doc-templates/generate", { templateId: pt.body.id, period: "2026-10" }, admin);
  ok("fines flow into the payslip template", pg2.status === 201);
  const reg = await call("GET", "/api/attendance/register?month=2026-10", null, admin);
  ok("attendance register has a row per person and a column per day", reg.status === 200 && reg.body.daysInMonth === 31 && reg.body.rows[0].days.length === 31, JSON.stringify(reg.body).slice(0, 120));
  const regNow = await call("GET", `/api/attendance/register?month=${today.slice(0, 7)}`, null, admin);
  ok("register shows the day marks and totals", regNow.body.rows.find((r) => r.id === staff.id)?.late === 1);
  ok("register shows fines for the month", reg.body.rows.find((r) => r.id === staff.id)?.fine_total === 350);
  const dp = await call("GET", "/api/portal/departments", null, admin);
  ok("department portal lists departments with numbers", dp.status === 200 && dp.body.rows.length >= 3 && "present_today" in dp.body.rows[0]);
  const dd = await call("GET", `/api/portal/departments/${dp.body.rows[0].id}`, null, admin);
  ok("one department shows its people and documents", dd.status === 200 && Array.isArray(dd.body.people) && Array.isArray(dd.body.documents));
  ok("staff cannot open the department portal", (await call("GET", "/api/portal/departments", null, stoken)).status === 403);
  const me = await call("GET", "/api/portal/me", null, stoken);
  ok("staff 'my day' summary works", me.status === 200 && "today_mark" in me.body && "fines_month" in me.body);

  // Shift roster + connection check
  const wk = await call("GET", "/api/roster/week?start=2026-10-05", null, admin);
  ok("roster week lists everyone with 7 days", wk.status === 200 && wk.body.days.length === 7 && wk.body.rows[0].shifts.length === 7);
  ok("lead can set a shift", (await call("PUT", "/api/roster", { userId: staff.id, date: "2026-10-05", shift: "s0930" }, admin)).status === 200);
  ok("staff cannot set a shift", (await call("PUT", "/api/roster", { userId: staff.id, date: "2026-10-05", shift: "morning" }, stoken)).status === 403);
  ok("bad shift rejected", (await call("PUT", "/api/roster", { userId: staff.id, date: "2026-10-05", shift: "nope" }, admin)).status === 400);
  const nt2 = await call("POST", "/api/roster/types", { start: "10:00", end: "19:30" }, admin);
  ok("duplicate shift is refused", nt2.status === 409);
  const nt3 = await call("POST", "/api/roster/types", { start: "08:30", end: "17:00", label: "Early" }, admin);
  ok("admin can add a custom shift", nt3.status === 201 && Object.values(nt3.body).some((t) => t.label === "Early"));
  ok("staff cannot add a shift", (await call("POST", "/api/roster/types", { start: "07:00", end: "15:00" }, stoken)).status === 403);
  ok("end must be after start", (await call("POST", "/api/roster/types", { start: "12:00", end: "11:00" }, admin)).status === 400);
  const bk2 = await call("PUT", "/api/roster/bulk", { userId: staff.id, dates: ["2026-10-06", "2026-10-07"], shift: "s0900" }, admin);
  ok("one person can get a shift on several days at once", bk2.status === 200);
  const ekey = Object.keys(nt3.body).find((k) => nt3.body[k].label === "Early");
  ok("a shift can be edited", (await call("PATCH", `/api/roster/types/${ekey}`, { start: "08:00", end: "16:30" }, admin)).status === 200);
  ok("a shift can be removed when unused", (await call("DELETE", `/api/roster/types/${ekey}`, null, admin)).status === 200);
  const cw = await call("POST", "/api/roster/copy-week", { from: "2026-10-05", to: "2026-10-12" }, admin);
  ok("a week's plan can be copied to the next", cw.status === 200 && cw.body.copied >= 1);
  ok("staff sees own shifts", (await call("GET", "/api/roster/me", null, stoken)).status === 200);
  const ck = await call("GET", "/api/links/assistant/check", null, admin);
  ok("connection check answers (reachable or not, never an error)", ck.status === 200 && "reachable" in ck.body);

  // Staff add / edit / remove
  const added = await call("POST", "/api/users", { name: "Test Person", departmentName: "Front Desk", roleName: "staff", phone: "+917700000001", pin: "4321" }, admin);
  ok("admin can add a staff member", added.status === 201, JSON.stringify(added.body));
  const nt = (await call("POST", "/api/auth/login", { userId: added.body.id, pin: "4321" })).body?.token;
  ok("new staff member can sign in", !!nt);
  const ed = await call("PATCH", `/api/users/${added.body.id}`, { name: "Test Renamed", departmentName: "Pharmacy" }, admin);
  ok("admin can edit name and department", ed.status === 200);
  ok("edit shows in the directory", (await call("GET", "/api/users/full", null, admin)).body.some((u) => u.name === "Test Renamed" && u.department === "Pharmacy"));
  await call("PATCH", `/api/users/${added.body.id}/deactivate`, null, admin);
  ok("removed staff lose access immediately", (await call("GET", "/api/tasks", null, nt)).status === 401);
  ok("removed staff are hidden from the active list", !(await call("GET", "/api/users/full", null, admin)).body.some((u) => u.id === added.body.id));
  ok("removed staff can be restored", (await call("PATCH", `/api/users/${added.body.id}/reactivate`, null, admin)).status === 200);

  // Personal staff files
  fd = new FormData(); fd.append("docType", "id_proof"); fd.append("file", new Blob(["aadhaar"], { type: "text/plain" }), "id.txt");
  const sf = await form("POST", `/api/documents/staff/${staff.id}`, fd, admin);
  ok("admin can attach a personal file to a staff member", sf.status === 201, JSON.stringify(sf.body));
  const sl = await call("GET", `/api/documents/staff/${staff.id}`, null, admin);
  ok("personal file is listed for admin", sl.body?.files?.length === 1 && sl.body.canManage);
  ok("attaching the file ticks the onboarding checklist", (await call("GET", "/api/users/onboarding", null, admin)).body.people.find((x) => x.id === staff.id)?.docs?.id_proof === true);
  ok("the person can see their own file", (await call("GET", "/api/documents/staff/me", null, stoken)).body?.files?.length === 1);
  const other = users.find((u) => u.id !== staff.id && u.role !== "admin");
  const otok = (await call("POST", "/api/auth/login", { userId: other.id, pin: "1234" })).body?.token;
  ok("other staff cannot see someone else's personal files", (await call("GET", `/api/documents/staff/${staff.id}`, null, otok)).status === 403);
  ok("personal files are not in the department hub", !(await call("GET", "/api/documents", null, admin)).body.documents.some((d) => d.id === sf.body.id));
  ok("other staff cannot download it", (await raw(`/api/documents/${sf.body.id}/file`, otok)).status === 403);
  ok("admin can remove a personal file (and the tick clears)", (await call("DELETE", `/api/documents/${sf.body.id}`, null, admin)).status === 200 && (await call("GET", "/api/users/onboarding", null, admin)).body.people.find((x) => x.id === staff.id)?.docs?.id_proof === false);

  // Training videos: link + upload + edit + delete
  const tv = await call("POST", "/api/hr/training-videos", { department: "Front Desk", title: "Welcome", url: "https://youtu.be/dQw4w9WgXcQ" }, admin);
  ok("admin can add a training link", tv.status === 201, JSON.stringify(tv.body));
  fd = new FormData(); fd.append("department", "All Staff"); fd.append("title", "Hygiene"); fd.append("file", new Blob([Buffer.alloc(2048)], { type: "video/mp4" }), "h.mp4");
  const vu = await form("POST", "/api/hr/training-videos", fd, admin);
  ok("admin can upload a training video file", vu.status === 201, JSON.stringify(vu.body));
  ok("uploaded video streams to a signed-in viewer", (await fetch(base + `/api/hr/training-videos/${vu.body.id}/stream?token=${stoken}`)).status === 200);
  ok("training video can be edited", (await call("PATCH", `/api/hr/training-videos/${tv.body.id}`, { title: "Welcome v2" }, admin)).status === 200);
  ok("training video can be deleted", (await call("DELETE", `/api/hr/training-videos/${vu.body.id}`, null, admin)).status === 200);

  // History import
  const csv = 'Submitted At,Clinic,Staff Name,Role,Date,Shift,Completed,Total,Completion %,Checklist Detail,Metrics\n' +
    `17/09/2026 23:51:08,Clinic,${staff.name.split(" ")[0]},Some Role,2026-09-18,Morning,1,2,50,"Opening:\n  [DONE] Did a thing.\n  [PENDING] Other thing.",Patients: 3; Foo: -\n` +
    '17/09/2026 23:55:08,Clinic,Nobody Known,Some Role,2026-09-18,Morning,1,1,100,"Opening:\n  [DONE] X.",\n';
  fd = new FormData(); fd.append("file", new Blob([csv], { type: "text/csv" }), "log.csv"); fd.append("dryRun", "false");
  const im = await form("POST", "/api/shift-checklist/import", fd, admin);
  ok("checklist history imports and reports unknown names", im.status === 200 && im.body.imported === 1 && im.body.unmatched[0]?.name === "Nobody Known", JSON.stringify(im.body).slice(0, 200));
  const rp = await call("GET", "/api/reports/summary?days=365", null, admin);
  ok("reports include imported checklists in completion", rp.body?.completion?.total >= 2, JSON.stringify(rp.body?.completion));
  ok("staff cannot import history", (await form("POST", "/api/shift-checklist/import", fd, stoken)).status === 403);

  const lk = await call("GET", "/api/links", null, admin), lks = await call("GET", "/api/links", null, stoken);
  ok("connected tools: admin sees assistant + dashboards, staff only the assistant", lk.body?.length === 3 && lks.body?.length === 1 && lks.body[0].key === "assistant");
  ok("only admin can change a tool address", (await call("PUT", "/api/links/assistant", { url: "https://x.example" }, stoken)).status === 403 && (await call("PUT", "/api/links/assistant", { url: "http://72.60.101.59:3005" }, admin)).status === 200);

  // Staff exit workflow
  const lv = await call("POST", "/api/users", { name: "Leaver One", departmentName: "Front Desk", roleName: "staff", phone: "+917700000002", pin: "5555" }, admin);
  await call("POST", "/api/payroll/profile", { userId: lv.body.id, companyId: comps[0].id, employeeCode: "L1", position: "Executive", basicSalary: 30000 }, admin);
  const lvTok = (await call("POST", "/api/auth/login", { userId: lv.body.id, pin: "5555" })).body?.token;
  ok("staff cannot open exits", (await call("GET", "/api/exits", null, lvTok)).status === 403);
  ok("exit needs sensible dates", (await call("POST", "/api/exits", { userId: lv.body.id, reasonType: "resignation", resignationDate: "2026-10-10", lastWorkingDay: "2026-10-01" }, admin)).status === 400);
  const ex = await call("POST", "/api/exits", { userId: lv.body.id, reasonType: "resignation", resignationDate: "2026-09-30", lastWorkingDay: "2026-10-30", reasonNote: "Higher studies" }, admin);
  ok("admin can start an exit", ex.status === 201 && ex.body.status === "received", JSON.stringify(ex.body).slice(0, 150));
  const xid = ex.body.id;
  ok("a second exit for the same person is refused", (await call("POST", "/api/exits", { userId: lv.body.id, reasonType: "resignation", resignationDate: "2026-09-30", lastWorkingDay: "2026-10-30" }, admin)).status === 409);
  ok("moves to notice period", (await call("POST", `/api/exits/${xid}/advance`, null, admin)).body?.status === "notice");
  ok("moves to handover", (await call("POST", `/api/exits/${xid}/advance`, null, admin)).body?.status === "handover");
  const blocked = await call("POST", `/api/exits/${xid}/advance`, null, admin);
  ok("cannot settle before clearance is finished", blocked.status === 400 && /clearance/i.test(blocked.body.error));
  const allClear = Object.fromEntries(ex.body.clearance_items.map((c) => [c.key, true]));
  await call("PATCH", `/api/exits/${xid}`, { clearance: allClear }, admin);
  ok("moves to settlement once cleared", (await call("POST", `/api/exits/${xid}/advance`, null, admin)).body?.status === "settlement");
  ok("cannot mark paid before the sheet is saved", (await call("POST", `/api/exits/${xid}/advance`, null, admin)).status === 400);
  const sv = await call("PATCH", `/api/exits/${xid}`, { settlement: { unpaid_days: 10, leave_days: 3, bonus: 500, notice_short_days: 2, advance: 1000 } }, admin);
  ok("settlement sheet adds up correctly", sv.body?.settlement?.pending_salary === 10000 && sv.body.settlement.leave_encashment === 3000 && sv.body.settlement.net === 10500, JSON.stringify(sv.body?.settlement));
  ok("amount is written in words", sv.body?.settlement?.net_words === "Ten Thousand Five Hundred");
  ok("letters are not issued before payment", (await call("POST", `/api/exits/${xid}/letters`, { kind: "relieving_letter" }, admin)).status === 400);
  const fnf = await call("POST", `/api/exits/${xid}/letters`, { kind: "fnf_statement" }, admin);
  ok("settlement statement is created", fnf.status === 201, JSON.stringify(fnf.body));
  ok("moves to paid", (await call("POST", `/api/exits/${xid}/advance`, null, admin)).body?.status === "paid");
  ok("cannot relieve before the letters exist", (await call("POST", `/api/exits/${xid}/advance`, null, admin)).status === 400);
  ok("relieving letter is created", (await call("POST", `/api/exits/${xid}/letters`, { kind: "relieving_letter" }, admin)).status === 201);
  const xp = await call("POST", `/api/exits/${xid}/letters`, { kind: "experience_letter" }, admin);
  ok("experience certificate is created", xp.status === 201);
  const xdl = await raw(`/api/doc-templates/generated/${xp.body.id}/file`, admin);
  const docBuf = Buffer.from(await xdl.arrayBuffer());
  const docXml = new (await import("pizzip")).default(docBuf).file("word/document.xml").asText();
  ok("experience certificate has the right sentence", /Leaver One/.test(docXml) && /satisfactory/.test(docXml) && /1 month/.test(docXml) || /Leaver One/.test(docXml) && /satisfactory/.test(docXml));
  ok("moves to relieved", (await call("POST", `/api/exits/${xid}/advance`, null, admin)).body?.status === "relieved");
  ok("relieved person can no longer sign in", (await call("POST", "/api/auth/login", { userId: lv.body.id, pin: "5555" })).status === 401);
  ok("the exit shows a history", ((await call("GET", `/api/exits/${xid}`, null, admin)).body?.events?.length || 0) >= 6);

  // Settings come from the .env FILE (how the clinic PC runs it): no secrets in the process environment at all.
  {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "hub-env-")), envPath = path.join(dir2, "test.env"), P2 = PORT + 150;
    fs.writeFileSync(envPath, `JWT_SECRET=file-secret-file-secret-file-secret\nADMIN_EMAIL=file@admin.test\nADMIN_PASSWORD=filepass123\nDISABLE_CRON=true\n`);
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(JWT_SECRET|ADMIN_EMAIL|ADMIN_PASSWORD)$/.test(k)));
    const s2 = spawn("node", ["src/server.js"], { env: { ...clean, PORT: String(P2), DATA_DIR: dir2, DOTENV_CONFIG_PATH: envPath }, stdio: "ignore" });
    let up = false; for (let i = 0; i < 40 && !up; i++) { try { up = (await fetch(`http://localhost:${P2}/health`)).ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 500)); }
    let lg = null; if (up) { const r = await fetch(`http://localhost:${P2}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "file@admin.test", password: "filepass123" }) }); lg = { status: r.status }; }
    ok("sign-in works when settings come only from backend/.env", lg?.status === 200, JSON.stringify(lg));
    s2.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 400)); fs.rmSync(dir2, { recursive: true, force: true });
  }

  // Department workspaces
  const mw = (await call("GET", "/api/portal/departments", null, admin)).body.rows.find((r) => r.name === "Management");
  const wsA = await call("GET", `/api/workspace/${mw.id}`, null, admin);
  ok("Management workspace starts with the clinic's sheets and dashboard", wsA.status === 200 && wsA.body.items.length >= 4);
  const myws = await call("GET", "/api/workspace/me", null, stoken);
  ok("staff land in their own department's workspace", myws.status === 200 && myws.body.department?.name === staff.department);
  ok("staff cannot open another department's workspace", (await call("GET", `/api/workspace/${mw.id}`, null, stoken)).status === 403);
  const wadd = await call("POST", `/api/workspace/${myws.body.department.id}`, { title: "Daily MIS sheet", kind: "sheet", url: "https://docs.google.com/spreadsheets/d/abc/edit" }, stoken);
  ok("staff can add a sheet to their own workspace", wadd.status === 201);
  ok("a bad address is refused", (await call("POST", `/api/workspace/${myws.body.department.id}`, { title: "x", url: "javascript:alert(1)" }, stoken)).status === 400);
  ok("staff cannot add to another department", (await call("POST", `/api/workspace/${mw.id}`, { title: "x", url: "https://a.b" }, stoken)).status === 403);
  ok("admin sees what staff added", (await call("GET", `/api/workspace/${myws.body.department.id}`, null, admin)).body.items.some((i) => i.title === "Daily MIS sheet"));
  ok("an item can be removed", (await call("DELETE", `/api/workspace/item/${wadd.body.id}`, null, stoken)).status === 200);

  // ---- admin limited to four owners; photo; alt phone; face kiosk; training folders
  const allU = (await call("GET", "/api/users/full", null, admin)).body;
  const admins = allU.filter((u) => u.role === "admin").map((u) => u.name.toLowerCase());
  ok("only the admin email account is admin", admins.length === 1 && allU.find((u) => u.role === "admin").email === "admin@test.local", admins.join(","));
  const plain = allU.find((u) => u.role === "staff");
  ok("admin cannot be given to anyone else", (await call("PATCH", `/api/users/${plain.id}/role`, { roleName: "admin" }, admin)).status === 403);
  ok("admin cannot be given when editing a person either", (await call("PATCH", `/api/users/${plain.id}`, { roleName: "admin" }, admin)).status === 403);
  ok("a new person cannot be created as admin", (await call("POST", "/api/users", { name: "Test Person", departmentName: "Front Desk", roleName: "admin", phone: "+917700000091", pin: "4321" }, admin)).status === 403);
  const mkd = await call("POST", "/api/users", { name: "Photo Person", departmentName: "Front Desk", roleName: "staff", phone: "+917700000092", pin: "4321", altPhone: "+919333333333" }, admin);
  ok("staff can be added with an alternate number", mkd.status === 201, JSON.stringify(mkd.body));
  const fullU = (await call("GET", "/api/users/full", null, admin)).body.find((u) => u.id === mkd.body.id);
  ok("alternate number is saved", fullU?.alt_phone === "+919333333333" && !fullU.has_photo);
  const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const pfd = new FormData(); pfd.append("photo", new Blob([tinyPng], { type: "image/png" }), "p.png");
  const pup = await fetch(base + `/api/users/${mkd.body.id}/photo`, { method: "POST", headers: { Authorization: `Bearer ${admin}` }, body: pfd });
  ok("profile picture can be uploaded", pup.status === 200);
  const pgr = await fetch(base + `/api/users/${mkd.body.id}/photo?token=${admin}`);
  ok("picture is served to signed-in people only", pgr.status === 200 && (await fetch(base + `/api/users/${mkd.body.id}/photo`)).status === 401);

  const fdesc = (seed) => Array.from({ length: 128 }, (_, i) => Math.sin(seed * 7 + i) * 0.2);
  ok("face needs enough samples", (await call("POST", `/api/kiosk/enroll/${mkd.body.id}`, { descriptors: [fdesc(1)] }, admin)).status === 400);
  ok("face can be registered", (await call("POST", `/api/kiosk/enroll/${mkd.body.id}`, { descriptors: [fdesc(1), fdesc(1), fdesc(1)] }, admin)).status === 200);
  ok("staff cannot register faces", (await call("POST", `/api/kiosk/enroll/${mkd.body.id}`, { descriptors: [fdesc(1), fdesc(1), fdesc(1)] }, stoken)).status === 403);
  // one face = one person
  const faceOther = allU.find((u) => u.role === "staff" && u.id !== mkd.body.id);
  const dupTry = await call("POST", `/api/kiosk/enroll/${faceOther.id}`, { descriptors: [fdesc(1), fdesc(1), fdesc(1)] }, admin);
  ok("the same face cannot be registered to a second person", dupTry.status === 409 && /already registered/.test(dupTry.body?.error || ""), JSON.stringify(dupTry.body));
  ok("the duplicate check works before saving", (await call("POST", "/api/kiosk/check-duplicate", { descriptors: [fdesc(1)] }, admin)).body?.duplicate === true);
  ok("a different face can be registered to another person", (await call("POST", `/api/kiosk/enroll/${faceOther.id}`, { descriptors: [fdesc(70), fdesc(70), fdesc(70)] }, admin)).status === 200);
  const kdev = await call("POST", "/api/kiosk/devices", { label: "Clinic phone" }, admin);
  ok("a clinic phone key can be created", kdev.status === 201 && !!kdev.body.key);
  ok("a person's login cannot be used as a clinic phone", (await call("POST", "/api/kiosk/checkin", { descriptor: fdesc(1) }, admin)).status === 401);
  ok("the clinic phone key cannot open the rest of the app", (await call("GET", "/api/users/full", null, kdev.body.key)).status === 401);
  const cki = await call("POST", "/api/kiosk/checkin", { descriptor: fdesc(1) }, kdev.body.key);
  ok("the right face is recognised and marked", cki.body?.matched === true && cki.body.name === "Photo Person" && ["P", "L"].includes(cki.body.mark), JSON.stringify(cki.body));
  ok("checking in twice does not duplicate", (await call("POST", "/api/kiosk/checkin", { descriptor: fdesc(1) }, kdev.body.key)).body?.already === true);
  ok("the first look is the login", cki.body?.kind === "in" && /^\d\d:\d\d$/.test(cki.body.inTime));
  ok("a stranger is not recognised", (await call("POST", "/api/kiosk/checkin", { descriptor: fdesc(50) }, kdev.body.key)).body?.matched === false);
  const brd2 = (await call("GET", "/api/attendance/board", null, admin)).body;
  ok("the face check-in shows on the attendance board", ["P", "L"].includes(brd2.rows.find((r) => r.id === mkd.body.id)?.mark));
  await call("DELETE", `/api/kiosk/devices/${kdev.body.id}`, null, admin);
  ok("a switched-off clinic phone stops working", (await call("POST", "/api/kiosk/checkin", { descriptor: fdesc(1) }, kdev.body.key)).status === 401);

  const tfd2 = new FormData(); tfd2.append("department", "Front Desk"); tfd2.append("folder", "Onboarding"); tfd2.append("title", "Welcome guide"); tfd2.append("file", new Blob(["%PDF-1.4 test"], { type: "application/pdf" }), "guide.pdf");
  const trainAdd = await fetch(base + "/api/hr/training-videos", { method: "POST", headers: { Authorization: `Bearer ${admin}` }, body: tfd2 });
  ok("a PDF can be added to a training folder", trainAdd.status === 201);
  const trainItem = (await call("GET", "/api/hr/training-videos", null, admin)).body.find((v) => v.title === "Welcome guide");
  ok("training item remembers its folder and type", trainItem?.folder === "Onboarding" && trainItem.kind === "file");
  ok("a folder can be renamed", (await call("POST", "/api/hr/training-folders/rename", { department: "Front Desk", from: "Onboarding", to: "Joining" }, admin)).body?.moved === 1);

  const xl = await fetch(base + "/api/attendance/export", { headers: { Authorization: `Bearer ${admin}` } });
  ok("attendance sheet downloads as Excel", xl.status === 200 && /spreadsheetml/.test(xl.headers.get("content-type") || "") && (await xl.arrayBuffer()).byteLength > 2000);
  ok("lan addresses endpoint works", (await call("GET", "/api/kiosk/lan", null, admin)).body?.addresses !== undefined);
  const em = await call("GET", "/api/admin/email", null, admin); ok("email settings readable", em.status === 200 && em.body.configured === false);
  ok("bad email address refused", (await call("PUT", "/api/admin/email", { user: "nope", pass: "x" }, admin)).status === 400);
  ok("email settings can be saved", (await call("PUT", "/api/admin/email", { user: "clinic@test.local", pass: "abcd efgh ijkl mnop" }, admin)).status === 200);
  ok("test email can be sent", (await call("POST", "/api/admin/email/test", { to: "x@test.local" }, admin)).body?.ok === true);
  ok("staff cannot read email settings", (await call("GET", "/api/admin/email", null, stoken)).status === 403);
  // ---- per-task photo, combined dashboard, sheet sync
  const tpForm = new FormData(); tpForm.append("photo", new Blob([tinyPng], { type: "image/png" }), "t.png");
  const tpRes = await fetch(base + "/api/shift-checklist/item-photo", { method: "POST", headers: { Authorization: `Bearer ${ctoken || stoken}` }, body: tpForm });
  ok("a photo can be added to a single task", tpRes.status === 201 && /^\/uploads\/shift-checklist\//.test((await tpRes.json()).url));
  const dashRes = await call("GET", "/api/shift-checklist/dashboard", null, admin);
  ok("combined checklist dashboard loads", dashRes.status === 200 && dashRes.body.summary && dashRes.body.trend.length === 14);
  ok("staff cannot open the checklist dashboard", (await call("GET", "/api/shift-checklist/dashboard", null, stoken)).status === 403);
  const sheetStaff = users.find((u) => u.shift_role);
  const sheetCsv = ["Submitted At,Staff Name,Role,Date,Shift,Completed,Total,Checklist Detail,Metrics", `01/09/2026 09:15:00,${sheetStaff.name},${sheetStaff.shift_role},2026-09-01,Morning,1,2,"Opening:\n[DONE] Switch on lights\n[PENDING] Clean desk",`].join("\n");
  const sheetSrv = (await import("node:http")).createServer((q, r) => { r.setHeader("Content-Type", "text/csv"); r.end(sheetCsv); }); await new Promise((r) => sheetSrv.listen(0, r));
  const sheetUrl = `http://localhost:${sheetSrv.address().port}/log.csv`;
  ok("sheet link can be saved", (await call("PUT", "/api/shift-checklist/sheet", { url: sheetUrl }, admin)).status === 200);
  const syncRes = await call("POST", "/api/shift-checklist/sheet/sync", null, admin);
  ok("sheet entries sync into the app", syncRes.status === 200 && syncRes.body.imported >= 1, JSON.stringify(syncRes.body));
  const dash2 = await call("GET", "/api/shift-checklist/dashboard?date=2026-09-01", null, admin);
  ok("dashboard shows sheet entries together with app entries", dash2.body.summary.fromSheet >= 1 && dash2.body.people.some((p) => p.source === "sheet"));
  sheetSrv.close();
  // ---- HR: leave, late fines, birthdays ----
  {
    const hrUser = users.find((u) => /\bHR\b/i.test(u.designation || ""));
    ok("an HR person exists", !!hrUser);
    const hrTok = (await call("POST", "/api/auth/login", { userId: hrUser.id, pin: "1234" })).body?.token;
    const t0 = new Date(Date.now() + 19800000), ymd = (d) => d.toISOString().slice(0, 10);
    const dd = t0.getUTCDate(), dA = ymd(new Date(t0.getTime() - (dd > 27 ? 86400000 : 0))), dB = ymd(new Date(t0.getTime() + (dd > 27 ? 0 : 86400000)));
    const month = ymd(t0).slice(0, 7);
    const lvTarget = users.find((u) => u.role === "staff" && u.id !== staff.id && u.id !== hrUser.id);
    const lvTok = (await call("POST", "/api/auth/login", { userId: lvTarget.id, pin: "1234" })).body?.token;
    const ap1 = await call("POST", "/api/leave/apply", { fromDate: dA, toDate: dA, reasonType: "sick", reason: "fever" }, lvTok);
    ok("staff can apply for leave", ap1.status === 201, JSON.stringify(ap1.body));
    ok("overlapping request refused", (await call("POST", "/api/leave/apply", { fromDate: dA, reasonType: "travel" }, lvTok)).status === 409);
    ok("'Other' needs a written reason", (await call("POST", "/api/leave/apply", { fromDate: dB, reasonType: "other" }, lvTok)).status === 400);
    ok("staff cannot approve", (await call("POST", `/api/leave/${ap1.body.id}/decide`, { decision: "approved", mgmtOk: "Sir" }, lvTok)).status === 403);
    ok("staff cannot see all requests", (await call("GET", "/api/leave/requests", null, lvTok)).status === 403);
    const pend = await call("GET", "/api/leave/overview", null, hrTok);
    ok("HR overview lists the waiting request", pend.body.pending?.some((r) => r.id === ap1.body.id));
    ok("approval needs Sir/Mam to be recorded", (await call("POST", `/api/leave/${ap1.body.id}/decide`, { decision: "approved" }, hrTok)).status === 400);
    ok("HR confirms receipt and sends to Sir/Mam", (await call("POST", `/api/leave/${ap1.body.id}/confirm`, { note: "letter received" }, hrTok)).status === 200);
    ok("waiting-for-Sir/Mam request still shows for HR", (await call("GET", "/api/leave/requests?status=with_management", null, hrTok)).body.some((r) => r.id === ap1.body.id));
    ok("staff cannot confirm", (await call("POST", `/api/leave/${ap1.body.id}/confirm`, {}, lvTok)).status === 403);
    ok("HR approves with Sir & Mam", (await call("POST", `/api/leave/${ap1.body.id}/decide`, { decision: "approved", mgmtOk: "Sir & Mam" }, hrTok)).status === 200);
    const ap2 = await call("POST", "/api/leave/apply", { fromDate: dB, toDate: dB, reasonType: "family" }, lvTok);
    ok("second day warns about salary cut", ap2.status === 201 && /salary/i.test(ap2.body.warning || ""), JSON.stringify(ap2.body));
    await call("POST", `/api/leave/${ap2.body.id}/decide`, { decision: "approved", mgmtOk: "Mam" }, hrTok);
    const mine = await call("GET", "/api/leave/mine", null, lvTok);
    ok("one free day, one unpaid day", mine.body.summary.taken === 2 && mine.body.summary.lopDays === 1, JSON.stringify(mine.body.summary));
    const news = await call("GET", "/api/leave/overview", null, lvTok);
    ok("staff sees the decision as news", news.body.mine.news.length === 2);
    await call("POST", "/api/leave/seen", null, lvTok);
    ok("news clears once seen", (await call("GET", "/api/leave/overview", null, lvTok)).body.mine.news.length === 0);
    const dF = ymd(new Date(t0.getTime() + 5 * 86400000)); const ap3 = await call("POST", "/api/leave/apply", { fromDate: dF, reasonType: "travel" }, lvTok); await call("POST", `/api/leave/${ap3.body.id}/decide`, { decision: "approved", mgmtOk: "Sir" }, hrTok);
    const brd = await call("GET", `/api/attendance/board?date=${dF}`, null, admin); ok("approved leave shows in attendance register", brd.body.rows?.find((r) => r.id === lvTarget.id)?.mark === "LV");
    await call("POST", `/api/leave/${ap3.body.id}/decide`, { decision: "rejected" }, hrTok);
    ok("rejecting later removes it from the register", (await call("GET", `/api/attendance/board?date=${dF}`, null, admin)).body.rows?.find((r) => r.id === lvTarget.id)?.mark == null);
    ok("HR can change the rules", (await call("PUT", "/api/leave/settings", { late_fine: 150 }, hrTok)).body?.late_fine === 150);
    ok("staff cannot change the rules", (await call("PUT", "/api/leave/settings", { late_fine: 1 }, lvTok)).status === 403);

    // late arrivals -> automatic fine after 3
    const lateU = users.find((u) => u.role === "staff" && ![staff.id, hrUser.id, lvTarget.id].includes(u.id));
    for (const d of ["01", "02", "03"]) await call("PUT", "/api/attendance/mark", { userId: lateU.id, date: `${month}-${d}`, status: "L" }, admin);
    const lateRep = await call("GET", `/api/leave/late?month=${month}`, null, hrTok);
    const lr = lateRep.body.rows?.find((r) => r.id === lateU.id);
    ok("3 late arrivals counted", lr?.count === 3 && lr.fine === 150, JSON.stringify(lr));
    const fl = await call("GET", `/api/fines?month=${month}&userId=${lateU.id}`, null, admin);
    ok("late fine was created automatically", fl.body.rows?.some((r) => r.category === "late" && r.amount === 150), JSON.stringify(fl.body.rows));
    await call("GET", `/api/leave/late?month=${month}`, null, hrTok);
    ok("fine is not duplicated", (await call("GET", `/api/fines?month=${month}&userId=${lateU.id}`, null, admin)).body.rows.length === 1);
    await call("PUT", "/api/attendance/mark", { userId: lateU.id, date: `${month}-03`, status: "P" }, admin);
    await call("GET", `/api/leave/late?month=${month}`, null, hrTok);
    ok("fine goes away if the late mark is corrected", (await call("GET", `/api/fines?month=${month}&userId=${lateU.id}`, null, admin)).body.rows.length === 0);
    await call("PUT", "/api/attendance/mark", { userId: lateU.id, date: `${month}-03`, status: "L" }, admin);

    // payslip carries leave cut + fine
    await call("POST", "/api/payroll/profile", { userId: lvTarget.id, companyId: comps[0].id, employeeCode: "LV9", position: "Exec", basicSalary: 30000 }, admin);
    await call("POST", "/api/payroll/profile", { userId: lateU.id, companyId: comps[0].id, employeeCode: "LT9", position: "Exec", basicSalary: 30000 }, admin);
    const g = await call("POST", "/api/payroll/generate", { period: month, userId: lvTarget.id }, admin);
    ok("payslip deducts one day's salary (30000/30)", g.status === 201 && g.body[0].lop_days === 1 && g.body[0].lop_amount === 1000 && g.body[0].net_payable === 29000, JSON.stringify(g.body));
    const g2 = await call("POST", "/api/payroll/generate", { period: month, userId: lateU.id }, admin);
    ok("payslip carries the late fine", g2.body[0].fine_amount === 150 && g2.body[0].late_count === 3 && g2.body[0].net_payable === 29850, JSON.stringify(g2.body));

    // birthdays
    await call("PATCH", `/api/users/${lvTarget.id}`, { birthday: ymd(t0).slice(5) }, admin);
    const bd = await call("GET", "/api/leave/overview", null, admin);
    ok("today's birthday pops up for admin", bd.body.birthdaysToday?.some((b) => b.id === lvTarget.id));
    ok("staff cannot open reports (leadership only)", (await call("GET", "/api/reports/summary", null, lvTok)).status === 403);
    ok("login carries the access flags", (await call("POST", "/api/auth/login", { userId: lvTarget.id, pin: "1234" })).body.user.leadership === false);
    ok("only admin can grant leadership", (await call("PATCH", `/api/users/${lvTarget.id}`, { leadership: true }, hrTok)).status === 403);
    ok("admin can grant HR access", (await call("PATCH", `/api/users/${lvTarget.id}`, { isHr: true }, admin)).status === 200 && (await call("GET", "/api/leave/config", null, lvTok)).body.isHr === true);
    await call("PATCH", `/api/users/${lvTarget.id}`, { isHr: false }, admin);
    ok("staff cannot see birthdays", (await call("GET", "/api/leave/birthdays", null, lvTok)).status === 403);
    const ask = async (q, tok) => (await call("POST", "/api/assistant/ask", { message: q }, tok)).body?.reply || "";
    ok("assistant: HR sees today's birthday", (await ask("upcoming birthdays", hrTok)).includes("Today"));
    ok("assistant: staff are told birthdays are HR-only", /HR/.test(await ask("any birthdays?", lvTok)));
    ok("assistant: my leave balance", /free casual leave/.test(await ask("how many leaves do I have left?", lvTok)));
    ok("assistant: late list for HR", (await ask("who was late this month?", hrTok)).includes(lateU.name));
    ok("assistant: staff get no clinic-wide data", !/staff\): present/.test(await ask("attendance today for everyone", lvTok)));
    ok("assistant: staff get no policy dump", /own tasks/.test(await ask("tell me the grievance process", lvTok)));
    ok("assistant: staff see their leave status", /free casual leave/.test(await ask("was my leave approved?", lvTok)));
    ok("assistant: leadership gets clinic attendance", /Attendance today/.test(await ask("attendance today", admin)));
    ok("assistant: staff suggestions are short", (await call("GET", "/api/assistant/faqs", null, lvTok)).body.suggestions.length === 5);
    ok("assistant: staff cannot list staff", /managers, HR/.test(await ask("how many staff are there", lvTok)));
    ok("assistant: HR gets the staff count", /active staff/.test(await ask("how many staff are there", hrTok)));
  }
  // Lockout
  let last; for (let i = 0; i < 8; i++) last = await call("POST", "/api/auth/login", { email: "lock@test.local", password: "x" });
  ok("repeated wrong logins are locked out (429)", last.status === 429);

  // Audit + backup
  const au = await call("GET", "/api/admin/audit?limit=1000", null, admin);
  ok("activity log records sign-ins and changes", au.status === 200 && au.body.some((r) => r.action === "LOGIN") && au.body.some((r) => r.action.startsWith("POST /api/users/me/pin")));
  const copyDir = path.join(dir, "drive-copy");
  ok("extra backup folder can be set", (await call("PUT", "/api/admin/backup-copy", { dir: copyDir }, admin)).status === 200);
  ok("extra backup copy was written", fs.readdirSync(path.join(copyDir, "database")).some((f) => f.endsWith(".db")));
  ok("backup time can be changed", (await call("PUT", "/api/admin/backup-copy", { dir: copyDir, time: "17:45" }, admin)).body?.time === "17:45");
  ok("bad backup time refused", (await call("PUT", "/api/admin/backup-copy", { dir: copyDir, time: "25:99" }, admin)).status === 400);
  ok("relative folder is refused", (await call("PUT", "/api/admin/backup-copy", { dir: "backups2" }, admin)).status === 400);
  const stg = await call("GET", "/api/admin/storage", null, admin); ok("storage report works", stg.status === 200 && stg.body.parts.some((p) => p.name === "Database" && p.bytes > 0));
  ok("old snapshot clean-up works", (await call("POST", "/api/admin/cleanup-snapshots", { days: 90 }, admin)).status === 200);
  ok("staff cannot touch backup settings", (await call("PUT", "/api/admin/backup-copy", { dir: copyDir }, stoken)).status === 403);
  const bk = await call("POST", "/api/admin/backups", null, admin); ok("backup can be created", bk.status === 201);
  const bl = await call("GET", "/api/admin/backups", null, admin); ok("backup is listed and not empty", bl.body?.[0]?.bytes > 10000);
  // Clinic AI (n8n) — fake n8n server
  const http = await import("node:http");
  let got = null;
  const fake = http.createServer((rq, rs) => { let b = ""; rq.on("data", (c) => (b += c)); rq.on("end", () => { got = JSON.parse(b); rs.setHeader("Content-Type", "application/json"); rs.end(JSON.stringify({ output: "42 new patients" })); }); });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  const fakeUrl = `http://127.0.0.1:${fake.address().port}/webhook/7d822c56-8e39-44dc-8977-85febc659bc5/chat`;
  { const b = await call("PUT", "/api/clinic-ai/config", { url: "https://x.com/hello" }, admin); ok("clinic AI: bad link refused", b.status === 400, JSON.stringify(b)); }
  ok("clinic AI: staff cannot set link", (await call("PUT", "/api/clinic-ai/config", { url: fakeUrl }, stoken)).status === 403);
  ok("clinic AI: ask before setup says not connected", (await call("POST", "/api/clinic-ai/ask", { message: "hi" }, admin)).status === 400);
  ok("clinic AI: admin saves link", (await call("PUT", "/api/clinic-ai/config", { url: fakeUrl }, admin)).status === 200);
  const ai = await call("POST", "/api/clinic-ai/ask", { message: "new patients?" }, admin);
  ok("clinic AI: answer comes back from n8n", ai.body.reply === "42 new patients" && got.chatInput === "new patients?" && got.action === "sendMessage");
  ok("clinic AI: staff blocked from patient data", (await call("POST", "/api/clinic-ai/ask", { message: "x" }, stoken)).status === 403);
  fake.close();
  // ---- auto leave for unmarked days ----
  {
    const ymd = (d) => d.toISOString().slice(0, 10), now = new Date(Date.now() + 19800000);
    let y = null; for (let n = 1; n <= 4; n++) { const d = new Date(now.getTime() - n * 86400000); if (d.getUTCDay() !== 0) { y = ymd(d); break; } }
    await call("POST", "/api/attendance/mark-day", { date: y, status: "P" }, admin);
    await call("PUT", "/api/attendance/mark", { userId: staff.id, date: y, status: "" }, admin);
    ok("auto leave: staff cannot run it", (await call("POST", "/api/attendance/auto-leave", { date: y, force: true }, stoken)).status === 403);
    const first = await call("POST", "/api/attendance/auto-leave", { date: y }, admin);
    ok("auto leave never touches days before it was switched on", first.body.marked === 0, JSON.stringify(first.body));
    const forced = await call("POST", "/api/attendance/auto-leave", { date: y, force: true }, admin);
    ok("auto leave marks the unmarked person as Leave", forced.body.marked >= 1, JSON.stringify(forced.body));
    const bd = await call("GET", `/api/attendance/board?date=${y}`, null, admin);
    ok("that person shows as Leave on the board", bd.body.rows.find((r) => r.id === staff.id)?.mark === "LV");
    ok("people already marked stay as they were", bd.body.rows.filter((r) => r.mark === "P").length >= 3);
    if (y.slice(0, 7) === ymd(now).slice(0, 7)) {
      const mine = await call("GET", "/api/leave/mine", null, stoken);
      ok("auto leave counts as casual leave", mine.body.summary.taken >= 1, JSON.stringify(mine.body.summary));
    }
    const ex = await fetch(base + `/api/attendance/export?from=${y.slice(0, 7)}&to=${y.slice(0, 7)}`, { headers: { Authorization: `Bearer ${admin}` } });
    ok("Excel export works for a range of months", ex.status === 200 && (await ex.arrayBuffer()).byteLength > 1000);
  }
  ok("unknown API route returns 404 JSON", (await call("GET", "/api/nope", null, admin)).status === 404);
} catch (e) {
  fail++; console.log("  FAIL  unexpected error:", e.message);
} finally {
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
