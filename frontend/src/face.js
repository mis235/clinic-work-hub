// Face recognition runs in the browser (nothing is sent to any outside service). The library is loaded only on the pages that need it.
let lib = null;
export async function loadFace() {
  if (lib) return lib;
  const fa = await import("@vladmandic/face-api");
  await fa.nets.tinyFaceDetector.loadFromUri("/models");
  await fa.nets.faceLandmark68TinyNet.loadFromUri("/models");
  await fa.nets.faceRecognitionNet.loadFromUri("/models");
  lib = fa;
  // Some phones cannot run the fast (GPU) mode and the scanner then fails quietly. Test once; if it fails, use the slower mode that works everywhere.
  try { const c = document.createElement("canvas"); c.width = c.height = 64; await fa.detectSingleFace(c, opts(fa)).withFaceLandmarks(true); }
  catch { await slowMode(); }
  return fa;
}
/** Switch to the slower scanner that works on every phone. */
export async function slowMode() { try { await lib?.tf?.setBackend("cpu"); await lib?.tf?.ready(); } catch {} }
/** Average brightness of the camera picture, 0 (black) to 255 (white). */
export function frameBrightness(video) {
  try {
    const c = document.createElement("canvas"); c.width = 32; c.height = 24;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(video, 0, 0, 32, 24);
    const d = x.getImageData(0, 0, 32, 24).data; let t = 0; for (let i = 0; i < d.length; i += 4) t += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return Math.round(t / (d.length / 4));
  } catch { return null; }
}
const opts = (fa) => new fa.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.55 });
const mid = (pts) => ({ x: pts.reduce((t, q) => t + q.x, 0) / pts.length, y: pts.reduce((t, q) => t + q.y, 0) / pts.length });
/** Look at the camera picture and say whether there is one real, usable face in it.
 *  mode "enroll" (registering a face) is strict; mode "kiosk" (daily check-in) is a little more forgiving.
 *  Result: { ok, why, descriptor, box, score }.  why = none | soft | far | off | shape.
 *  A ceiling, a door or a wall must never pass as a face, because a saved "face" of junk makes everyone look the same. */
export async function scanFace(video, mode = "enroll") {
  const fa = await loadFace(), enroll = mode === "enroll";
  const run = (size, th) => fa.detectSingleFace(video, new fa.TinyFaceDetectorOptions({ inputSize: size, scoreThreshold: th })).withFaceLandmarks(true).withFaceDescriptor();
  // A face held close to the camera is only found at a smaller scan size, a far one at a bigger size: try several, keep the best.
  let r = null;
  for (const size of enroll ? [320, 224, 160] : [320, 224, 416, 160]) {
    const x = await run(size, 0.5);
    if (x && (!r || x.detection.score > r.detection.score)) r = x;
    if (r && r.detection.score >= (enroll ? 0.8 : 0.6)) break;
  }
  if (!r) return { ok: false, why: "none" };
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480, b = r.detection.box, score = r.detection.score;
  const cx = (b.x + b.width / 2) / vw, cy = (b.y + b.height / 2) / vh;
  const L = mid(r.landmarks.getLeftEye()), R = mid(r.landmarks.getRightEye());
  const roll = Math.abs(Math.atan2(R.y - L.y, Math.abs(R.x - L.x)) * 180 / Math.PI);
  const eyeRatio = Math.hypot(R.x - L.x, R.y - L.y) / b.width, aspect = b.width / b.height;
  let why = "";
  if (score < (enroll ? 0.8 : 0.65)) why = "soft";
  else if (b.width / vw < (enroll ? 0.2 : 0.12)) why = "far";
  else if (cx < 0.2 || cx > 0.8 || cy < 0.15 || cy > 0.85) why = "off";
  else if (aspect < 0.55 || aspect > 1.3 || eyeRatio < 0.25 || eyeRatio > 0.65 || roll > 35) why = "shape";
  return { ok: !why, why, descriptor: Array.from(r.descriptor), box: b, score };
}
/** Older helper kept for other pages: descriptor of the single clear face, or null. */
export async function faceDescriptor(input) {
  const fa = await loadFace();
  const r = await fa.detectSingleFace(input, opts(fa)).withFaceLandmarks(true).withFaceDescriptor();
  return r ? { descriptor: Array.from(r.descriptor), box: r.detection.box, score: r.detection.score } : null;
}
export const faceDist = (a, b) => Math.sqrt(a.reduce((t, v, i) => t + (v - b[i]) ** 2, 0));
export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("INSECURE");
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
  video.srcObject = stream; await video.play();
  return () => stream.getTracks().forEach((t) => t.stop());
}
export const cameraHelp = (e) => e?.message === "INSECURE"
  ? "The camera is blocked because this address is not secure. Open the https:// link created on Attendance → Face check-in (on the phone tap Advanced → Proceed once), or use the app on the computer at localhost."
  : /denied|Permission|NotAllowed/i.test(e?.name + e?.message) ? "Camera permission was denied. Allow the camera for this site and try again." : `Camera problem: ${e?.message || e}`;
export function snapshotJpeg(video, w = 240) {
  const c = document.createElement("canvas"); c.width = w; c.height = Math.round(w * (video.videoHeight || 480) / (video.videoWidth || 640));
  c.getContext("2d").drawImage(video, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", 0.7);
}
