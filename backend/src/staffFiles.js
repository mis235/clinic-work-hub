// Rules for sorting the clinic's staff-file folders (the "Staff data" zip) onto people and document types.
// Pure functions, no database: easy to test.

// Types that are kept as letters & records on a person's file. (ID proofs use the onboarding checklist keys in users.js.)
export const RECORD_TYPES = [
  { key: "offer_letter", label: "Offer letters" },
  { key: "increment_letter", label: "Increment letters" },
  { key: "experience_certificate", label: "Experience certificates" },
  { key: "relieving_letter", label: "Relieving letters" },
  { key: "resignation_letter", label: "Resignation letters" },
  { key: "termination_letter", label: "Termination letters" },
  { key: "fnf_settlement", label: "Full & final settlement" },
  { key: "staff_form", label: "Staff file form" },
  { key: "id_card", label: "Staff ID card" },
  { key: "complaint", label: "Complaints (admin only)" },
  { key: "other", label: "Other documents" },
];
export const ADMIN_ONLY_TYPES = ["complaint"];
const CHECKLIST_LABEL = { id_proof: "Government ID (Aadhaar / PAN)", address_proof: "Address proof", photo: "Passport-size photo", bank: "Bank account details" };
export const typeLabel = (k) => RECORD_TYPES.find((t) => t.key === k)?.label || CHECKLIST_LABEL[k] || k;

const NOISE = new Set(["dr", "mr", "mrs", "ms", "offer", "letter", "letters", "revised", "copy", "old", "terms", "addendum", "experience", "certificate",
  "relieving", "releiving", "resignation", "approval", "increment", "full", "final", "settlement", "f", "ff", "and", "id", "hk", "house", "keeping",
  "complaint", "salary", "calculations", "termination", "account", "opening", "employee", "statement", "the", "of", "to"]);

const tokens = (s, keepParens = false) => {
  let t = String(s || "").replace(/\.[a-z0-9]{2,4}$/i, "");
  if (!keepParens) t = t.replace(/\([^)]*\)/g, " ");
  return t.toLowerCase().replace(/&/g, " and ").replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w && !NOISE.has(w) && w.length > 1);
};

// Skip junk and blank templates.
const JUNK = /(^~\$|\.tmp$|\.lnk$|\.zip$|thumbs\.db$|\.ds_store$)/i;
const TEMPLATE_NAME = /^(admin|doctors?|front ?desk executive|pharmacist|therapist)\s+offer\s+letter\.docx?$/i;

function checklistTypeFor(file) {
  const f = file.toLowerCase();
  if (/aadh?a?r|\bpan\b|pan ?card|voter/.test(f)) return "id_proof";
  if (/bank|passbook|account|statement/.test(f)) return "bank";
  if (/photo|passport/.test(f)) return "photo";
  return null;
}

