// Face recognition runs in the browser (nothing is sent to any outside service). The library is loaded only on the pages that need it.
let lib = null;
export async function loadFace() {
  if (lib) return lib;
  const fa = await import("@vladmandic/face-api");
  await fa.nets.tinyFaceDetector.loadFromUri("/models");
  await fa.nets.faceLandmark68TinyNet.loadFromUri("/models");
  await fa.nets.faceRecognitionNet.loadFromUri("/models");
  lib = fa; return fa;
}
const opts = (fa) => new fa.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.55 });
/** 128-number face print for the single clear face in the picture, or null. */
export async function faceDescriptor(input) {
  const fa = await loadFace();
  const r = await fa.detectSingleFace(input, opts(fa)).withFaceLandmarks(true).withFaceDescriptor();
  return r ? { descriptor: Array.from(r.descriptor), box: r.detection.box, score: r.detection.score } : null;
}
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
