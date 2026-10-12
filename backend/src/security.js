// Production safety helpers: security headers + login throttling. No extra dependencies.

// Basic hardening headers (a small subset of what "helmet" sets).
export function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), geolocation=(self), microphone=()");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  next();
}

// Login throttle: after MAX failures for the same person+IP, block for WINDOW_MS.
// Stops someone guessing a 4-digit staff PIN (10,000 combinations) by brute force.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 6;
const fails = new Map(); // key -> { count, first }

const keyFor = (req) => {
  const b = req.body || {};
  const who = String(b.email || b.userId || "?").toLowerCase();
  return `${req.ip}|${who}`;
};

export function loginThrottle(req, res, next) {
  const k = keyFor(req);
  const rec = fails.get(k);
  if (rec && Date.now() - rec.first > WINDOW_MS) fails.delete(k);
  const cur = fails.get(k);
  if (cur && cur.count >= MAX_FAILS) {
    const mins = Math.ceil((WINDOW_MS - (Date.now() - cur.first)) / 60000);
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` });
  }
  // Count a failure when the response is 401.
  res.on("finish", () => {
    if (res.statusCode === 401) {
      const r = fails.get(k);
      if (r) r.count++; else fails.set(k, { count: 1, first: Date.now() });
    } else if (res.statusCode === 200) {
      fails.delete(k);
    }
  });
  next();
}

// Periodic cleanup so the map can't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of fails) if (now - v.first > WINDOW_MS) fails.delete(k);
}, 10 * 60 * 1000).unref();

export function checkEnv() {
  const problems = [];
  if (!process.env.JWT_SECRET) problems.push("JWT_SECRET is not set (needed to sign logins).");
  else if (process.env.NODE_ENV === "production" && process.env.JWT_SECRET.length < 24) problems.push("JWT_SECRET is too short (use 24+ characters).");
  return problems;
}
