import { useEffect, useState } from "react";
import { navItemsFor } from "../navItems.js";
import { api } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";

function linkify(text) {
  return String(text).split(/(https?:\/\/\S+)/g).map((part, i) => /^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noreferrer" style={{ color: "var(--primary)", fontWeight: 600 }}>Open Document ↗</a> : part);
}

export default function PoliciesPage({ user, isStaffLayout, onLogout, onBack, mode = "policies" }) {
  const isSop = mode === "sops", label = isSop ? "SOPs" : "Policies";
  const [policies, setPolicies] = useState(null);
  const [open, setOpen] = useState(null);
  const [bulk, setBulk] = useState(false), [bulkText, setBulkText] = useState(""), [bulkMsg, setBulkMsg] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  const refresh = () => api.listPolicies().then((all) => setPolicies(all.filter((x) => /sop|procedure/i.test(x.category + " " + x.title) === isSop))).catch(() => setPolicies([]));
  useEffect(() => { refresh(); }, []);

  async function acknowledge(id) {
    await api.acknowledgePolicy(id);
    refresh();
  }

  const unread = policies?.filter((p) => !p.acknowledgedByMe).length || 0;

  const body = (
    <>
      <div className="page-head">
        <h1>{label}</h1>
        {user.role === "admin" && <button className="btn btn-outline btn-sm" style={{ float: "right" }} onClick={() => setBulk((b) => !b)}>Bulk Add From List</button>}
        {bulk && (
          <div className="card" style={{ margin: "12px 0" }}>
            <div className="meta" style={{ marginBottom: 6 }}>One document per line: <b>Category | Title | Link</b>. Use a category such as "SOP — Front Desk" for SOPs. Existing titles are skipped.</div>
            <textarea className="field" rows={8} value={bulkText} onChange={(e) => setBulkText(e.target.value)} style={{ fontFamily: "monospace", fontSize: 13 }} placeholder="SOP — Front Desk | Appointment Rescheduling SOP | https://drive.google.com/file/d/…/view" />
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
              <button className="btn btn-primary" onClick={async () => {
                const items = bulkText.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p.length >= 3 && /^https?:\/\//i.test(p[2])).map(([category, title, url]) => ({ category, title, url }));
                try { const r = await api.bulkAddPolicies(items); setBulkMsg(`${r.added} added, ${r.skipped} skipped.`); setBulkText(""); refresh(); } catch (e) { setBulkMsg(e.message); }
              }}>Add Documents</button><span className="meta">{bulkMsg}</span></div>
          </div>)}
        <p>{unread > 0 ? `${unread} ${unread === 1 ? "document needs" : "documents need"} your acknowledgement.` : `You are up to date on all current ${label}.`}</p>
      </div>

      {policies === null && <div className="empty">Loading…</div>}
      {policies?.length === 0 && <div className="empty">{isSop ? "No SOPs have been added yet. Add a document with the category \"SOP\" and it will appear here." : "No policies have been added yet."}</div>}

      {policies?.map((p) => (
        <div key={p.id} className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setOpen(open === p.id ? null : p.id)}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{p.title}</span>
              <span style={{ fontSize: 11.5, color: "var(--ink-soft)", marginLeft: 8 }}>{p.category} · v{p.version}</span>
            </div>
            <span className={`badge ${p.acknowledgedByMe ? "done" : "sent"}`}>{p.acknowledgedByMe ? "Acknowledged" : "Needs Review"}</span>
          </div>
          {open === p.id && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
              <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, lineHeight: 1.6, margin: 0 }}>{linkify(p.body)}</pre>
              {!p.acknowledgedByMe && (
                <button className="btn btn-primary btn-sm" style={{ marginTop: 14 }} onClick={() => acknowledge(p.id)}>I Have Read This</button>
              )}
            </div>
          )}
        </div>
      ))}
    </>
  );

  if (isStaffLayout) {
    // Rendered inline within the staff dashboard's existing sidebar shell
    return <div style={{ marginTop: 8 }}>{body}</div>;
  }

  return (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active={label}
        onSelect={(item) => item !== label && onBack(item)}
        who={`${user.name} · ${user.role === "admin" ? "Admin" : "Manager"}`} onLogout={onLogout}
        mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="main">
        <MobileTopBar title={label} onOpenMenu={() => setMobileOpen(true)} />
        {body}
      </div>
    </div>
  );
}
