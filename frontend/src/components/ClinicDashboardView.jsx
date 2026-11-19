import { useEffect, useRef, useState } from "react";
import LiveNumbers from "./LiveNumbers.jsx";
import Icon from "./Icon.jsx";

const BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? "" : "http://localhost:4000");
const head = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

// The full Clinic Analysis dashboard (all sections, same look and words) inside the app.
export default function ClinicDashboardView({ user }) {
  const [info, setInfo] = useState(null), [html, setHtml] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false), file = useRef(null);
  const isAdmin = user.role === "admin";
  const [auto, setAuto] = useState(null), [show, setShow] = useState(false), [url, setUrl] = useState(""), [msg, setMsg] = useState("");
  const openAuto = async () => { setShow(!show); if (!auto) { const a = await (await fetch(`${BASE}/api/clinic-dashboard/auto`, { headers: head() })).json(); setAuto(a); setUrl(a.sourceUrl || ""); } };
  const saveAuto = async (pullNow) => {
    setMsg("Working…");
    const r = await fetch(`${BASE}/api/clinic-dashboard/auto`, { method: "POST", headers: { ...head(), "Content-Type": "application/json" }, body: JSON.stringify({ sourceUrl: url, pullNow }) });
    const j = await r.json().catch(() => ({})); setMsg(r.ok ? (pullNow ? "Updated now." : "Saved.") : j.error || "Failed");
    if (r.ok && pullNow) { setHtml(""); load(); }
  };
  const pushUrl = auto ? `${location.origin}/api/clinic-dashboard/push?key=${auto.key}` : "";
  const autoCard = show && auto && (
    <div className="card cdv-auto">
      <b>Automatic update</b>
      <label className="meta">1. Address where your nightly job saves the file (the app checks it every 3 hours)</label>
      <div className="cdv-row"><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /><button className="btn btn-primary btn-sm" onClick={() => saveAuto(false)}>Save</button><button className="btn btn-ghost btn-sm" onClick={() => saveAuto(true)}>Update now</button></div>
      <label className="meta">2. Or let the nightly job send the file to this private address</label>
      <div className="cdv-row"><input className="input" readOnly value={pushUrl} onFocus={(e) => e.target.select()} /><button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(pushUrl)}>Copy</button></div>
      <span className="meta">{auto.status ? auto.status.replace(/^ok /, "Last checked ").replace(/T.*/, "") : ""} {msg}</span>
    </div>);
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
      {isAdmin && <div className="cdv-bar"><span className="meta">Updated {new Date(info.updatedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span><button className="btn btn-ghost btn-sm" onClick={openAuto}>Auto-update</button><button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => file.current.click()}>{busy ? "Replacing…" : "Replace file"}</button>{picker}{err && <span className="note warn">{err}</span>}</div>}
      {autoCard}
      {html ? <iframe title="Clinic dashboard" className="cdv-frame" srcDoc={html} sandbox="allow-scripts allow-same-origin allow-modals allow-downloads allow-popups" /> : <div className="empty">Loading…</div>}
    </div>
  );
}
