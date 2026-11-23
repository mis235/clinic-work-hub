import { useState } from "react";
import { api } from "../api.js";
import FaceCapture from "./FaceCapture.jsx";

// Register a face. If the new face looks like someone else's saved face, say who and how close, and offer the two safe ways out.
export default function FaceEnrollModal({ person, onClose, onDone }) {
  const [clash, setClash] = useState(null); // { similar, descriptors, photo }
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");

  async function finish(descriptors, photo, force) {
    await api.enrollFace(person.id, descriptors, force);
    if (photo && !person.has_photo) { try { await api.uploadPhoto(person.id, new File([photo], "face.jpg", { type: "image/jpeg" })); } catch {} }
  }
  async function captured({ descriptors, photo }) {
    try { await finish(descriptors, photo, false); onDone(`${person.name}'s face is enrolled.`); }
    catch (e) { if (e.similar) { setClash({ similar: e.similar, descriptors, photo }); return; } throw e; }
  }
  async function removeOtherAndSave() {
    setBusy(true); setErr("");
    try {
      await api.removeFace(clash.similar.userId);
      await finish(clash.descriptors, clash.photo, false);
      onDone(`${person.name}'s face is enrolled. ${clash.similar.name}'s saved face was removed: please register ${clash.similar.name} again now.`);
    } catch (e) { setErr(e.message); setBusy(false); }
  }
  async function saveAnyway() {
    setBusy(true); setErr("");
    try { await finish(clash.descriptors, clash.photo, true); onDone(`${person.name}'s face is enrolled (confirmed as a different person from ${clash.similar.name}).`); }
    catch (e) { setErr(e.message); setBusy(false); }
  }
  async function remove() { try { await api.removeFace(person.id); onDone(`${person.name}'s face was removed.`); } catch {} }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Enroll face — {person.name}</h3>
        {clash ? (
          <div>
            <div className="login-error" style={{ marginBottom: 12 }}>This face looks like {clash.similar.name}'s saved face. Closeness {clash.similar.distance} (the same person is usually 0.40 or less).</div>
            <p className="meta" style={{ lineHeight: 1.55 }}>Pick one:</p>
            <div style={{ display: "grid", gap: 10 }}>
              <button className="btn btn-primary" disabled={busy} onClick={removeOtherAndSave}>Remove {clash.similar.name}'s saved face and save this one</button>
              <div className="meta" style={{ marginTop: -4 }}>Best if {clash.similar.name}'s face was taken in poor light. Then register {clash.similar.name} again.</div>
              {clash.similar.canForce
                ? <><button className="btn btn-outline" disabled={busy} onClick={saveAnyway}>They are two different people: save anyway</button>
                    <div className="meta" style={{ marginTop: -4 }}>Use this only if you are sure. Check-in may ask these two to try again until their faces are re-taken in good light.</div></>
                : <div className="meta">These two faces are so close that they are almost surely the same person, so saving both is not allowed.</div>}
            </div>
            {err && <div className="login-error" style={{ marginTop: 10 }}>{err}</div>}
            <div className="actions"><button className="btn btn-ghost" onClick={() => setClash(null)}>Take the picture again</button><button className="btn btn-ghost" onClick={onClose}>Close</button></div>
          </div>
        ) : (
          <>
            <FaceCapture who={person.name} onCaptured={captured} />
            <div className="actions">
              <button className="btn btn-ghost" onClick={remove}>Remove saved face</button>
              <button className="btn btn-ghost" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
