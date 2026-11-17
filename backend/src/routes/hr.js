import { Router } from "express";
import { randomUUID } from "node:crypto";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import db from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { sopsForRole } from "./policies.js";

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/hr/about — real content, taken directly from the clinic's actual
// "About" page (the only content-bearing page besides Home on the source
// site). Static for now; move to an editable table if it needs to change
// often.
// ---------------------------------------------------------------------------
router.get("/about", requireAuth, (req, res) => {
  res.json({
    clinicIntro:
      "At Dr. Nishita's Clinic, we believe that true aesthetics begins with science, trust, and individualized care. Our clinic brings together evidence-based dermatology, advanced aesthetic technology, and a patient-centered approach. We are dedicated to creating a comfortable, respectful, and result-driven experience for every patient who walks through our doors.\n\nUnder the leadership of Dr. Nishita Ranka, our team blends expertise with empathy, focusing on safe treatments, transparent guidance, and long-lasting results.",
    clinic: {
      name: "Dr. Nishita's Clinic",
      tagline: "Skin, Hair & Aesthetics",
      address: "Road No. 7, 1st Floor, Sowbhagya Abode, Beside Iran Embassy, Banjara Hills, Hyderabad, Telangana 500034",
      phone: "+91 93812 19187",
      email: "support@drnishitaranka.com",
      website: "https://drnishitaranka.com",
      photo: "/clinic/dr-nishita.png",
    },
    services: [
      { name: "Skin", items: ["Acne & scars", "Pigmentation", "Rosacea & eczema", "CO2 laser resurfacing", "Microneedling (Dermapen4, MNRF)", "HIFU, chemical peels, HydraFacial MD"] },
      { name: "Hair", items: ["Hair fall & thinning", "Alopecia areata", "GFC, QR678, exosomes", "Mesotherapy & scalp peels", "Hair transplant", "LLLT"] },
      { name: "Aesthetics", items: ["Botulinum toxin", "Dermal fillers", "Thread lifts", "Skin boosters", "Jaw slimming & under-eye care", "Bridal care"] },
    ],
    founder: {
      name: "Dr. Nishita Ranka Bagmar",
      title: "Founder & Medical Director",
      photoUrl: "/clinic/dr-nishita.png",
      experience: "10+ years",
      qualifications: [
        "MBBS — DY Patil University (2014)",
        "Diploma in Dermatology, Venereology & Leprosy — DY Patil University (2016)",
        "Advanced training in France, South Korea, the UAE and Singapore",
      ],
      bio:
        "Dr. Nishita Ranka is the Founder and Medical Director of Dr. Nishita's Clinic. She is widely respected in the field of dermatology and aesthetic medicine, with advanced training from France, South Korea, the UAE, and Singapore. Her experience combines strong clinical knowledge with a practical, science-led approach to aesthetic treatments.",
      highlights: [
        "A global trainer for Juvederm®, Restylane®, and Menarin",
        "A cadaver-trained practitioner in facial anatomy and injectables",
        "An international speaker and faculty member in anti-aging and Indian skin dermatology",
        "A clinician experienced in treating patients across every age group",
      ],
    },
    vision: "To build a well-organized, informed, and efficient team environment that supports excellence in patient care.",
    mission: "To provide staff with a centralized platform for checklists, policies, SOPs, and updates—ensuring smooth operations, accountability, and consistent quality across the clinic.",
  });
});

// ---------------------------------------------------------------------------
// Team / Management profiles — the source site's Management page was empty,
// so this starts empty too. Admin adds real profiles through the app.
// ---------------------------------------------------------------------------
router.get("/team", requireAuth, (req, res) => {
  res.json(db.prepare("SELECT * FROM team_profiles ORDER BY sort_order, name").all());
});

