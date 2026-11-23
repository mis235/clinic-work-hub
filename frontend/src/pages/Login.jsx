import { useEffect, useState } from "react";
import { api } from "../api.js";
import Doll from "../components/Doll.jsx";

// Small "phone check" line: when something fails on a phone, a screenshot of this tells us exactly what.
function PhoneCheck() {
  const [st, setSt] = useState("checking…"), [err, setErr] = useState("");
  useEffect(() => {
    const f = (e) => setErr(String(e.message || e.reason?.message || e.reason || "error").slice(0, 120));
    window.addEventListener("error", f); window.addEventListener("unhandledrejection", f);
    const t = setTimeout(() => setSt("no answer"), 8000);
    fetch("/health", { cache: "no-store" }).then((r) => { clearTimeout(t); setSt(r.ok ? "server OK" : "server " + r.status); }).catch((e) => { clearTimeout(t); setSt("cannot reach server (" + (e.message || "network") + ")"); });
    return () => { window.removeEventListener("error", f); window.removeEventListener("unhandledrejection", f); clearTimeout(t); };
  }, []);
  const ver = (navigator.userAgent.match(/OS (\d+[_\d]*)/) || [])[1];
  const id = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "";
  return <div style={{ textAlign: "center", marginTop: 10, fontSize: 11, color: "#8a7ca0", lineHeight: 1.5 }}>Phone check: {st}{ver ? " · iOS " + ver.replace(/_/g, ".") : ""} · v{id.slice(-6)}{err && <div style={{ color: "#b3261e" }}>Error: {err}</div>}</div>;
}

function detectDeviceLabel() {
  const ua = navigator.userAgent;
  const platform = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Win/.test(ua) ? "Windows" : "Unknown";
  const isPWA = window.matchMedia?.("(display-mode: standalone)")?.matches;
  return `${platform} · ${isPWA ? "PWA" : "Browser"}`;
}

