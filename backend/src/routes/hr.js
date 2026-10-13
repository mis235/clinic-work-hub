import { Router } from "express";
import { randomUUID } from "node:crypto";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import db from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

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
function generateOfferLetterText({ candidateName, roleTitle, department, salaryText, startDate }) {
  return `Dr. Nishita's Clinic
Offer of Employment

Dear ${candidateName},

We are pleased to offer you the position of ${roleTitle}${department ? ` in our ${department} team` : ""} at Dr. Nishita's Clinic.

Start date: ${startDate || "[to be confirmed]"}
Compensation: ${salaryText || "[to be confirmed]"}

This offer is subject to the clinic's standard policies, which you will be asked to review and acknowledge on your first day, including our Attendance, Leave, Code of Conduct, and Patient Confidentiality policies.

We look forward to welcoming you to the team.

Sincerely,
Dr. Nishita Ranka
Founder & Medical Director
Dr. Nishita's Clinic

[NOTE: This is a generated starting template -- review the wording, especially compensation structure and any probation/notice period terms, against your actual employment contract practice before sending.]`;
}

router.get("/offer-letters", requireAuth, requirePermission("staff:manage"), (req, res) => {
  res.json(db.prepare("SELECT * FROM offer_letters ORDER BY created_at DESC").all());
});

router.post("/offer-letters", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const { candidateName, roleTitle, department, salaryText, startDate, userId } = req.body || {};
  if (!candidateName || !roleTitle) return res.status(400).json({ error: "candidateName and roleTitle are required" });
  const bodyText = generateOfferLetterText({ candidateName, roleTitle, department, salaryText, startDate });
  const id = randomUUID();
  db.prepare(
    `INSERT INTO offer_letters (id, user_id, candidate_name, role_title, department, salary_text, start_date, body_text, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId || null, candidateName, roleTitle, department || null, salaryText || null, startDate || null, bodyText, req.user.userId);
  res.status(201).json({ id, bodyText });
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
router.get("/events", requireAuth, (req, res) => {
  const stored = db.prepare("SELECT * FROM clinic_events ORDER BY event_date").all();

  const usersWithBirthdays = db.prepare("SELECT name, birthday FROM users WHERE active = 1 AND birthday IS NOT NULL").all();
  const usersWithTenure = db.prepare("SELECT name, joined_at FROM users WHERE active = 1 AND joined_at IS NOT NULL").all();

  const today = new Date();
  const yearsOfExperience = usersWithTenure.map((u) => {
    const joined = new Date(u.joined_at);
    const years = ((today - joined) / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1);
    return { name: u.name, joinedAt: u.joined_at, years: Number(years) };
  });

  res.json({
    festivalsAndImportantDates: stored,
    birthdays: usersWithBirthdays,
    yearsOfExperience,
    note:
      usersWithBirthdays.length === 0
        ? "No staff birthdates are on file yet — add them via PATCH /api/users/:id or the admin Team screen to populate this."
        : undefined,
  });
});

router.post("/events", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const { title, eventType, eventDate, recurring } = req.body || {};
  if (!title || !eventType || !eventDate) return res.status(400).json({ error: "title, eventType, eventDate are required" });
  const id = randomUUID();
  db.prepare("INSERT INTO clinic_events (id, title, event_type, event_date, recurring) VALUES (?, ?, ?, ?, ?)")
    .run(id, title, eventType, eventDate, recurring === false ? 0 : 1);
  res.status(201).json({ id });
});

export default router;
