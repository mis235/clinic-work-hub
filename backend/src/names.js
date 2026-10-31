// Tidy names so they look professional: "NAGA LAKSHMI" / "naga lakshmi" -> "Naga Lakshmi".
// Names typed with mixed capitals are left alone (people know how their own name is written).
const KEEP_UPPER = new Set(["HR", "MIS", "COS", "COE", "IT", "CEO", "COO", "CFO", "MD", "BDS", "MBBS", "MDS", "MS", "DNB", "RMO", "OT", "PRO", "AI"]);
const SMALL = new Set(["and", "of", "the", "in", "for", "to", "&"]);
const isShouting = (s) => s === s.toUpperCase() && s !== s.toLowerCase();
const isLower = (s) => s === s.toLowerCase() && s !== s.toUpperCase();
const cap = (w) => w.replace(/^([\p{L}])([\p{L}'’]*)/u, (_, a, b) => a.toUpperCase() + b.toLowerCase());

function titleCase(str, { acronyms }) {
  return str.split(" ").map((w, i) => {
    const bare = w.replace(/[.,]/g, "");
    if (/^dr\.?$/i.test(w)) return "Dr.";
    if (acronyms && KEEP_UPPER.has(bare.toUpperCase())) return w.toUpperCase();
    if (acronyms && i > 0 && SMALL.has(bare.toLowerCase())) return w.toLowerCase();
    if (w.includes("-")) return w.split("-").map(cap).join("-");
    return cap(w);
  }).join(" ");
}

export function properName(s) {
  const t = String(s ?? "").trim().replace(/\s+/g, " ");
  if (!t) return t;
  return isShouting(t) || isLower(t) ? titleCase(t, { acronyms: false }) : t;
}
export function properTitle(s) {
  const t = String(s ?? "").trim().replace(/\s+/g, " ");
  if (!t) return t;
  return isShouting(t) || isLower(t) ? titleCase(t, { acronyms: true }) : t;
}

// One-time tidy of names already saved (safe to run on every start; only touches shouting or all-lowercase text).
export function tidyExistingNames(db) {
  const rows = db.prepare("SELECT id, name, designation FROM users").all();
  const upd = db.prepare("UPDATE users SET name = ?, designation = ? WHERE id = ?");
  let n = 0;
  for (const r of rows) {
    const nm = properName(r.name), ds = r.designation ? properTitle(r.designation) : r.designation;
    if (nm !== r.name || ds !== r.designation) { upd.run(nm, ds, r.id); n++; }
  }
  return n;
}
