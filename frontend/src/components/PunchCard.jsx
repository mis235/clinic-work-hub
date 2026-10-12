import { useEffect, useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";

const fmtTime = (t) => (t ? new Date(t.replace(" ", "T") + "Z").toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "—");

// One-tap attendance: works on any phone, no fingerprint hardware needed.
export default function PunchCard() {
  const [today, setToday] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = () => api.attendanceToday().then(setToday).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  function getPosition() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition((p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }), () => resolve(null), { timeout: 4000, maximumAge: 60000 });
    });
  }

  async function punch() {
    setBusy(true); setErr(""); setMsg("");
    try {
      const pos = await getPosition(); // optional -- attendance is recorded even if location is blocked
      const r = await api.attendancePunch(pos || {});
      setMsg(r.duplicate ? "Already recorded a moment ago." : r.type === "check_in" ? "You are checked in. Have a great shift!" : "You are checked out. See you next time!");
      await load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (!today) return err ? <div className="login-error">{err}</div> : null;
  const next = today.next;
  const inNow = next === "check_out";
  return (
    <div className="card punch-card">
      <div className="card-head">
        <div><span className="name">Attendance</span><span className="dept">{inNow ? "You are checked in" : today.records.length ? "You are checked out" : "Not checked in yet today"}</span></div>
      </div>
      {err && <div className="login-error" style={{ marginBottom: 10 }}>{err}</div>}
      {msg && <div className="note" style={{ marginBottom: 12 }}>{msg}</div>}
      <button className={`btn ${inNow ? "btn-outline" : "btn-primary"}`} style={{ width: "100%", padding: "14px 18px", fontSize: 15 }} disabled={busy} onClick={punch}>
        <Icon name={inNow ? "logout" : "check"} size={18} /> {busy ? "Saving…" : inNow ? "Check out" : "Check in"}
      </button>
      {today.records.length > 0 && (
        <div className="meta" style={{ marginTop: 10 }}>
          Today: {today.records.map((r) => `${r.type === "check_in" ? "In" : "Out"} ${fmtTime(r.recorded_at)}`).join(" · ")}
        </div>
      )}
    </div>
  );
}
