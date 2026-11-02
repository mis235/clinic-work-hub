import { useEffect, useRef, useState } from "react";

// Draw a signature with finger, pen or mouse. Works on phone, tablet and desktop.
export default function SignaturePad({ onSave }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    const c = ref.current, ctx = c.getContext("2d");
    c.width = 600; c.height = 220;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111827";
  }, []);
  const pos = (e) => { const c = ref.current, r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)]; };
  const down = (e) => { e.preventDefault(); ref.current.setPointerCapture?.(e.pointerId); drawing.current = true; const ctx = ref.current.getContext("2d"); ctx.beginPath(); const [x, y] = pos(e); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y + 0.1); ctx.stroke(); setDirty(true); };
  const move = (e) => { if (!drawing.current) return; e.preventDefault(); const ctx = ref.current.getContext("2d"); const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); };
  const up = () => { drawing.current = false; };
  function clear() { const c = ref.current, ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); setDirty(false); }
  // Upload a picture of a signature (photo or scan). It is made white-backed, resized and saved as PNG.
  function upload(e) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    if (!/^image\//.test(f.type)) { setErr("Please choose a picture (JPG or PNG)."); return; }
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      const c = document.createElement("canvas"), k = Math.min(1, 600 / img.width, 220 / img.height);
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); setErr(""); onSave(c.toDataURL("image/png"));
    };
    img.onerror = () => { URL.revokeObjectURL(url); setErr("That picture could not be opened."); };
    img.src = url;
  }
  return (
    <div>
      <canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}
        style={{ width: "100%", maxWidth: 420, aspectRatio: "600 / 220", background: "#fff", border: "1px dashed #9ca3af", borderRadius: 10, touchAction: "none", display: "block" }} />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn btn-outline btn-sm" onClick={clear}>Clear</button>
        <button className="btn btn-primary btn-sm" disabled={!dirty} onClick={() => onSave(ref.current.toDataURL("image/png"))}>Save signature</button>
        <label className="btn btn-outline btn-sm" style={{ cursor: "pointer" }}>Upload a picture<input type="file" accept="image/*" onChange={upload} style={{ display: "none" }} /></label>
      </div>
      {err && <div className="login-error" style={{ marginTop: 8 }}>{err}</div>}
      <div className="meta" style={{ marginTop: 6 }}>Draw above, or upload a clear photo of your signature on white paper.</div>
    </div>
  );
}
