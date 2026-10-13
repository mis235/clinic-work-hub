import { useState } from "react";
import { photoUrl } from "../api.js";
import { initials } from "./Icon.jsx";

// Round profile picture, falling back to the person's initials.
export default function Avatar({ id, name, hasPhoto = true, size = 40, v = "", className = "" }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: Math.max(11, size * 0.36), borderRadius: "50%", flex: "none" };
  if (id && hasPhoto && !failed) return <img className={`avatar-img ${className}`} src={photoUrl(id, v)} alt={name || ""} style={{ ...style, objectFit: "cover", display: "block" }} onError={() => setFailed(true)} />;
  return <div className={`avatar ${className}`} style={style}>{initials(name)}</div>;
}