router.post("/team", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const { name, title, bio, sortOrder } = req.body || {};
  if (!name) return res.status(400).json({ error: "name is required" });
  const id = randomUUID();
  db.prepare("INSERT INTO team_profiles (id, name, title, bio, sort_order) VALUES (?, ?, ?, ?, ?)")
    .run(id, name, title || null, bio || null, sortOrder || 0);
  res.status(201).json({ id });
});

// ---------------------------------------------------------------------------
// HR / Offer Letters — a real generator, not a static folder link. Admin
// fills in the details, gets a ready-to-send letter, and it's stored so it
// can be reprinted identically later.
// ---------------------------------------------------------------------------
const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"));
const longDate = (d) => { const x = d ? new Date(d + "T00:00:00Z") : new Date(Date.now() + 19800000); if (Number.isNaN(x.getTime())) return d || ""; return `${String(x.getUTCDate()).padStart(2, "0")}${ord(x.getUTCDate()).slice(-2)} ${x.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`; };
const rupee = (n) => "₹" + Number(n).toLocaleString("en-IN");

// Matches the clinic's signed offer letters (the PDFs in the Offer Letters Drive folder).
function generateOfferLetterText({ candidateName, roleTitle, department, salaryText, startDate, address, retained, hours, duties }) {
  const sal = Number(String(salaryText || "").replace(/[^\d.]/g, "")) || 0, ret = Number(String(retained || "").replace(/[^\d.]/g, "")) || 0;
  const salaryLine = sal ? `${rupee(sal)} per month${ret ? `, out of which ${rupee(ret)} will be retained, resulting in a net pay of ${rupee(sal - ret)} per month` : ""}` : (salaryText || "[to be confirmed]");
  const wh = hours || "9:00 AM to 6:30 PM (Monday to Saturday)", join = startDate ? longDate(startDate) : "[to be confirmed]";
  const list = String(duties || "").split("\n").map((x) => x.trim()).filter(Boolean);
  const dutyLines = (list.length ? list : ["Carrying out the duties of the role with care and professionalism.", "Providing excellent service to patients and colleagues.", "Following the clinic's SOPs, policies and grooming standards."]).map((x) => `• ${x}`).join("\n");
  return `DR. NISHITA'S CLINIC
FOR SKIN, HAIR & AESTHETICS

Dr. Nishita's Clinic for Skin, Hair & Aesthetics
Sowbhagya Abode, Road No. 7, Beside Iran Embassy,
Banjara Hills, Hyderabad - 500034

Date: ${longDate("")}

${candidateName}
${address ? String(address).trim() + "\n" : ""}
Dear ${candidateName},

We are pleased to offer you the position of ${roleTitle}${department ? ` (${department})` : ""} at Dr. Nishita's Clinic for Skin, Hair & Aesthetics. After reviewing your skills and experience, we believe you will be a valuable addition to our team. We look forward to having you contribute to the success and growth of our clinic.

Offer Details:
• Job Title: ${roleTitle}
• Salary: ${salaryLine}
• Salary Payout Date: Salary is paid by the 10th of each month.
• Joining Date: ${join}
• Work Location: Sowbhagya Abode, Road No. 7, Beside Iran Embassy, Banjara Hills, Hyderabad - 500034
• Working Hours: ${wh}

Job Responsibilities:
As a ${roleTitle}, your responsibilities in this role primarily include:
${dutyLines}

Key Terms of Employment and Agreement:
1. Employment Duration & Duties: Your employment begins on the agreed joining date. You are expected to diligently perform your duties under the direction of Dr. Nishita Ranka or such other person as the Employer may designate from time to time ("Duties"), contributing your full time and energy to the role.
2. Working Hours: Your working hours will be ${wh}, with a 30-minute lunch break included. These working hours are subject to change based on the Employer's operational needs.
3. Paid Time Off (PTO) & Vacation: You are entitled to 12 days of paid time off (PTO) per year, accruing at the rate of 1 day per month. PTO can be used for vacation, illness, or family emergencies. This PTO must be used in the calendar year and cannot be carried over.
4. Advance Notice of Vacation Dates: You must provide the Employer with written notice at least two weeks in advance of your desired vacation dates.
5. ${ret ? `Salary Retention: It is the policy of Dr. Nishita's Clinic to retain part of your salary for every 12 months of your employment. After you complete 12 months of continuous service, the first 6 months of the retained amount will be paid to you with your 13th-month salary, and the next 6 months of the retained amount will be paid to you with your 14th-month salary. Amount of ${rupee(ret)} will be retained from your salary, which may change based on future salary increments. This retention amount is intended to encourage your long-term commitment to the clinic.` : "Salary: Your salary will be paid as stated above, after deduction of any fines or leave-without-pay days as per clinic policy."}
6. Grooming Standards: As part of maintaining the professional image of Dr. Nishita's Clinic, all employees are required to adhere to strict grooming standards. This includes maintaining a clean, neat, and professional appearance at all times during work hours. Employees must wear appropriate attire and follow specific grooming guidelines, such as neat hairstyles, clean shoes, and minimal accessories. Any violation of these grooming standards will be subject to fines or disciplinary action as deemed necessary by the Employer.
7. Termination Conditions:
   - For Cause: The Employer may terminate the agreement immediately for cause (e.g., dishonesty, fraud, gross misconduct, failure to perform duties, etc.).
   - Early Termination by Employee: If you choose to leave before completing the Mandatory Employment Term and fail to provide the required two-month notice, you will be required to reimburse the Employer for any expenses incurred due to your early termination. The specific reimbursement amount will be discussed and confirmed at that time.
   - Early Termination by Employer: If the Employer terminates before the mandatory term, you will receive appropriate compensation.
8. Confidentiality, Reputation Protection, and Records Handling:
   - Confidential Information: During your employment and after termination, you must maintain the confidentiality of all sensitive information, including patient records, business practices, and financial data. This includes not disclosing or using such information for personal gain or any other purpose.
   - Protection of Reputation: You agree not to engage in any behavior that could harm or damage the reputation of Dr. Nishita's Clinic, its employees, or its services, both during and after your employment.
   - Use of Employer's Facilities and Records: All notes, data, patient information, and other work-related records are the exclusive property of the Employer. These materials must be maintained confidentially and returned to the Employer upon the termination of your employment. You agree not to access any of the Employer's facilities, including phone systems and databases, after your employment ends.
9. Non-Compete Agreement: During your employment and for a period of two months after termination, you agree not to engage in or accept employment with any competing business providing similar services within a 5 km radius of Dr. Nishita's Clinic.
10. Non-Solicitation: You agree not to solicit or attempt to engage any of Dr. Nishita's Clinic's patients, suppliers, or employees during your employment and for two months following termination.
11. Jurisdiction: Any dispute arising under these terms will be resolved in the courts of Hyderabad, Telangana, following an amicable resolution process if necessary.

Please review the terms of this offer and, if you agree with the details outlined, kindly sign and return a copy of this letter to confirm your acceptance.

We are excited about the opportunity to have you join our team and contribute to the clinic's vision.

Sincerely,

Shreyas Pradeep Bagmar
Managing Partner
Dr Nishita's Clinic For Skin Hair & Aesthetics
Iranian Consulate, First Floor, 8-2-502/1/A/1, Sowbhagya Dental, Road No. 7, Banjara Hills, Hyderabad-500034.
GST NO: 36AATFD6204E2ZG

Acknowledgement and Acceptance
I, ${candidateName}, accept the offer for the position of ${roleTitle} at Dr. Nishita's Clinic for Skin, Hair & Aesthetics and agree to the terms and conditions with a joining date of ${join}, as outlined in this offer letter.

Signature:                                   Date:`;
}

router.get("/offer-letters", requireAuth, requirePermission("staff:manage"), (req, res) => {
  res.json(db.prepare("SELECT * FROM offer_letters ORDER BY created_at DESC").all());
});

router.post("/offer-letters", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const { candidateName, roleTitle, department, salaryText, startDate, userId, address, retained, hours, duties } = req.body || {};
  if (!candidateName || !roleTitle) return res.status(400).json({ error: "candidateName and roleTitle are required" });
  let bodyText = generateOfferLetterText({ candidateName, roleTitle, department, salaryText, startDate, address, retained, hours, duties });
  // Role SOPs are attached automatically: they are listed in the letter and show up in the person's own app to read.
  const sops = sopsForRole(department, roleTitle);
  if (sops.length) bodyText = bodyText.replace(/\nSincerely,/, `\nStandard Operating Procedures (SOPs) for your role — please read these before your first day:\n${sops.map((p, i) => `${i + 1}. ${p.title}`).join("\n")}\n\nSincerely,`);
  const id = randomUUID();
  db.prepare(
    `INSERT INTO offer_letters (id, user_id, candidate_name, role_title, department, salary_text, start_date, body_text, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId || null, candidateName, roleTitle, department || null, salaryText || null, startDate || null, bodyText, req.user.userId);
  if (userId) {
    try { db.prepare("INSERT OR IGNORE INTO staff_messages (id, user_id, kind, msg_date, title, body, email_status) VALUES (?,?,?,?,?,?,?)").run(randomUUID(), userId, `sops:${id}`, new Date(Date.now() + 19800000).toISOString().slice(0, 10), "Your role SOPs are ready", sops.length ? `${sops.length} SOP(s) for your role are waiting in the SOPs menu. Please read and tick them.` : "Check the SOPs menu.", "in-app"); } catch {}
  }
  res.status(201).json({ id, bodyText, sops: sops.map((p) => p.title) });
});

