// Face recognition runs in the browser (nothing is sent to any outside service). The library is loaded only on the pages that need it.
let lib = null;
export async function loadFace() {
  if (lib) return lib;
  const t0 = performance.now();
  const fa = await import("@vladmandic/face-api");
  await Promise.all([ // all three models download and load together, not one after the other
    fa.nets.tinyFaceDetector.loadFromUri("/models"),
    fa.nets.faceLandmark68TinyNet.loadFromUri("/models"),
    fa.nets.faceRecognitionNet.loadFromUri("/models"),
  ]);
  lib = fa;
  // Warm-up: run every net once now, so the first real face is scanned at full speed (the first run compiles the GPU programs and is slow).
  // Some phones cannot run the fast (GPU) mode and the scanner then fails quietly. If the warm-up fails, use the slower mode that works everywhere.
  const warm = async () => {
    const c = document.createElement("canvas"); c.width = c.height = 160;
    const x = c.getContext("2d"); x.fillStyle = "#888"; x.fillRect(0, 0, 160, 160);
    await fa.detectSingleFace(c, new fa.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.55 })).withFaceLandmarks(true); // 224 is the size the check-in scan uses first, so its GPU programs are ready
    await fa.nets.faceLandmark68TinyNet.detectLandmarks(c);
    await fa.nets.faceRecognitionNet.computeFaceDescriptor(c);
  };
  try { await warm(); } catch { await slowMode(); try { await warm(); } catch {} }
  try { window.__scan = { b: fa.tf.getBackend(), ms: Math.round(performance.now() - t0) }; } catch {} // reported to the admin: which scanner mode this phone uses and how long it took to get ready
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
 *  mode "enroll" (registering a face) is strict; mode "kiosk" (daily In Time) is a little more forgiving.
 *  Result: { ok, why, descriptor, box, score }.  why = none | soft | far | off | shape.
 *  A ceiling, a door or a wall must never pass as a face, because a saved "face" of junk makes everyone look the same. */
export async function scanFace(video, mode = "enroll") {
  const fa = await loadFace(), enroll = mode === "enroll";
  const run = (size, th) => fa.detectSingleFace(video, new fa.TinyFaceDetectorOptions({ inputSize: size, scoreThreshold: th })).withFaceLandmarks(true).withFaceDescriptor();
  // A face held close to the camera is only found at a smaller scan size, a far one at a bigger size: try several, keep the best.
  let r = null;
  for (const size of enroll ? [320, 224, 160] : [224, 320, 160, 416]) { // 224 first: a face at arm's length is large, and 224 scans about twice as fast as 320
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
  else if (b.width / vw < (enroll ? 0.2 : 0.2)) why = "far";
  else if (!enroll && b.width / vw > 0.82) why = "close";
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
  ? "The camera is blocked because this address is not secure. Open the https:// link created on Attendance → Face attendance (on the phone tap Advanced → Proceed once), or use the app on the computer at localhost."
  : /denied|Permission|NotAllowed/i.test(e?.name + e?.message) ? "Camera permission was denied. Allow the camera for this site and try again." : `Camera problem: ${e?.message || e}`;
export function snapshotJpeg(video, w = 240, q = 0.7) {
  const c = document.createElement("canvas"); c.width = w; c.height = Math.round(w * (video.videoHeight || 480) / (video.videoWidth || 640));
  c.getContext("2d").drawImage(video, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", q);
}

// ---- Server-side face checking: the phone only finds a face (tiny model) and sends a photo; the server does the recognising. ----
let det = null;
export async function loadDetector() {
  if (det) return det;
  const t0 = performance.now(), fa = await import("@vladmandic/face-api");
  await fa.nets.tinyFaceDetector.loadFromUri("/models");
  const warm = async () => { const c = document.createElement("canvas"); c.width = c.height = 160; const x = c.getContext("2d"); x.fillStyle = "#888"; x.fillRect(0, 0, 160, 160); await fa.detectSingleFace(c, new fa.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })); };
  try { await warm(); } catch { try { await fa.tf.setBackend("cpu"); await fa.tf.ready(); await warm(); } catch {} } // a phone that cannot use the fast mode uses the slow one
  det = fa;
  try { window.__scan = { b: fa.tf.getBackend(), ms: Math.round(performance.now() - t0) }; } catch {}
  return fa;
}
/** Find a face in the camera picture (nothing is recognised here). Result: { ok, why, image }.  why = none | far | close | off | soft.
 *  image = a JPEG of the camera picture, ready to send to the server. */
export async function lookFace(video, mode = "kiosk") {
  const fa = await loadDetector(), enroll = mode === "enroll";
  let r = null;
  for (const size of [224, 320, 160]) { // a face at arm's length is found at 224 (fast); a close or far one needs another size
    const x = await fa.detectSingleFace(video, new fa.TinyFaceDetectorOptions({ inputSize: size, scoreThreshold: 0.5 }));
    if (x && (!r || x.score > r.score)) r = x;
    if (r && r.score >= 0.6) break;
  }
  if (!r) return { ok: false, why: "none" };
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480, b = r.box, cx = (b.x + b.width / 2) / vw, cy = (b.y + b.height / 2) / vh;
  let why = "";
  if (r.score < (enroll ? 0.7 : 0.55)) why = "soft";
  else if (b.width / vw < (enroll ? 0.22 : 0.2)) why = "far";
  else if (!enroll && b.width / vw > 0.82) why = "close";
  else if (cx < 0.15 || cx > 0.85 || cy < 0.1 || cy > 0.9) why = "off";
  return why ? { ok: false, why } : { ok: true, why: "", image: snapshotJpeg(video, 480, 0.82) };
}