export default function Login({ onLoggedIn }) {
  const [tab, setTab] = useState(() => { try { return localStorage.getItem("lastTab") || "pin"; } catch { return "pin"; } }); // 'password' (admin/manager) | 'pin' (staff, mobile-friendly)
  const [roster, setRoster] = useState([]);
  const [userId, setUserId] = useState("");
  const [pin, setPin] = useState("");
  const [find, setFind] = useState("");
  const [email, setEmail] = useState(() => { try { return localStorage.getItem("lastEmail") || ""; } catch { return ""; } });
  const [password, setPassword] = useState("");
  const [error, setError] = useState(() => { try { const m = sessionStorage.getItem("sessionMsg"); sessionStorage.removeItem("sessionMsg"); return m || ""; } catch { return ""; } });
  const [busy, setBusy] = useState(false), [win, setWin] = useState(false);
  const mood = win ? "celebrate" : busy ? "thinking" : error ? "wrong" : "hello"; // she reacts to the sign-in

  useEffect(() => {
    api.listRoster().then((rows) => {
      setRoster(rows);
      let last = ""; try { last = localStorage.getItem("lastUserId") || ""; } catch {}
      setUserId(rows.find((r) => r.id === last)?.id || rows[0]?.id || "");
    }).catch(() => setError("Couldn't reach the server. Is the backend running?"));
  }, []);

  async function submit() {
    setError("");
    setBusy(true);
    try {
      const body = tab === "password"
        ? { email: email.trim(), password, deviceLabel: detectDeviceLabel(), channel: "web" }
        : { userId, pin, deviceLabel: detectDeviceLabel(), channel: "web" };
      const data = await api.login(body);
      try { localStorage.setItem("lastTab", tab); if (tab === "password") localStorage.setItem("lastEmail", email); else localStorage.setItem("lastUserId", userId); } catch {}
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      setWin(true);
      setTimeout(() => onLoggedIn(data.user), 750);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const activeCount = roster.length;
  const deptCount = new Set(roster.map((u) => u.department)).size;

  return (
    <div className="login-wrap">
      <div className="login-hero">
        <div className="login-portrait">
          <img src="/clinic/dr-nishita.png" alt="Dr. Nishita Ranka" />
          <div>Dr. Nishita Ranka<small>Founder & Medical Director</small></div>
        </div>
        <div className="login-hero-top">
          <img src="/logo.png" alt="Dr. Nishita's Clinic" className="login-hero-logo" />
          <span className="name">Dr. Nishita's Clinic</span>
        </div>

        <div className="login-hero-mid">
          <div className="login-hero-eyebrow">Internal Work Hub · Dr. Nishita's Clinic</div>
          {tab === "password" ? (
            <h1>Dr. Nishita's Clinic,<br /><em>every task and every team</em>, one place.</h1>
          ) : (
            <h1>Your tasks,<br /><em>your checklist</em>, today.</h1>
          )}
          <p>
            One sign-in for every device — phone, tablet, or desktop. Tasks, attendance,
            payroll, and policies all stay in sync, wherever your day takes you.
          </p>
        </div>

        <div className="login-hero-bottom">
          <div className="login-hero-stat">
            <div className="n">{activeCount || "19"}</div>
            <div className="l">Team members</div>
          </div>
          <div className="login-hero-stat">
            <div className="n">{deptCount || "—"}</div>
            <div className="l">Departments</div>
          </div>
        </div>
      </div>

      <div className="login-panel">
        <div className="login-card">
          <div className="login-lean"><Doll mood={mood} size={250} /></div>
          <div className="login-eyebrow">Staff sign-in</div>
          <h1>Welcome Back</h1>
          <p className="sub">Sign in to see your tasks, checklists and what's happening at the clinic today.</p>

          <div className="tab-switch">
            <button type="button" className={tab === "pin" ? "active" : ""} onClick={() => setTab("pin")} onTouchEnd={(e) => { e.preventDefault(); setTab("pin"); }}>Name & PIN</button>
            <button type="button" className={tab === "password" ? "active" : ""} onClick={() => setTab("password")} onTouchEnd={(e) => { e.preventDefault(); setTab("password"); }}>Email & password</button>
          </div>

          {error && <div className="login-error">{error}</div>}

          {tab === "password" ? (
            <>
              <label className="field-label">Email</label>
              <input className="field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@drnishitaranka.com" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
              <label className="field-label">Password</label>
              <input className="field" type="password" autoComplete="current-password" autoCapitalize="none" autoCorrect="off" value={password} onChange={(e) => setPassword(e.target.value)} />
            </>
          ) : (
            <>
              <label className="field-label">Your Name</label>
              <input className="field" style={{ fontSize: 16 }} value={find} onChange={(e) => setFind(e.target.value)} placeholder="Type your name to search" autoComplete="off" autoCapitalize="off" />
              <div className="roster-list" style={{ maxHeight: 190, overflowY: "auto", WebkitOverflowScrolling: "touch", margin: "8px 0", border: "1px solid var(--line, #eed)", borderRadius: 14 }}>
                {roster.filter((u) => !find.trim() || u.name.toLowerCase().includes(find.trim().toLowerCase())).map((u) => (
                  <button type="button" key={u.id} onClick={() => { setUserId(u.id); setFind(""); }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 14px", fontSize: 16, border: 0, borderBottom: "1px solid rgba(0,0,0,.05)", cursor: "pointer",
                      background: u.id === userId ? "var(--primary-soft, #fbe3f1)" : "transparent", fontWeight: u.id === userId ? 700 : 400, color: "inherit" }}>
                    {u.id === userId ? "✓ " : ""}{u.name} — {u.department}{u.role === "manager" ? " (Manager)" : ""}
                  </button>))}
              </div>
              <div className="meta" style={{ marginBottom: 6 }}>Signing in as: <b>{roster.find((u) => u.id === userId)?.name || "—"}</b></div>
              <label className="field-label">4-digit PIN</label>
              <input className="field" style={{ fontSize: 16 }} type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value)} />
            </>
          )}

          <div style={{ height: 22 }} />
          <button className="btn btn-primary btn-brass" style={{ width: "100%" }} disabled={busy} onClick={submit}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <div style={{ textAlign: "center", marginTop: 14 }}><a href="/install" className="meta" style={{ textDecoration: "underline" }}>Install the app on your phone</a></div>
          <PhoneCheck />
        </div>
      </div>
    </div>
  );
}