// ---------------------------------------------------------------------------
// Learning & Resources / Training Videos — a real library with view tracking,
// which is the actual "time-to-productivity" data the Onboarding & Training
// Program Manager agent needs. Starts empty; admin adds real video links.
// ---------------------------------------------------------------------------
router.get("/training-videos", requireAuth, (req, res) => {
  const videos = db.prepare("SELECT id, department, folder, kind, file_name, title, url, description, mime, sort_order, created_at, (file_path IS NOT NULL) AS is_upload FROM training_videos ORDER BY department, folder, sort_order, created_at").all();
  const myViews = new Set(
    db.prepare("SELECT video_id FROM training_video_views WHERE user_id = ?").all(req.user.userId).map((r) => r.video_id)
  );
  res.json(videos.map((v) => ({ ...v, watchedByMe: myViews.has(v.id) })));
});

const VIDEO_DIR = path.join(process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".."), "private", "videos");
fs.mkdirSync(VIDEO_DIR, { recursive: true });
const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, VIDEO_DIR),
    filename: (req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname || "").toLowerCase() || ".mp4"}`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^(video\/|image\/(png|jpeg|webp)|text\/(plain|csv)|application\/(pdf|msword|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)))/.test(file.mimetype || "")),
});

// Add a training video: either upload a video file or paste a link (YouTube / Drive / any https link).
router.post("/training-videos", requireAuth, requirePermission("staff:manage"), videoUpload.single("file"), (req, res) => {
  const { department, title, url, description } = req.body || {};
  const folder = String(req.body?.folder || "").trim().slice(0, 60) || null;
  if (!department || !title) return res.status(400).json({ error: "Choose a department and give it a title" });
  if (!req.file && !/^https?:\/\//i.test(url || "")) return res.status(400).json({ error: "Upload a file (video, PDF, slides, sheet…), or paste a link starting with https://" });
  const id = randomUUID();
  const next = db.prepare("SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM training_videos WHERE department = ?").get(department).n;
  const kind = req.file && !/^video\//.test(req.file.mimetype) ? "file" : "video";
  db.prepare("INSERT INTO training_videos (id, department, folder, kind, file_name, title, url, description, file_path, mime, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, department, folder, kind, req.file?.originalname || null, title, req.file ? "" : url, description || null, req.file?.path || null, req.file?.mimetype || null, next);
  res.status(201).json({ id });
});

// Add many link-videos at once: { items: [{ department, folder, title, url }] } (used by "Bulk Add" in the Training Library).
router.post("/training-videos/bulk", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 500) : [];
  let added = 0, skipped = 0;
  const has = db.prepare("SELECT 1 FROM training_videos WHERE url = ?");
  const nextOrder = db.prepare("SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM training_videos WHERE department = ?");
  const ins = db.prepare("INSERT INTO training_videos (id, department, folder, kind, file_name, title, url, description, file_path, mime, sort_order) VALUES (?, ?, ?, 'video', NULL, ?, ?, NULL, NULL, NULL, ?)");
  db.transaction(() => {
    for (const it of items) {
      const department = String(it?.department || "").trim(), title = String(it?.title || "").trim(), url = String(it?.url || "").trim();
      if (!department || !title || !/^https?:\/\//i.test(url) || has.get(url)) { skipped++; continue; }
      ins.run(randomUUID(), department, String(it.folder || "").trim().slice(0, 60) || null, title.slice(0, 160), url, nextOrder.get(department).n);
      added++;
    }
  })();
  res.json({ added, skipped });
});

router.patch("/training-videos/:id", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const v = db.prepare("SELECT * FROM training_videos WHERE id = ?").get(req.params.id);
  if (!v) return res.status(404).json({ error: "Not found" });
  const { title, department, description, url, sortOrder, folder } = req.body || {};
  db.prepare("UPDATE training_videos SET title = ?, department = ?, folder = ?, description = ?, url = ?, sort_order = ? WHERE id = ?")
    .run(title?.trim() || v.title, department || v.department, folder === undefined ? v.folder : (String(folder).trim().slice(0, 60) || null), description ?? v.description,
      v.file_path ? v.url : (url && /^https?:\/\//i.test(url) ? url : v.url), Number.isFinite(sortOrder) ? sortOrder : v.sort_order, v.id);
  res.json({ ok: true });
});

router.delete("/training-videos/:id", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const v = db.prepare("SELECT * FROM training_videos WHERE id = ?").get(req.params.id);
  if (!v) return res.status(404).json({ error: "Not found" });
  db.prepare("DELETE FROM training_video_views WHERE video_id = ?").run(v.id);
  db.prepare("DELETE FROM training_videos WHERE id = ?").run(v.id);
  if (v.file_path) fs.rm(v.file_path, { force: true }, () => {});
  res.json({ ok: true });
});

// Stream an uploaded video (supports seeking). <video> tags cannot send headers, so the token may come as ?token=
router.get("/training-videos/:id/stream", (req, res, next) => {
  if (!req.headers.authorization && req.query.token) req.headers.authorization = `Bearer ${req.query.token}`;
  next();
}, requireAuth, (req, res) => {
  const v = db.prepare("SELECT * FROM training_videos WHERE id = ?").get(req.params.id);
  if (!v?.file_path || !fs.existsSync(v.file_path)) return res.status(404).json({ error: "Not found" });
  res.type(v.mime || "video/mp4");
  const inline = /^(video\/|image\/|application\/pdf)/.test(v.mime || "");
  res.set("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(v.file_name || v.title)}`);
  res.sendFile(v.file_path);
});

