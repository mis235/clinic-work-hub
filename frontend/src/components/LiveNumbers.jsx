import { useEffect, useState } from "react";
import "../dashboard-original.css";
import { api } from "../api.js";

const rs = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
const mon = (m) => (m ? new Date(m + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }) : "");
const COL = "#c42f8f", GOLD = "#d49a2a", GREEN = "#12a56f";

function Bars({ items, val = (x) => x.n, label = (x) => x.k, fmt = (n) => n }) {
  const max = Math.max(1, ...items.map(val));
  return (
    <div>
      {items.map((x, i) => (
        <div key={i} className="rowbar">
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={label(x)}>{label(x)}</span>
          <div className="rowbar-track"><div className="rowbar-fill" style={{ width: `${(val(x) / max) * 100}%`, minWidth: val(x) ? 3 : 0 }} /></div>
          <b style={{ textAlign: "right" }}>{fmt(val(x))}</b>
        </div>))}
    </div>);
}
function Columns({ items, val, label, fmt = (n) => n }) {
  const max = Math.max(1, ...items.map(val));
  return (
    <div className="chart-wrap"><div className="bars" style={{ minWidth: Math.min(items.length * 34, 900) }}>
      {items.map((x, i) => (
        <div key={i} className="bar-col" title={`${label(x)}: ${fmt(val(x))}`}>
          <div className="bar-val">{val(x) ? fmt(val(x)) : ""}</div>
          <div className="bar-stack" style={{ height: `${Math.max(val(x) ? 3 : 0, (val(x) / max) * 78)}%` }}><div className="bar-fill"><div className="bar-seg-done" style={{ height: "100%" }} /></div></div>
          <div className="bar-label">{label(x)}</div>
        </div>))}
    </div></div>);
}
const Kpi = ({ l, v, sub }) => <div className="card stat-card"><p className="eyebrow">{l}</p><div className="big data-font">{v}</div>{sub && <div className="sub">{sub}</div>}</div>;
const Card = ({ t, children, sub }) => <div className="card"><h3>{t}</h3>{sub && <p className="card-sub">{sub}</p>}{!sub && <div style={{ height: 14 }} />}{children}</div>;

function MultiSelect({ all, value, onChange, summary }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="multiselect">
      {open && <div style={{ position: "fixed", inset: 0, zIndex: 19 }} onClick={() => setOpen(false)} />}
      <button type="button" className="ms-toggle data-font" onClick={() => setOpen(!open)}>{summary}</button>
      <div className={`ms-panel ${open ? "open" : ""}`}>
        <div className="ms-actions"><button type="button" onClick={() => onChange(all)}>Select all</button><button type="button" onClick={() => onChange([])}>Clear</button></div>
        {all.map((a) => <label key={a} className="ms-row"><input type="checkbox" checked={value.includes(a)} onChange={() => onChange(value.includes(a) ? value.filter((v) => v !== a) : [...value, a])} />{a}</label>)}
      </div>
    </div>);
}

