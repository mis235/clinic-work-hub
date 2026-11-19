import { useEffect, useRef, useState } from "react";
import LiveNumbers from "./LiveNumbers.jsx";
import Icon from "./Icon.jsx";

const BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? "" : "http://localhost:4000");
const head = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

// The full Clinic Analysis dashboard (all sections, same look and words) inside the app.
export default function ClinicDashboardView({ user }) {
  const [info, setInfo] = useState(null), [html, setHtml] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false), file = useRef(null);
  const isAdmin = user.role === "admin";
  const load = async () => {
    try {
      const i = await (await fetch(`${BASE}/api/clinic-dashboard/info`, { headers: head() })).json(); setInfo(i);
      if (i.exists) { window.dispatchEvent(new CustomEvent("hub-search-mode", { detail: "none" })); const r = await fetch(`${BASE}/api/clinic-dashboard`, { headers: head() }); setHtml(await r.text()); }
    } catch { setErr("Could not load the dashboard. Please try again."); setInfo({ exists: false }); }
  };
  useEffect(() => { const t = setInterval(() => window.dispatchEvent(new CustomEvent("hub-search-mode", { detail: "none" })), 400); setTimeout(() => clearInterval(t), 4000); load(); return () => clearInterval(t) || void 0; }, []);
  useEffect(() => { return () => window.dispatchEvent(new CustomEvent("hub-search-mode", { detail: "pages" })); }, []);
  const upload = async (f) => {
    if (!f) return; setBusy(true); setErr("");
    try {
      const r = await fetch(`${BASE}/api/clinic-dashboard`, { method: "POST", headers: { ...head(), "Content-Type": "text/html" }, body: await f.text() });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Upload failed");
      setHtml(""); await load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const picker = <input ref={file} type="file" accept=".html,text/html" hidden onChange={(e) => { upload(e.target.files[0]); e.target.value = ""; }} />;

  if (!info) return <div className="empty">Loading…</div>;
  if (!info.exists) return (
    <div>
      {isAdmin && (
        <div className="card cdv-add">
          <b>Add the dashboard file</b>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => file.current.click()}><Icon name="plus" size={14} /> {busy ? "Adding…" : "Choose file"}</button>
          {picker}{err && <span className="note warn">{err}</span>}
        </div>)}
      <LiveNumbers user={user} />
    </div>
  );
  return (
    <div className="cdv">
      {isAdmin && <div className="cdv-bar"><span className="meta">Updated {new Date(info.updatedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span><button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => file.current.click()}>{busy ? "Replacing…" : "Replace file"}</button>{picker}{err && <span className="note warn">{err}</span>}</div>}
      {html ? <iframe title="Clinic dashboard" className="cdv-frame" srcDoc={html} sandbox="allow-scripts allow-same-origin allow-modals allow-downloads allow-popups" /> : <div className="empty">Loading…</div>}
    </div>
  );
}
