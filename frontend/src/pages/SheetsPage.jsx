import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import PageShell from "../components/PageShell.jsx";

const fmt = (n) => (Math.abs(n) >= 1e7 ? (n / 1e7).toFixed(2) + " Cr" : Math.abs(n) >= 1e5 ? (n / 1e5).toFixed(2) + " L" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 1 }));
const card = { background: "#fff", border: "1px solid var(--line)", borderRadius: 14, padding: "14px 16px" };

function Bars({ items, color = "var(--primary, #be185d)" }) {
  const max = Math.max(1, ...items.map((i) => i.n));
  return (
    <div style={{ display: "grid", gap: 7 }}>
      {items.map((i) => (
        <div key={i.v ?? i.m} style={{ display: "grid", gridTemplateColumns: "minmax(70px,150px) 1fr 44px", gap: 8, alignItems: "center", fontSize: 12.5 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={i.v ?? i.m}>{i.v ?? i.m}</span>
          <div style={{ height: 10, borderRadius: 99, background: "var(--surface-sunk, #f1f5f9)", overflow: "hidden" }}><div style={{ width: (i.n / max) * 100 + "%", height: "100%", background: color }} /></div>
          <b style={{ textAlign: "right" }}>{i.n}</b>
        </div>))}
    </div>
  );
}

export default function SheetsPage({ user, onLogout, onBack }) {
  const [list, setList] = useState(null);
  const [sel, setSel] = useState(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [add, setAdd] = useState(null);
  const [catCol, setCatCol] = useState("");
  const [shown, setShown] = useState(50);

  const loadList = () => api.listSheets().then((d) => { setList(d); setSel((s) => s || d.sheets[0]?.id || null); }).catch((e) => { setErr(e.message); setList({ sheets: [] }); });
  useEffect(() => { loadList(); }, []);
  const open = (id, fresh) => { setLoading(true); setErr(""); setQ(""); setShown(50); api.sheetData(id, fresh).then((d) => { setData(d); setCatCol(""); }).catch((e) => { setData(null); setErr(e.message); }).finally(() => setLoading(false)); };
  useEffect(() => { if (sel) open(sel); }, [sel]);

  const cats = useMemo(() => (data?.columns || []).filter((c) => c.type === "category"), [data]);
  const nums = useMemo(() => (data?.columns || []).filter((c) => c.type === "number"), [data]);
  const dates = useMemo(() => (data?.columns || []).filter((c) => c.type === "date"), [data]);
  const activeCat = cats.find((c) => c.name === catCol) || cats[0];
  const rows = useMemo(() => (data ? (q.trim() ? data.rows.filter((r) => r.some((c) => c.toLowerCase().includes(q.trim().toLowerCase()))) : data.rows) : []), [data, q]);
  const groups = useMemo(() => (list?.sheets || []).reduce((a, s) => { (a[s.category] ||= []).push(s); return a; }, {}), [list]);
  const cur = list?.sheets.find((s) => s.id === sel);

  async function saveAdd() {
    try {
      if (add.bulk) {
        const items = add.bulk.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p.length >= 3).map(([category, title, url]) => ({ category, title, url }));
        await api.addSheets({ items });
      } else await api.addSheets({ title: add.title, category: add.category || "General", url: add.url });
      setAdd(null); loadList();
    } catch (e) { setErr(e.message); setAdd(null); }
  }
  async function remove() { if (cur && window.confirm(`Remove "${cur.title}" from this dashboard? (The Google Sheet itself is not touched.)`)) { await api.deleteSheet(cur.id); setSel(null); setData(null); loadList(); } }

  return (
    <PageShell user={user} active="Sheets" title="Sheets Dashboard" onLogout={onLogout} onBack={onBack}>
      <div className="page-head row">
        <div><div className="eyebrow">Insights</div><h1>Sheets Dashboard</h1><p>Your Google Sheets as clear dashboards: totals, top categories, monthly trend and a searchable table. Numbers refresh from the sheet every few minutes.</p></div>
        {list?.canEdit && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-outline" onClick={() => setAdd({ bulk: "" })}>Add Many</button>
          <button className="btn btn-primary" onClick={() => setAdd({ title: "", category: "", url: "" })}>+ Add Sheet</button></div>}
      </div>
      {err && <div className="login-error" style={{ marginBottom: 10 }}>{err}</div>}
      {list && list.sheets.length === 0 && <div className="empty">No sheets added yet.{list.canEdit ? " Press + Add Sheet and paste a Google Sheets link." : ""}</div>}

      {list?.sheets.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {Object.entries(groups).map(([cat, items]) => (
            <div key={cat} style={{ ...card, padding: "8px 10px", flex: "1 1 260px" }}>
              <div className="meta" style={{ fontWeight: 700, marginBottom: 6 }}>{cat}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{items.map((s) => <button key={s.id} className={`btn btn-sm ${sel === s.id ? "btn-primary" : "btn-outline"}`} onClick={() => setSel(s.id)}>{s.title}</button>)}</div>
            </div>))}
        </div>)}

      {loading && <div className="empty">Reading the sheet…</div>}
      {data && !loading && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            <div><b style={{ fontSize: 17 }}>{data.title}</b><div className="meta">Updated {new Date(data.fetchedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</div></div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <a className="btn btn-outline btn-sm" href={data.url} target="_blank" rel="noreferrer">Open In Google Sheets</a>
              <button className="btn btn-outline btn-sm" onClick={() => open(sel, true)}>Refresh</button>
              {list.canEdit && <button className="btn btn-ghost btn-sm" onClick={remove}>Remove</button>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <div style={{ ...card, flex: "1 1 140px" }}><div style={{ fontSize: 26, fontWeight: 800 }}>{data.total.toLocaleString("en-IN")}</div><div className="meta">Rows</div></div>
            <div style={{ ...card, flex: "1 1 140px" }}><div style={{ fontSize: 26, fontWeight: 800 }}>{data.columns.length}</div><div className="meta">Columns</div></div>
            {nums.slice(0, 4).map((c) => <div key={c.name} style={{ ...card, flex: "1 1 160px" }}><div style={{ fontSize: 24, fontWeight: 800 }}>{fmt(c.sum)}</div><div className="meta">Total · {c.name}</div><div className="meta">Average {fmt(c.avg)}</div></div>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12, marginBottom: 12 }}>
            {activeCat && (
              <div style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 10, alignItems: "center" }}>
                  <b>Top {activeCat.name}</b>
                  {cats.length > 1 && <select className="field" style={{ margin: 0, width: "auto", maxWidth: 170, padding: "4px 8px" }} value={activeCat.name} onChange={(e) => setCatCol(e.target.value)}>{cats.map((c) => <option key={c.name}>{c.name}</option>)}</select>}
                </div>
                <Bars items={activeCat.top} />
              </div>)}
            {dates[0] && <div style={card}><b style={{ display: "block", marginBottom: 10 }}>Entries By Month · {dates[0].name}</b><Bars items={dates[0].months} color="#5b7be0" /></div>}
            {!activeCat && !dates[0] && <div style={card} className="meta">No categories or dates found to chart. The table below shows everything.</div>}
          </div>
          <div style={{ ...card, overflowX: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <b>All Data</b>
              <input className="field" style={{ margin: 0, maxWidth: 260 }} placeholder={`Search ${data.total} rows…`} value={q} onChange={(e) => { setQ(e.target.value); setShown(50); }} />
            </div>
            <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
              <thead><tr style={{ textAlign: "left", background: "var(--surface-sunk, #f1f5f9)" }}>{data.columns.map((c) => <th key={c.name} style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>{c.name}</th>)}</tr></thead>
              <tbody>{rows.slice(0, shown).map((r, i) => <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>{r.map((c, j) => <td key={j} style={{ padding: "6px 8px", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c}>{c}</td>)}</tr>)}</tbody>
            </table>
            <div className="meta" style={{ marginTop: 8 }}>Showing {Math.min(shown, rows.length)} of {rows.length}{data.total > 1000 ? " (first 1,000 rows loaded; the charts use every row)" : ""} {rows.length > shown && <button className="btn btn-ghost btn-sm" onClick={() => setShown(shown + 100)}>Show more</button>}</div>
          </div>
        </>)}

      {add && (
        <div className="modal-backdrop" onClick={() => setAdd(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {add.bulk !== undefined ? (<>
              <h3>Add Many Sheets</h3>
              <div className="meta">One per line: Category | Name | Google Sheets link</div>
              <textarea className="field" rows={8} value={add.bulk} onChange={(e) => setAdd({ bulk: e.target.value })} placeholder="Front Desk | Front Desk Mis Score | https://docs.google.com/spreadsheets/d/…" />
            </>) : (<>
              <h3>Add A Sheet</h3>
              <label className="field-label">Name</label><input className="field" value={add.title} onChange={(e) => setAdd({ ...add, title: e.target.value })} placeholder="e.g. Daily Procedures 2026" />
              <label className="field-label">Group</label><input className="field" value={add.category} onChange={(e) => setAdd({ ...add, category: e.target.value })} placeholder="e.g. Front Desk, Sales, Follow-ups" />
              <label className="field-label">Google Sheets link</label><input className="field" value={add.url} onChange={(e) => setAdd({ ...add, url: e.target.value })} placeholder="https://docs.google.com/spreadsheets/d/…" />
              <div className="meta" style={{ marginTop: 6 }}>Tip: open the exact tab you want, then copy the link. In Google Sheets: Share → General access → Anyone with the link → Viewer.</div>
            </>)}
            <div className="actions"><button className="btn btn-ghost" onClick={() => setAdd(null)}>Cancel</button><button className="btn btn-primary" onClick={saveAdd}>Add</button></div>
          </div>
        </div>)}
    </PageShell>
  );
}
