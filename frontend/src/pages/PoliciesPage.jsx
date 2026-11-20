import { useEffect, useState } from "react";
import { navItemsFor } from "../navItems.js";
import { api } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";

function linkify(text) {
  return String(text).split(/(https?:\/\/\S+)/g).map((part, i) => /^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noreferrer" style={{ color: "var(--primary)", fontWeight: 600 }}>Open Document ↗</a> : part);
}

// Small reader for the SOP text: headings, bullets, tables and **bold**.
function inline(t) { return String(t).split(/(\*\*[^*]+\*\*)/g).map((x, i) => /^\*\*[^*]+\*\*$/.test(x) ? <b key={i}>{x.slice(2, -2)}</b> : x); }
function Body({ text }) {
  const lines = String(text).split("\n"), out = []; let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|/.test(l)) {
      const rows = []; while (i < lines.length && /^\s*\|/.test(lines[i])) { if (!/^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(lines[i])) rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim())); i++; }
      const head = rows[0] || [];
      out.push(<div key={i} style={{ overflowX: "auto", margin: "8px 0" }}><table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}><thead><tr>{head.map((c, j) => <th key={j} style={{ textAlign: "left", padding: "6px 8px", background: "var(--primary-soft, #f1ecfb)", border: "1px solid var(--line)" }}>{inline(c)}</th>)}</tr></thead><tbody>{rows.slice(1).map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} style={{ padding: "6px 8px", border: "1px solid var(--line)", verticalAlign: "top" }}>{inline(c)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^\s*[*-] /.test(l)) { const items = []; while (i < lines.length && /^\s*[*-] /.test(lines[i])) { items.push(lines[i].replace(/^\s*[*-] /, "")); i++; } out.push(<ul key={i} style={{ margin: "6px 0 6px 18px", padding: 0 }}>{items.map((t, k) => <li key={k} style={{ marginBottom: 3 }}>{inline(t)}</li>)}</ul>); continue; }
    if (/^#{2,4} /.test(l)) { out.push(<div key={i} style={{ fontWeight: 700, margin: "12px 0 4px" }}>{inline(l.replace(/^#+ /, ""))}</div>); i++; continue; }
    if (!l.trim()) { i++; continue; }
    out.push(<p key={i} style={{ margin: "6px 0" }}>{inline(l)}</p>); i++;
  }
  return <div style={{ fontSize: 13, lineHeight: 1.6 }}>{out}</div>;
}
const ORDER = ["SOP — General · Organisation", "SOP — Front Office · Overview & Rules", "SOP — Front Office · Role Charters", "SOP — Front Office · Daily Operations", "SOP — Front Desk"];
const rank = (c) => { const i = ORDER.indexOf(c); return i < 0 ? (/Governance/.test(c) ? 90 : 50) : i; };
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

export default function PoliciesPage({ user, isStaffLayout, onLogout, onBack, mode = "policies" }) {
  const isSop = mode === "sops", label = isSop ? "SOPs" : "Policies";
  const [policies, setPolicies] = useState(null);
  const [open, setOpen] = useState(null);
  const [bulk, setBulk] = useState(false), [bulkText, setBulkText] = useState(""), [bulkMsg, setBulkMsg] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  const refresh = () => api.listPolicies().then((all) => setPolicies(all.filter((x) => /sop|procedure/i.test(x.category + " " + x.title) === isSop).sort((a, b) => rank(a.category) - rank(b.category) || natural(a.category, b.category) || natural(a.title, b.title)))).catch(() => setPolicies([]));
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
      </div>

      {policies === null && <div className="empty">Loading…</div>}
      {policies?.length === 0 && <div className="empty">{isSop ? "No SOPs have been added yet. Add a document with the category \"SOP\" and it will appear here." : "No policies have been added yet."}</div>}

      {policies?.map((p, idx) => (
        <div key={p.id}>
          {(idx === 0 || policies[idx - 1].category !== p.category) && <div className="section-head" style={{ margin: "18px 0 8px", fontWeight: 800, fontSize: 15 }}>{p.category.replace(/^SOP — /, "")}</div>}
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setOpen(open === p.id ? null : p.id)}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{p.title}</span>
              <span style={{ fontSize: 11.5, color: "var(--ink-soft)", marginLeft: 8 }}>v{p.version}</span>{p.forMyRole && <span className="badge sent" style={{ marginLeft: 8 }}>For your role</span>}
            </div>
            <span className={`badge ${p.acknowledgedByMe ? "done" : "sent"}`}>{p.acknowledgedByMe ? "Acknowledged" : "Needs Review"}</span>
          </div>
          {open === p.id && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
              {/https?:\/\//.test(p.body) ? <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, lineHeight: 1.6, margin: 0 }}>{linkify(p.body)}</pre> : <Body text={p.body} />}
              {!p.acknowledgedByMe && (
                <button className="btn btn-primary btn-sm" style={{ marginTop: 14 }} onClick={() => acknowledge(p.id)}>I Have Read This</button>
              )}
            </div>
          )}
        </div>
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