// Rename a folder (or move it to another department's library) in one go.
router.post("/training-folders/rename", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const { department, from, to } = req.body || {};
  const n = String(to || "").trim().slice(0, 60);
  if (!department || !from || !n) return res.status(400).json({ error: "Give the folder a name" });
  const r2 = db.prepare("UPDATE training_videos SET folder = ? WHERE department = ? AND folder = ?").run(n, department, from);
  res.json({ ok: true, moved: r2.changes });
});

router.post("/training-videos/:id/watched", requireAuth, (req, res) => {
  db.prepare("INSERT OR IGNORE INTO training_video_views (video_id, user_id) VALUES (?, ?)").run(req.params.id, req.user.userId);
  res.json({ ok: true });
});

// GET /api/hr/training-videos/progress — admin view: who's watched what, by department
router.get("/training-videos/progress", requireAuth, requirePermission("reports:view"), (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.name, u.id AS user_id, d.name AS department,
              COUNT(tv.id) AS total_videos,
              COUNT(tvv.video_id) AS watched
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN training_videos tv ON (tv.department = d.name OR tv.department = 'All Staff')
       LEFT JOIN training_video_views tvv ON tvv.video_id = tv.id AND tvv.user_id = u.id
       WHERE u.active = 1
       GROUP BY u.id`
    )
    .all();
  res.json(rows);
});

// ---------------------------------------------------------------------------
// Upcoming Events — festivals/important dates are admin-entered; birthdays
// and years-of-experience are COMPUTED from users.birthday / users.joined_at
// so there's exactly one place that data lives, not a duplicate manual list.
// ---------------------------------------------------------------------------
const pad2 = (n) => String(n).padStart(2, "0");
const istMonth = () => new Date(Date.now() + 19800000).toISOString().slice(0, 7);
// One month at a time: ?month=YYYY-MM (default this month). Birthdays and work anniversaries are worked out from
// the staff records; festivals / dates are the ones the admin typed in (yearly ones repeat every year).
db.exec(`CREATE TABLE IF NOT EXISTS event_media (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL, kind TEXT NOT NULL, file TEXT NOT NULL, name TEXT, created_at TEXT DEFAULT (datetime('now'))
)`);
const EVENT_DIR = path.join(process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".."), "uploads", "events");
fs.mkdirSync(EVENT_DIR, { recursive: true });
const eventUpload = multer({
  storage: multer.diskStorage({ destination: (req, f, cb) => cb(null, EVENT_DIR), filename: (req, f, cb) => cb(null, `${randomUUID()}${path.extname(f.originalname || "").toLowerCase().replace(/[^.a-z0-9]/g, "")}`) }),
  limits: { fileSize: 200 * 1024 * 1024, files: 12 },
  fileFilter: (req, f, cb) => cb(null, /^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm|quicktime))$/.test(f.mimetype || "")),
});
const mediaOf = (id) => db.prepare("SELECT id, kind, file, name FROM event_media WHERE event_id = ? ORDER BY created_at").all(id).map((m) => ({ id: m.id, kind: m.kind, name: m.name, url: `/uploads/events/${m.file}` }));
router.post("/events/:id/media", requireAuth, requirePermission("staff:manage"), eventUpload.array("files", 12), (req, res) => {
  if (!db.prepare("SELECT 1 FROM clinic_events WHERE id = ?").get(req.params.id)) return res.status(404).json({ error: "Event not found" });
  if (!req.files?.length) return res.status(400).json({ error: "Choose photos (JPG, PNG) or videos (MP4)" });
  const ins = db.prepare("INSERT INTO event_media (id, event_id, kind, file, name) VALUES (?, ?, ?, ?, ?)");
  for (const f of req.files) ins.run(randomUUID(), req.params.id, f.mimetype.startsWith("video/") ? "video" : "image", f.filename, (f.originalname || "").slice(0, 120));
  res.status(201).json({ media: mediaOf(req.params.id) });
});
router.delete("/events/:id/media/:mid", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const m = db.prepare("SELECT * FROM event_media WHERE id = ? AND event_id = ?").get(req.params.mid, req.params.id);
  if (!m) return res.status(404).json({ error: "Not found" });
  db.prepare("DELETE FROM event_media WHERE id = ?").run(m.id);
  try { fs.unlinkSync(path.join(EVENT_DIR, m.file)); } catch {}
  res.json({ ok: true });
});
router.get("/events", requireAuth, (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : istMonth();
  const [yy, mm] = month.split("-").map(Number);
  const items = [];
  for (const e of db.prepare("SELECT * FROM clinic_events").all()) {
    const d = String(e.event_date || "");
    let day = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) { if (d.slice(0, 7) === month) day = Number(d.slice(8)); }
    else if (/^\d{2}-\d{2}$/.test(d)) { if (Number(d.slice(0, 2)) === mm) day = Number(d.slice(3)); }
    if (day) items.push({ kind: "event", id: e.id, day, title: e.title, eventType: e.event_type, eventDate: d, yearly: /^\d{2}-\d{2}$/.test(d), media: mediaOf(e.id) });
  }
  for (const u of db.prepare("SELECT name, birthday FROM users WHERE active = 1 AND birthday IS NOT NULL").all()) {
    const d = new Date(u.birthday);
    if (!Number.isNaN(d.getTime()) && d.getUTCMonth() + 1 === mm) items.push({ kind: "birthday", day: d.getUTCDate(), title: u.name + "'s birthday" });
  }
  for (const u of db.prepare("SELECT name, joined_at FROM users WHERE active = 1 AND joined_at IS NOT NULL").all()) {
    const d = new Date(u.joined_at);
    if (Number.isNaN(d.getTime()) || d.getUTCMonth() + 1 !== mm) continue;
    const years = yy - d.getUTCFullYear();
    if (years >= 1) items.push({ kind: "anniversary", day: d.getUTCDate(), title: `${u.name} completes ${years} year${years === 1 ? "" : "s"} at the clinic` });
  }
  items.sort((a, b) => a.day - b.day || a.title.localeCompare(b.title));
  res.json({ month, label: new Date(Date.UTC(yy, mm - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }), items });
});

function cleanEvent(body) {
  const { title, eventType, eventDate } = body || {};
  const t = String(title || "").trim().slice(0, 120), type = ["festival", "important_date", "event", "holiday"].includes(eventType) ? eventType : "event";
  const d = String(eventDate || "").trim();
  if (!t) return { error: "Please type a title" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) && !/^\d{2}-\d{2}$/.test(d)) return { error: "Please choose a date" };
  return { t, type, d };
}
router.post("/events", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const c = cleanEvent(req.body); if (c.error) return res.status(400).json({ error: c.error });
  const id = randomUUID();
  db.prepare("INSERT INTO clinic_events (id, title, event_type, event_date, recurring) VALUES (?, ?, ?, ?, ?)").run(id, c.t, c.type, c.d, /^\d{2}-\d{2}$/.test(c.d) ? 1 : 0);
  const when = /^\d{4}-/.test(c.d) ? new Date(c.d + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : new Date("2000-" + c.d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "long", timeZone: "UTC" }) + " (every year)";
  notifyAll("event:" + id, `${c.type === "holiday" ? "Holiday" : c.type === "festival" ? "Festival" : "New event"}: ${c.t}`, `${c.t} — ${when}.`);
  res.status(201).json({ id });
});
router.put("/events/:id", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const c = cleanEvent(req.body); if (c.error) return res.status(400).json({ error: c.error });
  const r = db.prepare("UPDATE clinic_events SET title = ?, event_type = ?, event_date = ?, recurring = ? WHERE id = ?").run(c.t, c.type, c.d, /^\d{2}-\d{2}$/.test(c.d) ? 1 : 0, req.params.id);
  if (!r.changes) return res.status(404).json({ error: "Event not found" });
  res.json({ ok: true });
});
router.delete("/events/:id", requireAuth, requirePermission("staff:manage"), (req, res) => {
  for (const m of db.prepare("SELECT file FROM event_media WHERE event_id = ?").all(req.params.id)) { try { fs.unlinkSync(path.join(EVENT_DIR, m.file)); } catch {} }
  db.prepare("DELETE FROM event_media WHERE event_id = ?").run(req.params.id);
  const r = db.prepare("DELETE FROM clinic_events WHERE id = ?").run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: "Event not found" });
  res.json({ ok: true });
});

// ---- notify every active staff member (shows as a banner in their app) ----
const todayIst = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
function notifyAll(kind, title, body) {
  const ins = db.prepare("INSERT OR IGNORE INTO staff_messages (id, user_id, kind, msg_date, title, body, email_status) VALUES (?,?,?,?,?,?,?)");
  for (const u of db.prepare("SELECT id FROM users WHERE active = 1").all()) ins.run(randomUUID(), u.id, kind, todayIst(), title, body, "in-app");
}

// ---- upcoming events + holidays for everyone's overview ----
router.get("/events/feed", requireAuth, (req, res) => {
  const t = todayIst(), t0 = new Date(t + "T00:00:00Z"), y = Number(t.slice(0, 4));
  const items = [];
  for (const e of db.prepare("SELECT * FROM clinic_events").all()) {
    const d = String(e.event_date || ""); let date = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) date = d;
    else if (/^\d{2}-\d{2}$/.test(d)) { date = `${y}-${d}`; if (date < t) date = `${y + 1}-${d}`; }
    if (!date || date < t) continue;
    const inDays = Math.round((new Date(date + "T00:00:00Z") - t0) / 86400000);
    if (inDays <= 60) items.push({ id: e.id, title: e.title, eventType: e.event_type, date, inDays });
  }
  items.sort((a, b) => a.inDays - b.inDays);
  res.json({ today: t, items: items.slice(0, 8) });
});

// ---- Employee of the Month ----
db.exec("CREATE TABLE IF NOT EXISTS employee_of_month (id TEXT PRIMARY KEY, month TEXT NOT NULL, user_id TEXT NOT NULL, note TEXT, created_by TEXT, created_at TEXT DEFAULT (datetime('now')))");
const eomRow = (r) => r && ({ id: r.id, month: r.month, label: new Date(r.month + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }), note: r.note || "", userId: r.user_id, name: r.name, designation: r.designation || "", department: r.department || "" });
const EOM_SQL = "SELECT e.*, u.name, u.designation, d.name AS department FROM employee_of_month e JOIN users u ON u.id = e.user_id LEFT JOIN departments d ON d.id = u.department_id";
router.get("/eom", requireAuth, (req, res) => {
  // This month's winner; in the first days of a month the last month's winner stays up.
  const m = istMonth(), prev = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)) - 2, 1)).toISOString().slice(0, 7);
  let row = db.prepare(EOM_SQL + " WHERE e.month = ? ORDER BY e.created_at DESC LIMIT 1").get(m);
  if (!row && Number(todayIst().slice(8)) <= 10) row = db.prepare(EOM_SQL + " WHERE e.month = ? ORDER BY e.created_at DESC LIMIT 1").get(prev);
  const history = db.prepare(EOM_SQL + " ORDER BY e.month DESC, e.created_at DESC LIMIT 12").all().map(eomRow);
  res.json({ current: eomRow(row) || null, history });
});
router.post("/eom", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const { userId, month, note } = req.body || {};
  const u = db.prepare("SELECT id, name FROM users WHERE id = ? AND active = 1").get(userId);
  if (!u) return res.status(400).json({ error: "Choose a staff member" });
  const m = /^\d{4}-\d{2}$/.test(month || "") ? month : istMonth();
  db.prepare("DELETE FROM employee_of_month WHERE month = ?").run(m);
  const id = randomUUID();
  db.prepare("INSERT INTO employee_of_month (id, month, user_id, note, created_by) VALUES (?,?,?,?,?)").run(id, m, u.id, String(note || "").trim().slice(0, 300), req.user.userId);
  const label = new Date(m + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  notifyAll("eom:" + id, `Employee of the Month — ${u.name}`, `Congratulations ${u.name}! ${u.name} is our Employee of the Month for ${label}.${note ? " " + String(note).trim().slice(0, 300) : ""}`);
  res.status(201).json({ id });
});
router.delete("/eom/:id", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const r = db.prepare("DELETE FROM employee_of_month WHERE id = ?").run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

export default router;
