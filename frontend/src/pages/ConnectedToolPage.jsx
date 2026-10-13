import { useEffect, useState } from "react";
import { api } from "../api.js";
import PageShell from "../components/PageShell.jsx";

// Shows an external tool (clinic chatbot, dashboards) inside the app. Admin can change the address here.
export default function ConnectedToolPage({ toolKey, active, user, isStaffLayout, onLogout, onBack }) {
  const [link, setLink] = useState(null);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  const [check, setCheck] = useState(null); // result of the server-side connection test
  const load = () => api.listLinks().then((l) => { const x = l.find((r) => r.key === toolKey); setLink(x || false); setUrl(x?.url || ""); }).catch(() => setLink(false));
  useEffect(() => { load(); setCheck(null); api.checkLink(toolKey).then(setCheck).catch(() => setCheck({ reachable: false, reason: "Could not run the test" })); }, [toolKey]);

  async function save() {
    try { await api.setLink(toolKey, { url, title: link.title }); setEditing(false); setErr(""); load(); } catch (e) { setErr(e.message); }
  }
  const insecure = link && link.url.startsWith("http://") && window.location.protocol === "https:";

  return (
    <PageShell user={user} active={active} title={link?.title || active} isStaffLayout={isStaffLayout} onLogout={onLogout} onBack={onBack}>
      <div className="page-head row">
        <div><div className="eyebrow">Connected tool</div><h1>{link?.title || active}</h1>
          <p>Runs inside the Work Hub so everything is in one place.</p></div>
        <div style={{ display: "flex", gap: 8 }}>
          {link && <a className="btn btn-outline" href={link.url} target="_blank" rel="noreferrer">Open in new tab</a>}
          {user.role === "admin" && <button className="btn btn-ghost" onClick={() => setEditing((x) => !x)}>Change address</button>}
        </div>
      </div>
      {editing && (
        <div className="card">
          <label className="field-label" style={{ marginTop: 0 }}>Address (URL)</label>
          <input className="field" value={url} onChange={(e) => setUrl(e.target.value)} />
          {err && <div className="login-error" style={{ marginTop: 10 }}>{err}</div>}
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}><button className="btn btn-primary btn-sm" onClick={save}>Save</button><button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button></div>
        </div>)}
      {link === null && <div className="empty">Loading…</div>}
      {link === false && <div className="empty">This tool is not set up yet.</div>}
      {check && (
        <div className={`note ${check.reachable && check.canEmbed ? "" : "warn"}`}>
          {!check.reachable && <>❌ <b>Not connected.</b> This computer cannot reach {link?.url} ({check.reason}). Check that the chatbot/dashboard server is running and the address is right{user.role === "admin" ? " (use “Change address”)" : ""}.</>}
          {check.reachable && !check.canEmbed && <>⚠️ <b>Connected, but it will not show inside the app</b> — that site blocks being embedded. Press “Open in new tab”.</>}
          {check.reachable && check.canEmbed && <>✅ <b>Connected.</b></>}
        </div>
      )}
      {insecure && <div className="note warn">This app is on https but the tool address is http, so the browser will block showing it here. Use “Open in new tab”, or give the tool an https address.</div>}
      {link && !insecure && check?.reachable && check?.canEmbed && (
        <>
          <iframe title={link.title} src={link.url} style={{ width: "100%", height: "calc(100vh - 260px)", minHeight: 480, border: "1px solid var(--line)", borderRadius: 16, background: "#fff" }} allow="clipboard-write; microphone" />
        </>
      )}
    </PageShell>
  );
}