/** path inside the zip -> { skip, reason, type, person (name guess), dept (folder hint), hintDoctor } */
export function classify(zipPath) {
  const parts = zipPath.split("/").filter(Boolean);
  const file = parts[parts.length - 1] || "";
  if (zipPath.endsWith("/")) return { skip: true, reason: "folder" };
  if (JUNK.test(file)) return { skip: true, reason: "temporary file" };
  const i = parts.findIndex((p) => /^(Employee's Profile|STAFF'S FILE|Staff ID|Staff Passports|Salary Accounts)$/i.test(p));
  const top = i >= 0 ? parts[i] : "", rest = i >= 0 ? parts.slice(i + 1) : parts;
  const sub = rest[0] || "", base = rest[rest.length - 1] || file;
  const hintDoctor = /(^|\W)dr\b/i.test(rest.join(" "));
  const r = (type, person, dept) => ({ type, person, dept: dept || "", hintDoctor });

  if (/^Staff Passports$/i.test(top)) return r("photo", tokens(file).join(" "));
  if (/^Staff ID$/i.test(top)) return r("id_card", tokens(file).join(" "));
  if (/^STAFF'S FILE$/i.test(top)) { if (/blank/i.test(file)) return { skip: true, reason: "blank form" }; return r("staff_form", tokens(file.replace(/^\d+\.\s*/, "")).join(" ")); }
  if (/^Salary Accounts$/i.test(top)) return r("other", "");
  if (/^Employee's Profile$/i.test(top)) {
    if (rest.length === 1) { // loose files in the main folder
      if (/^Format for/i.test(file)) return r("other", "");
      if (/termination/i.test(file)) return r("termination_letter", tokens(file).join(" "));
      if (/salary calc/i.test(file)) return r("other", tokens(file).join(" "));
      if (/account opening/i.test(file)) return r("other", tokens(file).join(" "));
      return { skip: true, reason: "not a person's document" };
    }
    if (/^Employee's documents$/i.test(sub)) {
      if (rest.length < 3) return { skip: true, reason: "no file" };
      const who = tokens(rest[1], true).join(" ");
      const t = checklistTypeFor(base);
      return { type: t || "other", person: who, dept: "", hintDoctor: /(^|\W)dr\b/i.test(rest[1]) };
    }
    if (/^Behavioural Complaints$/i.test(sub)) return { type: "complaint", person: tokens(rest[1] || "").join(" "), dept: "", hintDoctor };
    if (/^Offer letters$/i.test(sub) || /^Staff Offer Letters$/i.test(sub)) {
      if (TEMPLATE_NAME.test(base) || /^(doctor|therapist|pharmacist)s?\s+offer\s+letter/i.test(base.replace(/^\d+\.\s*/, "")) || /\[A_C Priv\.\]/i.test(base) || /^(front ?desk executive)/i.test(base))
        return { skip: true, reason: "blank template, not a person's letter" };
      if (/addendum/i.test(base) && !/^\w+[ .]*\w*_?\s*addendum/i.test(base)) return { skip: true, reason: "general addendum" };
      const person = /^Oct'26/i.test(rest[1] || "") || rest.length >= 2 ? tokens(base.replace(/^\d+\.\s*/, "")).join(" ") : tokens(base).join(" ");
      const dept = rest.length >= 3 ? rest[1].replace(/^Oct'26 Onwards$/i, "").replace(/^Frontdesk$/i, "Front Desk") : "";
      return r("offer_letter", person, dept);
    }
    const map = { "Increment Letters": "increment_letter", "Experience Certificate": "experience_certificate", "Releiving Letter": "relieving_letter",
      "Resignation Letters": "resignation_letter", "Full & Final Settlement": "fnf_settlement" };
    const key = Object.keys(map).find((k) => k.toLowerCase() === sub.toLowerCase());
    if (key) {
      // "Therapist/Akshita Increment Letter.docx", "Bhavita/Bhavita Full & Final ...docx", "Mamatha Releiving Letter.docx"
      return r(map[key], tokens(base).join(" "), rest.length >= 3 && key === "Increment Letters" ? rest[1] : "");
    }
    if (/^Format for employee Bank/i.test(file)) return r("other", "");
    return { skip: true, reason: "not sorted" };
  }
  return { skip: true, reason: "not sorted" };
}

// ---- matching names to people ----
const lev = (a, b) => {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let x = 1; x <= m; x++) { const cur = [x]; for (let y = 1; y <= n; y++) cur[y] = Math.min(prev[y] + 1, cur[y - 1] + 1, prev[y - 1] + (a[x - 1] === b[y - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
};
const sim = (a, b) => (a === b ? 1 : 1 - lev(a, b) / Math.max(a.length, b.length));
const similar = (a, b) => sim(a, b) >= 0.8 || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

/** guess "akshitha" / "sara kakhanchuiliu phaomei" -> { userId | null, candidates: [userId...] } among users [{id,name,designation}] */
export function matchPerson(guess, users, hintDoctor = false) {
  const g = String(guess || "").split(/\s+/).filter(Boolean);
  if (!g.length) return { userId: null, candidates: [] };
  const scored = [];
  for (const u of users) {
    const ut = tokens(u.name);
    if (!ut.length) continue;
    let matched = 0;
    for (const w of g) if (ut.some((x) => similar(w, x))) matched++;
    if (matched === g.length) scored.push({ u, cover: matched / ut.length, drLike: /(^|\W)dr\b|doctor|dermat/i.test(`${u.name} ${u.designation || ""}`) });
  }
  if (!scored.length) return { userId: null, candidates: [] };
  let pool = scored;
  if (hintDoctor) { const d = pool.filter((s) => s.drLike); if (d.length) pool = d; }
  else if (pool.length > 1) { const nd = pool.filter((s) => !s.drLike); if (nd.length) pool = nd; }
  pool.sort((a, b) => b.cover - a.cover);
  const best = pool[0];
  const unique = pool.length === 1 || best.cover - pool[1].cover > 0.3;
  return { userId: unique ? best.u.id : null, candidates: pool.map((s) => s.u.id) };
}

export const mimeFor = (name) => ({ pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })[String(name).split(".").pop().toLowerCase()] || "application/octet-stream";