const RING = 2 * Math.PI * 36, DONUT = 2 * Math.PI * 58;
function ConvSection({ conv }) {
  const years = conv.years.map((y) => String(y.y)), latest = years[years.length - 1];
  const [ys, setYs] = useState(null), [cs, setCs] = useState(null), [q, setQ] = useState("");
  const selY = (ys && ys.length ? ys : [latest]).filter((y) => years.includes(y));
  const cats = [...new Set(selY.flatMap((y) => (conv.byCategory[y] || []).map((r) => r.k)))].filter((k) => k !== "All").sort();
  const catOn = cs && cs.length && cs.length < cats.length ? cs.filter((c) => cats.includes(c)) : null;
  const yTot = (y) => {
    const yr = conv.years.find((a) => String(a.y) === y) || { sug: 0, done: 0 };
    if (!catOn) return { sug: yr.sug, done: yr.done };
    const r = (conv.byCategory[y] || []).filter((c) => catOn.includes(c.k));
    return { sug: r.reduce((a, c) => a + c.sug, 0), done: r.reduce((a, c) => a + c.done, 0) };
  };
  const per = years.map((y) => ({ y, ...yTot(y) }));
  const max = Math.max(1, ...per.map((r) => r.sug));
  const t = selY.reduce((a, y) => { const x = yTot(y); return { sug: a.sug + x.sug, done: a.done + x.done }; }, { sug: 0, done: 0 });
  const rate = t.sug ? Math.round((t.done / t.sug) * 100) : 0;
  const agg = {};
  selY.forEach((y) => (conv.byCategory[y] || []).forEach((r) => { if (r.k === "All" && cats.length) return; if (catOn && !catOn.includes(r.k)) return; const o = (agg[r.k] = agg[r.k] || { k: r.k, sug: 0, done: 0 }); o.sug += r.sug; o.done += r.done; }));
  const catRows = Object.values(agg).filter((r) => r.k.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.sug - a.sug);
  const months = (conv.byMonth || []).filter((m) => selY.includes(String(m.m).slice(0, 4)) || selY.length === years.length);
  const mMax = Math.max(1, ...months.map((m) => m.sug));
  const sel = (arr, all, word) => (!arr || !arr.length || arr.length === all.length ? `All ${word}` : arr.length === 1 ? arr[0] : `${arr.length} selected`);
  return (<>
    <div className="filterbar">
      <label>Year</label>
      <MultiSelect all={years} value={selY} onChange={setYs} summary={selY.length === 1 ? selY[0] : selY.length === years.length ? "All years" : `${selY.length} years`} />
      <label>Category</label>
      <MultiSelect all={cats} value={catOn || cats} onChange={setCs} summary={sel(catOn, cats, "categories")} />
      {!cats.length && <span className="note" style={{ marginLeft: 0 }}>Older years are not split by category</span>}
      <button type="button" className="btn-ghost" style={{ marginLeft: "auto" }} onClick={() => { setYs(null); setCs(null); setQ(""); }}>Reset filters</button>
    </div>
    <div className="kpi-grid">
      <div className="spot">
        <svg className="spot-ring" width="88" height="88" viewBox="0 0 88 88">
          <circle cx="44" cy="44" r="36" fill="none" stroke="#332A16" strokeWidth="10" />
          <circle cx="44" cy="44" r="36" fill="none" stroke="#E6B85C" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(rate / 100) * RING} ${RING}`} transform="rotate(-90 44 44)" />
          <text x="44" y="49" textAnchor="middle" fill="#F4E9C7" fontFamily="Georgia,serif" fontSize="19">{rate}%</text>
        </svg>
        <div className="spot-copy"><p className="eyebrow">Conversion rate</p><div className="big data-font">{rate}%</div><p className="sub">{selY.join(", ")} · Done ÷ total suggested</p></div>
      </div>
      <div className="card stat-card"><div className="icon" style={{ background: "var(--gold-wash)" }}><svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3" /><rect x="9" y="3" width="6" height="4" rx="1" /></svg></div><p className="eyebrow">Total suggested</p><div className="big data-font">{t.sug.toLocaleString("en-IN")}</div></div>
      <div className="card stat-card"><div className="icon" style={{ background: "var(--good-wash)" }}><svg viewBox="0 0 24 24" fill="none" stroke="var(--good)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></div><p className="eyebrow">Done</p><div className="big data-font">{t.done.toLocaleString("en-IN")}</div></div>
      <div className="card stat-card"><div className="icon" style={{ background: "var(--critical-wash)" }}><svg viewBox="0 0 24 24" fill="none" stroke="var(--critical)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg></div><p className="eyebrow">Not done</p><div className="big data-font">{(t.sug - t.done).toLocaleString("en-IN")}</div></div>
    </div>
    <div className="row2">
      <div className="card">
        <h3>Suggested vs. Done, all years</h3><p className="card-sub">Click a bar to pick that year.</p>
        <div className="chart-wrap"><div className="bars">
          {per.map((r) => (
            <div key={r.y} className="bar-col">
              <div className={`bar-stack ${selY.includes(r.y) ? "year-selected" : ""}`} style={{ height: `${Math.max(r.sug ? 3 : 0, (r.sug / max) * 78)}%` }} onClick={() => setYs([r.y])}>
                <div className="bar-tooltip">{r.y}: {r.done} done of {r.sug} ({r.sug ? Math.round((r.done / r.sug) * 100) : 0}%)</div>
                <div className="bar-fill"><div className="bar-seg-not" style={{ height: `${r.sug ? ((r.sug - r.done) / r.sug) * 100 : 0}%` }} /><div className="bar-seg-done" style={{ height: `${r.sug ? (r.done / r.sug) * 100 : 0}%` }} /></div>
              </div>
              <div className="bar-label">{r.y}</div>
            </div>))}
        </div></div>
        <div className="legend-row"><span><span className="legend-dot" style={{ background: "var(--gold)" }} />Done</span><span><span className="legend-dot" style={{ background: "var(--gold-soft)" }} />Not done</span></div>
      </div>
      <div className="card donut-card">
        <h3 style={{ alignSelf: "flex-start" }}>Selected year(s)</h3><p className="card-sub" style={{ alignSelf: "flex-start" }}>Composition for {selY.join(", ")}.</p>
        <svg width="150" height="150" viewBox="0 0 150 150" style={{ marginTop: 6 }}>
          <circle cx="75" cy="75" r="58" fill="none" stroke="var(--gold-soft)" strokeWidth="18" />
          <circle cx="75" cy="75" r="58" fill="none" stroke="var(--gold)" strokeWidth="18" strokeLinecap="round" strokeDasharray={`${(rate / 100) * DONUT} ${DONUT}`} transform="rotate(-90 75 75)" />
        </svg>
        <div className="donut-figures">
          <div><div className="n">{t.done.toLocaleString("en-IN")}</div><div className="l"><span className="legend-dot" style={{ background: "var(--gold)" }} />Done</div></div>
          <div><div className="n">{(t.sug - t.done).toLocaleString("en-IN")}</div><div className="l"><span className="legend-dot" style={{ background: "var(--gold-soft)" }} />Not done</div></div>
        </div>
      </div>
    </div>
    {months.length > 0 && (
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>By month</h3><p className="card-sub">Suggested, with the done part in gold</p>
        <div className="chart-wrap"><div className="bars">
          {months.map((m) => (
            <div key={m.m} className="bar-col">
              <div className="bar-stack" style={{ height: `${Math.max(3, (m.sug / mMax) * 78)}%` }}>
                <div className="bar-tooltip">{mon(m.m)}: {m.done} done of {m.sug}</div>
                <div className="bar-fill"><div className="bar-seg-not" style={{ height: `${m.sug ? ((m.sug - m.done) / m.sug) * 100 : 0}%` }} /><div className="bar-seg-done" style={{ height: `${m.sug ? (m.done / m.sug) * 100 : 0}%` }} /></div>
              </div>
              <div className="bar-label">{mon(m.m)}</div>
            </div>))}
        </div></div>
      </div>)}
    {catRows.length > 0 && (
      <div className="card">
        <div className="card-head-row">
          <div><h3>Category-wise conversions <span style={{ fontWeight: 400, color: "var(--ink-3)", fontSize: 13 }}>— {selY.join(", ")}</span></h3><p className="card-sub" style={{ marginBottom: 0 }}>Suggested, done, pending and conversion rate</p></div>
          <input type="text" className="ms-search" placeholder="Search category…" style={{ width: 200, margin: 0 }} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="table-scroll" style={{ marginTop: 16 }}>
          <table className="cat-table"><thead><tr><th>#</th><th>Category</th><th>Suggested</th><th>Done</th><th>Pending</th><th>Conversion rate</th></tr></thead>
            <tbody>{catRows.map((r, i) => { const rt = r.sug ? Math.round((r.done / r.sug) * 100) : 0; return (
              <tr key={r.k}><td><span className="cat-rank">{i + 1}</span></td><td>{r.k}</td><td className="data-font">{r.sug}</td><td className="data-font">{r.done}</td><td className="data-font">{r.sug - r.done}</td>
                <td className="data-font"><span className="proc-rate-bar"><span className="proc-rate-fill" style={{ display: "block", width: rt + "%" }} /></span>{rt}%</td></tr>); })}</tbody></table>
        </div>
      </div>)}
  </>);
}

const SETUP = typeof location !== "undefined" && new URLSearchParams(location.search).has("setup");
const NAV = [
  ["conv", "Suggested vs Done", <svg key="i" className="sec-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4h6v3H9zM9 13l2 2 4-4" /></svg>],
  ["daily", "Daily Procedures", <svg key="i" className="sec-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /></svg>],
  ["pack", "Package Sheet", <svg key="i" className="sec-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></svg>],
  ["pharm", "Purchase & Pharmacy", <svg key="i" className="sec-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="9" width="18" height="12" rx="2" /><path d="M8 9V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4M12 12v6M9 15h6" /></svg>],
  ["sales", "Clinic Sales", <svg key="i" className="sec-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></svg>],
  ["deliv", "Procedure Delivery", <svg key="i" className="sec-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>],
  ["master", "Patient Master", <svg key="i" className="sec-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4" /><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2M16 3.1a4 4 0 0 1 0 7.8M22 21v-2a4 4 0 0 0-3-3.9" /></svg>],
  ["search", "Patient Search", <svg key="i" className="sec-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>],
  ["hr", "HR & Hiring", <svg key="i" className="sec-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>],
  ["leads", "Leads", <svg key="i" className="sec-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" /></svg>],
];

export default function LiveNumbers({ user }) {
  const [sec, setSec] = useState("conv"), [sq, setSq] = useState(""), [sqGo, setSqGo] = useState(""), [d, setD] = useState(null), [cfg, setCfg] = useState(null), [url, setUrl] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [open, setOpen] = useState(false);
  const load = () => api.liveNumbers().then(setD).catch((e) => setMsg(e.message));
  const loadCfg = () => user.role === "admin" && api.liveConfig().then((c) => { setCfg(c); setUrl(c.url || ""); }).catch(() => {});
  useEffect(() => { load(); loadCfg(); const t = setInterval(load, 60000); window.addEventListener("hub-refresh", load); return () => { clearInterval(t); window.removeEventListener("hub-refresh", load); }; }, []);
  const x = d?.data, hv = d?.heavy, isAdmin = user.role === "admin";
  const copy = (t) => { navigator.clipboard?.writeText(t); setMsg("Copied."); };
  const upd = d?.heavyStatus || d?.status || "";
  return (
    <div className="cdx"><div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="logo-card"><img src="/logo.png" alt="Dr. Nishita's Clinic" /></div>
          <div className="brand-text"><h1 className="brand-title">Dr. Nishita's Clinic Dashboard</h1><p>{upd ? upd.replace("Updated", "Updated ·") : "Live from Google Sheets"}</p></div>
        </div>
        <div className="sidebar-search">
          <svg className="sidebar-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          <input className="sidebar-search-input" placeholder="Search a patient…" value={sq} onChange={(e) => setSq(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && sq.trim().length >= 3) { setSqGo(sq.trim()); setSec("search"); } }} />
        </div>
        <nav className="sidebar-nav">
          {NAV.map(([k, l, ic]) => <button key={k} type="button" className="sec-btn" aria-selected={sec === k} onClick={() => setSec(k)}>{ic}<span>{l}</span></button>)}
        </nav>
        <div className="sidebar-foot"><span className="pill"><span className="dot" />Live from Google Sheets</span></div>
      </aside>
      <div className="main" style={{ display: "grid", gap: 14, alignContent: "start" }}>
      {isAdmin && SETUP && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div className="meta">{d?.status || "Not connected yet."} {x?.updatedAt ? `· numbers as of ${x.updatedAt}` : ""}{d?.heavyStatus ? ` · big sheets: ${d.heavyStatus}` : ""}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-outline btn-sm" disabled={busy || !cfg?.url} onClick={async () => { setBusy(true); setMsg(""); try { const rr = await api.refreshLive(); await load(); await loadCfg(); setMsg(rr?.heavy === false ? `Updated. Big sheets: ${rr.heavyError || "not read"}` : "Updated."); } catch (e) { setMsg(e.message); } setBusy(false); }}>{busy ? "Reading sheets…" : "Update now"}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)}>{open ? "Hide setup" : "Setup"}</button>
            </div>
          </div>
          {msg && <div className="meta" style={{ marginTop: 6 }}>{msg}</div>}
          {(open || !d?.configured) && cfg && (
            <div style={{ marginTop: 10 }}>
              <div className="meta"><b>Set up once (5 minutes), on the Google account that owns the sheets:</b></div>
              <ol className="meta" style={{ margin: "4px 0 8px 18px", lineHeight: 1.7 }}>
                <li>Open <b>script.google.com</b> and click <b>New project</b>. Delete everything in the editor.</li>
                <li><button className="btn btn-outline btn-sm" onClick={() => copy(cfg.script)}>Copy the script</button> and paste it into the editor. Click the save icon.</li>
                <li>Click <b>Deploy → New deployment</b>. Click the gear and choose <b>Web app</b>. “Execute as” = Me, “Who has access” = <b>Anyone</b>. Click Deploy and allow access when asked.</li>
                <li>Copy the <b>Web app URL</b> (ends with /exec), paste it below, press Save, then Update now.</li>
              </ol>
              <input className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" />
              <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={async () => { try { await api.saveLiveConfig(url); setMsg("Saved. Press Update now."); loadCfg(); load(); } catch (e) { setMsg(e.message); } }}>Save</button>
            </div>)}
        </div>)}

      {!x && <div className="empty">Loading…</div>}
      {SETUP && x && Object.keys(x.errors || {}).length > 0 && <div className="card meta">Some sheets could not be read: {Object.entries(x.errors).map(([k, v]) => `${k} (${v})`).join(" · ")}</div>}

      {SETUP && hv && Object.keys(hv.errors || {}).length > 0 && <div className="card meta">Some big sheets could not be read: {Object.entries(hv.errors).map(([k, v]) => `${k} (${v})`).join(" · ")}</div>}
      {!hv && x && ["conv", "pack", "pharm", "deliv", "master", "hr"].includes(sec) && <div className="empty">Loading…</div>}
      {(() => { const fk = (n) => (n >= 10000000 ? (n / 10000000).toFixed(1) + "Cr" : n >= 100000 ? (n / 100000).toFixed(1) + "L" : n >= 1000 ? Math.round(n / 1000) + "k" : n); return (<>

      {sec === "conv" && hv?.conv && <ConvSection conv={hv.conv} />}

      {sec === "daily" && x?.procedures && (<>
        <div className="kpi-row">
          <Kpi l={`Procedures · ${mon(x.procedures.focus)}`} v={x.procedures.thisMonth} />
          <Kpi l="Patients this month" v={x.procedures.patients} />
          <Kpi l="Procedures this year" v={x.procedures.total} c={GOLD} />
        </div>
        <div className="dept-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
          <Card t="Procedures by month"><Columns items={x.procedures.byMonth} val={(r) => r.n} label={(r) => mon(r.m)} /></Card>
          <Card t="Last 14 days"><Columns items={x.procedures.last14} val={(r) => r.n} label={(r) => r.d.slice(8)} color={GOLD} /></Card>
          <Card t="By category"><Bars items={x.procedures.byCategory} /></Card>
          <Card t="Top procedures"><Bars items={x.procedures.topProcedures} color={GOLD} /></Card>
        </div>
      </>)}

      {sec === "sales" && x?.revenue && (<>
        <div className="kpi-row">
          <Kpi l={`Sales · ${mon(x.revenue.focus)}`} v={rs(x.revenue.thisMonth)} c={GREEN} sub={`${x.revenue.invoices} invoices`} />
          <Kpi l="Received" v={rs(x.revenue.paid)} c={GREEN} />
          <Kpi l="Pending this month" v={rs(x.revenue.pending)} c={GOLD} />
          <Kpi l="Pending, all months" v={rs(x.revenue.pendingAll)} c="#d4432a" />
        </div>
        <div className="dept-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
          <Card t="Sales by month" sub="Invoice total"><Columns items={x.revenue.byMonth} val={(r) => r.total} label={(r) => mon(r.m)} color={GREEN} fmt={fk} /></Card>
          <Card t={`Sales by category · ${mon(x.revenue.focus)}`}><Bars items={x.revenue.byCategory} fmt={rs} color={GREEN} /></Card>
        </div>
      </>)}

      {sec === "pack" && hv?.pack && (<>
        <div className="kpi-row">
          <Kpi l="Packages sold" v={hv.pack.total.n} />
          <Kpi l="Package value" v={rs(hv.pack.total.amt)} c={GREEN} />
          <Kpi l="Paid" v={rs(hv.pack.total.paid)} c={GREEN} />
          <Kpi l="Balance to collect" v={rs(hv.pack.total.bal)} c="#d4432a" />
        </div>
        <div className="dept-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
          <Card t="Package value by month"><Columns items={hv.pack.byMonth} val={(r) => r.amt} label={(r) => mon(r.m)} color={GREEN} fmt={fk} /></Card>
          <Card t="Packages sold by month"><Columns items={hv.pack.byMonth} val={(r) => r.n} label={(r) => mon(r.m)} /></Card>
          <Card t="Top procedures by value"><Bars items={hv.pack.byProc} fmt={rs} color={GOLD} label={(r) => `${r.k} (${r.count})`} /></Card>
          <Card t="New vs existing patients"><Bars items={hv.pack.byPatientType} color={GREEN} /></Card>
        </div>
      </>)}

      {sec === "pharm" && hv?.pharm && (<>
        {(() => { const l = hv.pharm.byMonth.slice(-1)[0] || {}; return (
          <div className="kpi-row">
            <Kpi l={`Pharmacy sales · ${mon(hv.pharm.focus)}`} v={rs(l.sales)} c={GREEN} sub={`${l.orders || 0} orders`} />
            <Kpi l="Profit" v={rs(l.profit)} c={GREEN} sub={l.sales ? `${Math.round((l.profit / l.sales) * 100)}% margin` : ""} />
            <Kpi l="Items sold" v={l.qty || 0} c={GOLD} />
          </div>); })()}
        <div className="dept-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
          <Card t="Pharmacy sales by month"><Columns items={hv.pharm.byMonth} val={(r) => r.sales} label={(r) => mon(r.m)} color={GREEN} fmt={fk} /></Card>
          <Card t="Profit by month"><Columns items={hv.pharm.byMonth} val={(r) => r.profit} label={(r) => mon(r.m)} color={GOLD} fmt={fk} /></Card>
          <Card t={`Sales by category · ${mon(hv.pharm.focus)}`}><Bars items={hv.pharm.byCategory} fmt={rs} color={GREEN} /></Card>
          <Card t={`Top medicines · ${mon(hv.pharm.focus)}`}><Bars items={hv.pharm.topMedicines} fmt={rs} color={GOLD} /></Card>
        </div>
      </>)}

      {sec === "deliv" && hv?.deliv && (<>
        <div className="kpi-row">
          <Kpi l={`Procedures delivered · ${mon(hv.deliv.focus)}`} v={hv.deliv.byMonth.slice(-1)[0]?.n || 0} />
          {hv.deliv.byUnique.map((u) => <Kpi key={u.k} l={u.k} v={u.n} c={GOLD} />)}
        </div>
        <div className="dept-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
          <Card t="Procedures delivered by month"><Columns items={hv.deliv.byMonth} val={(r) => r.n} label={(r) => mon(r.m)} /></Card>
          <Card t={`By therapist · ${mon(hv.deliv.focus)}`}><Bars items={hv.deliv.byTherapist} color={GREEN} /></Card>
          <Card t={`By procedure · ${mon(hv.deliv.focus)}`}><Bars items={hv.deliv.byProc} color={GOLD} /></Card>
          <Card t={`By category · ${mon(hv.deliv.focus)}`}><Bars items={hv.deliv.byCategory} /></Card>
        </div>
      </>)}

      {sec === "master" && hv?.master && (<>
        <div className="kpi-row">
          <Kpi l="Patients on file" v={hv.master.total.toLocaleString("en-IN")} />
          {hv.master.byGender.map((g) => <Kpi key={g.k} l={g.k} v={g.n.toLocaleString("en-IN")} c={GOLD} />)}
        </div>
        <div className="dept-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
          <Card t="Patient visit recency" sub="How overdue their next visit is"><Bars items={hv.master.byDue} color={GREEN} /></Card>
          <Card t="By number of visits"><Bars items={hv.master.byVisits} /></Card>
          <Card t="By age range"><Bars items={hv.master.byAge} color={GOLD} /></Card>
        </div>
      </>)}

      {sec === "hr" && hv?.hr && (<>
        <div className="kpi-row"><Kpi l="Candidates called" v={hv.hr.total} /></div>
        <div className="dept-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
          <Card t="Candidates by month"><Columns items={hv.hr.byMonth} val={(r) => r.n} label={(r) => mon(r.m)} /></Card>
          <Card t="By role"><Bars items={hv.hr.byRole} color={GOLD} /></Card>
          <Card t="Interview status"><Bars items={hv.hr.byStatus} color={GREEN} /></Card>
          <Card t="Call status"><Bars items={hv.hr.byCall} /></Card>
          <Card t="Fresher or experienced"><Bars items={hv.hr.byExp} color={GOLD} /></Card>
          <Card t="Source"><Bars items={hv.hr.bySource} color={GREEN} /></Card>
        </div>
      </>)}

      {sec === "search" && <PatientSearch key={sqGo} initial={sqGo} />}

      {sec === "leads" && x?.leads && (<>
        <div className="kpi-row"><Kpi l="Leads (TeleCRM)" v={x.leads.total} /></div>
        {x.leads.total === 0 ? <div className="empty">No leads in the TeleCRM sheet yet. They appear here once TeleCRM sends them.</div> : (
        <div className="dept-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
          <Card t="Leads, last 14 days"><Columns items={x.leads.last14} val={(r) => r.n} label={(r) => r.d.slice(8)} /></Card>
          <Card t="By status"><Bars items={x.leads.byStatus} /></Card>
          <Card t="By source"><Bars items={x.leads.bySource} color={GOLD} /></Card>
          <Card t="By stage"><Bars items={x.leads.byStage} color={GREEN} /></Card>
        </div>)}
      </>)}
      </>); })()}
      </div>
    </div></div>);
}

function PatientSearch({ initial = "" }) {
  const [q, setQ] = useState(initial), [r, setR] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const go = async () => { setBusy(true); setErr(""); setR(null); try { setR(await api.patientSearch(q.trim())); } catch (e) { setErr(e.message); } setBusy(false); };
  useEffect(() => { if (initial.length >= 3) go(); }, []);
  return (
    <div className="card">
      <h3>Search a patient</h3><div style={{ height: 12 }} />
      
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input className="field" style={{ maxWidth: 360 }} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && q.trim().length >= 3 && go()} placeholder="Name, phone or patient ID" />
        <button className="btn btn-primary btn-sm" disabled={busy || q.trim().length < 3} onClick={go}>{busy ? "Searching…" : "Search"}</button>
      </div>
      {err && <div className="note warn" style={{ marginTop: 8 }}>{err}</div>}
      {r && r.rows.length === 0 && <div className="meta" style={{ marginTop: 10 }}>No patient found.</div>}
      {r && r.rows.length > 0 && (
        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table className="reg-table"><thead><tr><th>Name</th><th>Patient ID</th><th>Phone</th><th>Gender / age</th><th>Visits</th><th>Last visit</th><th>Next visit</th></tr></thead>
            <tbody>{r.rows.map((p) => <tr key={p.id}><td className="nm">{p.name}</td><td>{p.id}</td><td>{p.phone}</td><td>{p.gender} {p.age ? "· " + p.age : ""}</td><td>{p.visits}</td><td>{p.last}</td><td>{p.next}</td></tr>)}</tbody></table>
          {r.history?.length > 0 && (<>
            <div className="title" style={{ margin: "14px 0 6px" }}>Recent procedures · {r.rows[0].name}</div>
            <table className="reg-table"><thead><tr><th>Date</th><th>Procedure</th><th>Part</th><th>Done by</th></tr></thead>
              <tbody>{r.history.map((h, i) => <tr key={i}><td>{h.date}</td><td>{h.proc}</td><td>{h.part}</td><td>{h.by}</td></tr>)}</tbody></table>
          </>)}
        </div>)}
    </div>);
}
