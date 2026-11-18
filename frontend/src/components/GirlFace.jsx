// Her face as a round profile picture, for people who have not added a photo.
export default function GirlFace({ size = 78 }) {
  return <span className="girl-face" style={{ width: size, height: size }}><img src="/dolls/avatar.webp" alt="" draggable="false" /></span>;
}
