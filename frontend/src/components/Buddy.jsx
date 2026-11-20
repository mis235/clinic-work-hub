// The boy guide: a small round picture in one mood. Used on knowledge pages and empty states, not for alerts.
const MOODS = ["welcome", "happy", "excited", "thinking", "working", "music", "tired", "sleepy", "hungry", "angry", "worried", "surprised", "sick", "celebrating", "success", "idea", "confused", "goodbye"];
export default function Buddy({ mood = "welcome", size = 96, ring = true, style }) {
  const m = MOODS.includes(mood) ? mood : "welcome";
  return (
    <img src={`/buddy/${m}.webp`} alt="" width={size} height={size} loading="lazy" draggable={false}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", background: "#fff", boxShadow: ring ? "0 0 0 4px rgba(155,120,220,.18), 0 8px 22px rgba(90,60,150,.18)" : "none", flex: "0 0 auto", ...style }} />
  );
}
