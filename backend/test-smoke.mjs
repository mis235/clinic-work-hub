// One-command production smoke test:  cd backend && npm test
// Boots the server on a throwaway database and checks the flows the clinic depends on.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 4590 + Math.floor(Math.random() * 100);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-test-"));
const env = { ...process.env, PORT: String(PORT), DATA_DIR: dir, JWT_SECRET: "test-secret-for-smoke-tests-1234567890", ADMIN_EMAIL: "admin@test.local", ADMIN_PASSWORD: "testpass123", DISABLE_CRON: "true", NODE_ENV: "test" };
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
  const added = await call("POST", "/api/users", { name: "Test Person", departmentName: "Front Desk", roleName: "staff", phone: "+919111111111", pin: "4321" }, admin);
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
  const lv = await call("POST", "/api/users", { name: "Leaver One", departmentName: "Front Desk", roleName: "staff", phone: "+919222222222", pin: "5555" }, admin);
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

  // Lockout
  let last; for (let i = 0; i < 8; i++) last = await call("POST", "/api/auth/login", { email: "lock@test.local", password: "x" });
  ok("repeated wrong logins are locked out (429)", last.status === 429);

  // Audit + backup
  const au = await call("GET", "/api/admin/audit", null, admin);
  ok("activity log records sign-ins and changes", au.status === 200 && au.body.some((r) => r.action === "LOGIN") && au.body.some((r) => r.action.startsWith("POST /api/users/me/pin")));
  const bk = await call("POST", "/api/admin/backups", null, admin); ok("backup can be created", bk.status === 201);
  const bl = await call("GET", "/api/admin/backups", null, admin); ok("backup is listed and not empty", bl.body?.[0]?.bytes > 10000);
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
