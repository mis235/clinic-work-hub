import { useEffect, useState } from "react";
import { api } from "../api.js";

function detectDeviceLabel() {
  const ua = navigator.userAgent;
  const platform = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Win/.test(ua) ? "Windows" : "Unknown";
  const isPWA = window.matchMedia?.("(display-mode: standalone)")?.matches;
  return `${platform} · ${isPWA ? "PWA" : "Browser"}`;
}

export default function Login({ onLoggedIn }) {
  const [tab, setTab] = useState("password"); // 'password' (admin/manager) | 'pin' (staff, mobile-friendly)
  const [roster, setRoster] = useState([]);
  const [userId, setUserId] = useState("");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(() => { try { const m = sessionStorage.getItem("sessionMsg"); sessionStorage.removeItem("sessionMsg"); return m || ""; } catch { return ""; } });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listRoster().then((rows) => {
      setRoster(rows);
      if (rows[0]) setUserId(rows[0].id);
    }).catch(() => setError("Couldn't reach the server. Is the backend running?"));
  }, []);

  async function submit() {
    setError("");
    setBusy(true);
    try {
      const body = tab === "password"
        ? { email, password, deviceLabel: detectDeviceLabel(), channel: "web" }
        : { userId, pin, deviceLabel: detectDeviceLabel(), channel: "web" };
      const data = await api.login(body);
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      onLoggedIn(data.user);
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
        <div className="login-building">
          <img src="/clinic/building.jpg" alt="Dr. Nishita's Clinic building" />
          <div>Dr. Nishita's Clinic</div>
        </div>
        <div className="login-hero-top">
          <img src="/logo.png" alt="Dr. Nishita's Clinic" className="login-hero-logo" />
          <span className="name">Dr. Nishita's Clinic</span>
        </div>

        <div className="login-hero-mid">
          <div className="login-hero-eyebrow">Internal Work Hub</div>
          {tab === "password" ? (
            <h1>Run the clinic<br /><em>with one view</em> of the day.</h1>
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
          <div className="login-hero-stat">
            <div className="n">3</div>
            <div className="l">Clinic entities</div>
          </div>
        </div>
      </div>

      <div className="login-panel">
        <div className="login-card">
          <div className="login-eyebrow">Staff sign-in</div>
          <h1>Welcome back</h1>
          <p className="sub">Sign in to assign tasks, track checklists, and see what's happening across the clinic today.</p>

          <div className="tab-switch">
            <button className={tab === "password" ? "active" : ""} onClick={() => setTab("password")}>Admin / Manager</button>
            <button className={tab === "pin" ? "active" : ""} onClick={() => setTab("pin")}>Staff (PIN)</button>
          </div>

          {error && <div className="login-error">{error}</div>}

          {tab === "password" ? (
            <>
              <label className="field-label">Email</label>
              <input className="field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@drnishitaranka.com" />
              <label className="field-label">Password</label>
              <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </>
          ) : (
            <>
              <label className="field-label">Your name</label>
              <select className="field" value={userId} onChange={(e) => setUserId(e.target.value)}>
                {roster.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} — {u.department}{u.role === "manager" ? " (Manager)" : ""}</option>
                ))}
              </select>
              <label className="field-label">4-digit PIN</label>
              <input className="field" type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value)} />
            </>
          )}

          <div style={{ height: 22 }} />
          <button className="btn btn-primary btn-brass" style={{ width: "100%" }} disabled={busy} onClick={submit}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
