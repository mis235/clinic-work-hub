import { useEffect, useMemo, useRef, useState } from "react";
import { navItemsFor } from "../navItems.js";
import { api } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";
import Buddy from "../components/Buddy.jsx";

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
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

const DEPT_ORDER = ["General", "Front Desk", "Counsellor & Manager", "Therapist", "Pharmacy", "Accounts", "Admin & Management"];
const SUB_ORDER = ["Core SOPs", "Overview & Rules", "Role Charters", "Daily Operations", "Full documents", "Organisation"];
const stripSop = (c) => String(c).replace(/^SOP\s*[—-]\s*/i, "");
function deptOf(c) { const d = stripSop(c).split(" · ")[0].trim(); return d === "Front Office" || d === "Front Desk" ? "Front Desk" : d === "Management" || d === "Admin" ? "Admin & Management" : d || "General"; }
const subOf = (c) => stripSop(c).split(" · ")[1]?.trim() || "Core SOPs";
const fileKind = (p) => p.hasFile ? ((p.file_name || "").split(".").pop() || "file").toUpperCase() : /https?:\/\//.test(p.body) ? "Link" : "Guide";
const LINK_LINE = /\n*Please read it carefully, then tap .*$/i;

export default function PoliciesPage({ user, isStaffLayout, onLogout, onBack, mode = "policies" }) {
  const isSop = mode === "sops", label = isSop ? "SOPs" : "Policies", isAdmin = user.role === "admin";
  const [policies, setPolicies] = useState(null);
  const [open, setOpen] = useState(null), [tab, setTab] = useState(null), [msg, setMsg] = useState("");
  const [bulk, setBulk] = useState(false), [bulkText, setBulkText] = useState(""), [bulkMsg, setBulkMsg] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const fileRef = useRef(null), attachId = useRef(null);

  const refresh = () => api.listPolicies().then((all) => setPolicies(all.filter((x) => /sop|procedure/i.test(x.category + " " + x.title) === isSop))).catch(() => setPolicies([]));
  useEffect(() => { refresh(); }, []);
  async function acknowledge(id) { await api.acknowledgePolicy(id); refresh(); }
  async function attach(f) {
    if (!f || !attachId.current) return; setMsg("");
    try { const fd = new FormData(); fd.append("file", f); await api.attachPolicyFile(attachId.current, fd); await refresh(); setMsg("File saved."); } catch (e) { setMsg(e.message); }
  }
  async function dropFile(p) { if (!window.confirm(`Remove the file from "${p.title}"?`)) return; try { await api.removePolicyFile(p.id); refresh(); } catch (e) { setMsg(e.message); } }
  async function dropPolicy(p) { if (!window.confirm(`Delete "${p.title}" completely? This cannot be undone.`)) return; try { await api.deletePolicy(p.id); setOpen(null); refresh(); } catch (e) { setMsg(e.message); } }

  const depts = useMemo(() => {
    const m = new Map(); (policies || []).forEach((p) => { const d = deptOf(p.category); m.set(d, (m.get(d) || 0) + 1); });
    return [...m.entries()].sort((a, b) => { const ia = DEPT_ORDER.indexOf(a[0]), ib = DEPT_ORDER.indexOf(b[0]); return (ia < 0 ? 50 : ia) - (ib < 0 ? 50 : ib) || a[0].localeCompare(b[0]); });
  }, [policies]);
  const mineCount = (policies || []).filter((p) => p.forMyRole).length;
  const cur = tab ?? (isSop && !isAdmin && mineCount ? "__mine" : "__all");
  const list = (policies || []).filter((p) => cur === "__all" ? true : cur === "__mine" ? p.forMyRole : deptOf(p.category) === cur);
  const groups = useMemo(() => {
    const m = new Map(); list.forEach((p) => { const k = cur === "__all" || cur === "__mine" ? deptOf(p.category) + " · " + subOf(p.category) : subOf(p.category); if (!m.has(k)) m.set(k, []); m.get(k).push(p); });
    const rankD = (k) => { const i = DEPT_ORDER.indexOf(k.split(" · ")[0]); return i < 0 ? 50 : i; };
    const rankS = (k) => { const i = SUB_ORDER.indexOf(k.split(" · ").pop()); return i < 0 ? 40 : i; };
    return [...m.entries()].sort((a, b) => rankD(a[0]) - rankD(b[0]) || rankS(a[0]) - rankS(b[0]) || a[0].localeCompare(b[0])).map(([k, items]) => [k, items.sort((x, y) => natural(x.title, y.title))]);
  }, [policies, cur]);

  const body = (
    <>
      <input ref={fileRef} type="file" hidden onChange={(e) => { attach(e.target.files[0]); e.target.value = ""; }} />
      <div className="sop-hero">
        <div>
          <div className="sop-title">{isSop ? "Step-by-step guides for every team" : "Clinic policies"}</div>
          <div className="sop-sub">{isSop ? "Pick your department, read each SOP here, or download the file." : "Read each policy and confirm."}</div>
          {isAdmin && isSop && <button className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={() => setBulk((b) => !b)}>Add SOP links</button>}
        </div>
        <Buddy mood={policies && !policies.length ? "thinking" : "welcome"} size={112} />
      </div>
      {bulk && (
        <div className="card" style={{ margin: "0 0 14px" }}>
          <div className="meta" style={{ marginBottom: 6 }}>One document per line: <b>Category | Title | Link</b>. Example category: SOP — Therapist. Titles already there are skipped.</div>
          <textarea className="field" rows={6} value={bulkText} onChange={(e) => setBulkText(e.target.value)} style={{ fontFamily: "monospace", fontSize: 13 }} placeholder="SOP — Front Desk | Appointment Rescheduling SOP | https://drive.google.com/file/d/…/view" />
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
            <button className="btn btn-primary" onClick={async () => {
              const items = bulkText.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p.length >= 3 && /^https?:\/\//i.test(p[2])).map(([category, title, url]) => ({ category, title, url }));
              try { const r = await api.bulkAddPolicies(items); setBulkMsg(`${r.added} added, ${r.skipped} skipped.`); setBulkText(""); refresh(); } catch (e) { setBulkMsg(e.message); }
            }}>Add</button><span className="meta">{bulkMsg}</span></div>
        </div>)}

      {isSop && policies?.length > 0 && (
        <div className="pill-row sop-tabs">
          {!isAdmin && mineCount > 0 && <button className={"pill" + (cur === "__mine" ? " active" : "")} onClick={() => setTab("__mine")}>My SOPs <span className="n">{mineCount}</span></button>}
          <button className={"pill" + (cur === "__all" ? " active" : "")} onClick={() => setTab("__all")}>All <span className="n">{policies.length}</span></button>
          {depts.map(([d, n]) => <button key={d} className={"pill" + (cur === d ? " active" : "")} onClick={() => setTab(d)}>{d} <span className="n">{n}</span></button>)}
        </div>)}
      {msg && <div className="meta" style={{ marginBottom: 8 }}>{msg}</div>}

      {policies === null && <div className="empty">Loading…</div>}
      {policies?.length === 0 && <div className="empty"><Buddy mood="thinking" size={88} style={{ margin: "0 auto 10px" }} />{isSop ? "No SOPs here yet." : "No policies here yet."}</div>}

      {groups.map(([k, items]) => (
        <section key={k} className="sop-group">
          <div className="sop-group-head"><span>{k}</span><span className="n">{items.length}</span></div>
          <div className="sop-list">
            {items.map((p) => {
              const link = (p.body.match(/https?:\/\/\S+/) || [])[0], text = p.body.replace(LINK_LINE, "").trim(), isOpen = open === p.id;
              const showText = !link || text.replace(/Open the full document:?/i, "").replace(link, "").trim().length > 0;
              return (
                <div key={p.id} className={"sop-card" + (isOpen ? " open" : "")}>
                  <button className="sop-row" onClick={() => setOpen(isOpen ? null : p.id)}>
                    <span className="sop-ico">{fileKind(p) === "Guide" ? "☰" : fileKind(p) === "Link" ? "↗" : "⬇"}</span>
                    <span className="sop-name">{p.title}{p.forMyRole && !isAdmin && <span className="sop-mine">For your role</span>}</span>
                    <span className="sop-kind">{fileKind(p)}</span>
                    {!isSop && <span className={`badge ${p.acknowledgedByMe ? "done" : "sent"}`}>{p.acknowledgedByMe ? "Confirmed" : "Needs review"}</span>}
                    <span className="sop-chev">{isOpen ? "–" : "+"}</span>
                  </button>
                  {isOpen && (
                    <div className="sop-read">
                      <div className="sop-actions">
                        {p.hasFile && <button className="btn btn-primary btn-sm" onClick={() => api.downloadPolicyFile(p.id, p.file_name)}>Download {fileKind(p)}</button>}
                        {p.hasFile && /\.pdf$/i.test(p.file_name || "") && <button className="btn btn-outline btn-sm" onClick={() => api.openPolicyFile(p.id)}>View here</button>}
                        {link && <a className="btn btn-outline btn-sm" href={link} target="_blank" rel="noreferrer">Open document ↗</a>}
                        {isAdmin && <button className="btn btn-ghost btn-sm" onClick={() => { attachId.current = p.id; fileRef.current.click(); }}>{p.hasFile ? "Replace file" : "Attach file"}</button>}
                        {isAdmin && p.hasFile && <button className="btn btn-ghost btn-sm" onClick={() => dropFile(p)}>Remove file</button>}
                        {isAdmin && <button className="btn btn-ghost btn-sm" onClick={() => dropPolicy(p)}>Delete</button>}
                      </div>
                      {showText && <Body text={link ? text.replace(/Open the full document:?\s*/i, "").replace(link, "").trim() : text} />}
                      {!isSop && !p.acknowledgedByMe && <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={() => acknowledge(p.id)}>I have read this</button>}
                    </div>)}
                </div>);
            })}
          </div>
        </section>
      ))}
    </>
  );

  if (isStaffLayout) {
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
