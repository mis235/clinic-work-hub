import { api } from "../api.js";
import FaceCapture from "./FaceCapture.jsx";

// Admin registers a person's face once. One face can belong to only one person (the server refuses a repeat).
export default function FaceEnrollModal({ person, onClose, onDone }) {
  async function captured({ descriptors, photo }) {
    await api.enrollFace(person.id, descriptors); // throws "already registered to …" if the face belongs to someone else
    if (photo && !person.has_photo) { try { await api.uploadPhoto(person.id, new File([photo], "face.jpg", { type: "image/jpeg" })); } catch {} }
    onDone(`${person.name}'s face is registered.`);
  }
  async function remove() { try { await api.removeFace(person.id); onDone(`${person.name}'s face was removed.`); } catch {} }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Register face — {person.name}</h3>
        <FaceCapture who={person.name} onCaptured={captured} />
        <div className="actions">
          <button className="btn btn-ghost" onClick={remove}>Remove saved face</button>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
