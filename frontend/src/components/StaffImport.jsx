import { useMemo, useRef, useState } from "react";
import { api } from "../api.js";

const fmt = (n) => (!n ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// Upload the clinic's "Staff data" zip. Every file is sorted onto a person and a document type; the admin checks it and imports.
export default function StaffImport({ onClose, onDone }) {
  const [step, setStep] = useState("pick"), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [pv, setPv] = useState(null);
  const [who, setWho] = useState({}), [kind, setKind] = useState({}), [off, setOff] = useState({}), [result, setResult] = useState(null), [open, setOpen] = useState({}), [f, setF] = useState({ offer: true, pdf: true, current: true });
  const input = useRef(null);

  async function preview(file) {
    if (!file) return; setBusy(true); setErr("");
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await api.importPreview(fd); setPv(r);
      const w = {}, o = {};
      r.items.forEach((i) => { if (i.skip) return; if (!(i.person in w)) w[i.person] = i.userId || ""; if (i.dup) o[i.i] = true; });
      setWho(w); setOff(o); setStep("review");
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const typeOf = (i) => kind[i.i] || i.type;
  const shown = (i) => !i.skip && (!f.offer || typeOf(i) === "offer_letter") && (!f.pdf || /\.pdf$/i.test(i.file));
  const isCurrent = (person) => { const u = pv?.users.find((x) => x.id === who[person]); return !!u && !!u.active; };
  const groups = useMemo(() => {
    if (!pv) return [];
    const m = new Map();
    pv.items.filter(shown).forEach((i) => { if (!m.has(i.person)) m.set(i.person, []); m.get(i.person).push(i); });
    return [...m.entries()].map(([person, items]) => ({ person, items })).sort((a, b) => (!!who[a.person] - !!who[b.person]) || a.person.localeCompare(b.person));
  }, [pv, who, f, kind]);
  const skipped = pv ? pv.items.filter((i) => i.skip) : [];
  const chosen = pv ? pv.items.filter((i) => shown(i) && who[i.person] && !off[i.i] && (!f.current || isCurrent(i.person))) : [];
  const unmatched = groups.filter((g) => !who[g.person]);

  async function run() {
    setBusy(true); setErr("");
    try { const r = await api.importCommit({ stagingId: pv.stagingId, items: chosen.map((i) => ({ i: i.i, userId: who[i.person], type: typeOf(i) })) }); setResult(r); setStep("done"); onDone?.(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><div className="name">Import staff files</div><button className="btn btn-ghost btn-sm" onClick={() => { if (pv) api.importCancel(pv.stagingId).catch(() => {}); onClose(); }}>Close</button></div>
      {err && <div className="login-error" style={{ marginBottom: 10 }}>{err}</div>}

      {step === "pick" && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input ref={input} type="file" accept=".zip" hidden onChange={(e) => { preview(e.target.files[0]); e.target.value = ""; }} />
          <button className="btn btn-primary" disabled={busy} onClick={() => input.current.click()}>{busy ? "Reading the file…" : "Choose the Staff data .zip"}</button>
        </div>)}

      {step === "review" && pv && (
        <>
          <div className="meta" style={{ marginBottom: 10 }}>{chosen.length} files will be imported for {new Set(chosen.map((i) => who[i.person])).size} people · {unmatched.length} names not matched · {skipped.length} skipped</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
            {[["offer", "Offer letters only"], ["pdf", "PDF files only"], ["current", "Current staff only (not former)"]].map(([k, l]) => (
              <label key={k} style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />{l}</label>))}
          </div>
          {groups.map((g) => (
            <div key={g.person || "none"} style={{ borderTop: "1px solid var(--line, #eee)", padding: "10px 0" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <strong style={{ textTransform: "capitalize", minWidth: 120 }}>{g.person || "No name in file"}</strong>
                <select className="field" style={{ maxWidth: 280 }} value={who[g.person] || ""} onChange={(e) => setWho({ ...who, [g.person]: e.target.value })}>
                  <option value="">Do not import</option>
                  {(() => { const cand = new Set(g.items[0].candidates || []); const list = pv.users; return [...list.filter((u) => cand.has(u.id)), ...list.filter((u) => !cand.has(u.id))].map((u) => <option key={u.id} value={u.id}>{u.name}{u.department ? ` · ${u.department}` : ""}{u.active ? "" : " (former)"}</option>); })()}
                </select>
                <span className="meta">{g.items.length} file{g.items.length > 1 ? "s" : ""}{who[g.person] && f.current && !isCurrent(g.person) ? " · former staff, will not be uploaded" : ""}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => setOpen({ ...open, [g.person]: !open[g.person] })}>{open[g.person] ? "Hide files" : "Show files"}</button>
              </div>
              {open[g.person] && g.items.map((i) => (
                <div key={i.i} className="task-row" style={{ padding: "6px 0 0", border: 0, gap: 8 }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", flex: 1, minWidth: 0 }}>
                    <input type="checkbox" checked={!off[i.i]} onChange={(e) => setOff({ ...off, [i.i]: !e.target.checked })} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{i.file} <span className="meta">{fmt(i.size)}{i.dup ? " · already imported" : ""}</span></span>
                  </label>
                  <select className="field" style={{ maxWidth: 220 }} value={typeOf(i)} onChange={(e) => setKind({ ...kind, [i.i]: e.target.value })}>{pv.types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
                </div>))}
            </div>))}
          {skipped.length > 0 && <div className="meta" style={{ marginTop: 10 }}>Skipped: {skipped.map((s) => s.file).slice(0, 6).join(", ")}{skipped.length > 6 ? ` and ${skipped.length - 6} more` : ""} (blank templates and temporary files).</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button className="btn btn-primary" disabled={busy || !chosen.length} onClick={run}>{busy ? "Importing…" : `Import ${chosen.length} files`}</button>
          </div>
        </>)}

      {step === "done" && result && (
        <div><div style={{ fontWeight: 700 }}>Done.</div>
          <div className="meta">{result.imported + result.offer} files saved ({result.offer} offer letters) · {result.duplicates} already there · {result.skipped} not imported.</div></div>)}
    </div>
  );
}
