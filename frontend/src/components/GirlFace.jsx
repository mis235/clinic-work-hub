// Her face as a round profile picture, for people who have not added a photo.
export default function GirlFace({ size = 78 }) {
  let male = false; try { male = /^male$/i.test(JSON.parse(localStorage.getItem("user") || "{}").gender || ""); } catch {}
  return <span className="girl-face" style={{ width: size, height: size }}><img src={male ? "/buddy/happy.webp" : "/dolls/avatar.webp"} alt="" draggable="false" /></span>;
}
