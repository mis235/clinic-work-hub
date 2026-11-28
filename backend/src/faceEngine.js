// Face engine on the server. The phone only sends a photo; the server finds the face (SCRFD) and makes a 512-number
// face print (ArcFace / MobileFaceNet, trained on millions of faces). Much more accurate than the small model that used to run inside each phone,
// and it does not depend on how old the phone is.
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const MODELS = process.env.FACE_MODELS_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "models");
const STRIDES = [8, 16, 32];
const ARC = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]]; // where the 5 face points sit in a 112x112 aligned face

let ort = null, det = null, rec = null, loading = null;
export function loadEngine() {
  if (det && rec) return Promise.resolve();
  loading ||= (async () => {
    ort = await import("onnxruntime-node");
    const opt = { executionProviders: ["cpu"], intraOpNumThreads: Number(process.env.FACE_THREADS || 2), graphOptimizationLevel: "all", logSeverityLevel: 3 };
    det = await ort.InferenceSession.create(path.join(MODELS, "det_500m.onnx"), opt);
    rec = await ort.InferenceSession.create(path.join(MODELS, "w600k_mbf.onnx"), opt);
  })().catch((e) => { loading = null; throw e; });
  return loading;
}

/** Decode a JPEG/PNG into raw RGB, upright, at most `max` pixels on the long side. */
export async function decode(buf, max = 640) {
  const { data, info } = await sharp(buf, { failOn: "none" }).rotate().resize({ width: max, height: max, fit: "inside", withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rgb: data, w: info.width, h: info.height };
}

/** SCRFD face finder. Returns faces, best first: { score, box:[x1,y1,x2,y2], kps:[[x,y] x5] } in image pixels. */
export async function detect(img, size = 320, thresh = 0.5) {
  const { rgb, w, h } = img, s = Math.min(size / w, size / h), nw = Math.round(w * s), nh = Math.round(h * s);
  // resize into the top-left of a size x size canvas (SCRFD's usual "letterbox"), then normalise (x-127.5)/128, channels first
  const small = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).resize(nw, nh, { fit: "fill" }).raw().toBuffer();
  const plane = size * size, input = new Float32Array(3 * plane);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) { const i = (y * nw + x) * 3, o = y * size + x; input[o] = (small[i] - 127.5) / 128; input[plane + o] = (small[i + 1] - 127.5) / 128; input[2 * plane + o] = (small[i + 2] - 127.5) / 128; }
  const out = await det.run({ [det.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, size, size]) });
  const names = det.outputNames, faces = [];
  STRIDES.forEach((stride, k) => {
    const sc = out[names[k]].data, bb = out[names[k + 3]].data, kp = out[names[k + 6]].data, cols = size / stride;
    for (let i = 0; i < sc.length; i++) {
      if (sc[i] < thresh) continue;
      const cell = Math.floor(i / 2), cx = (cell % cols) * stride, cy = Math.floor(cell / cols) * stride; // 2 anchors per cell
      faces.push({
        score: sc[i],
        box: [(cx - bb[i * 4] * stride) / s, (cy - bb[i * 4 + 1] * stride) / s, (cx + bb[i * 4 + 2] * stride) / s, (cy + bb[i * 4 + 3] * stride) / s],
        kps: Array.from({ length: 5 }, (_, j) => [(cx + kp[i * 10 + j * 2] * stride) / s, (cy + kp[i * 10 + j * 2 + 1] * stride) / s]),
      });
    }
  });
  faces.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const f of faces) { // drop overlapping boxes of the same face
    if (keep.every((g) => iou(f.box, g.box) < 0.4)) keep.push(f);
  }
  return keep;
}
function iou(a, b) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1), u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return u > 0 ? inter / u : 0;
}

/** Straighten and crop the face to 112x112 using the 5 face points (eyes, nose, mouth corners). */
export function align(img, kps) {
  const n = 5; let msx = 0, msy = 0, mdx = 0, mdy = 0;
  for (let i = 0; i < n; i++) { msx += kps[i][0]; msy += kps[i][1]; mdx += ARC[i][0]; mdy += ARC[i][1]; }
  msx /= n; msy /= n; mdx /= n; mdy /= n;
  let num1 = 0, num2 = 0, den = 0;
  for (let i = 0; i < n; i++) { const sx = kps[i][0] - msx, sy = kps[i][1] - msy, dx = ARC[i][0] - mdx, dy = ARC[i][1] - mdy; num1 += sx * dx + sy * dy; num2 += sx * dy - sy * dx; den += sx * sx + sy * sy; }
  const a = num1 / den, b = num2 / den, tx = mdx - (a * msx - b * msy), ty = mdy - (b * msx + a * msy), det2 = a * a + b * b;
  const out = new Float32Array(3 * 112 * 112), { rgb, w, h } = img;
  for (let v = 0; v < 112; v++) for (let u = 0; u < 112; u++) {
    const sx = (a * (u - tx) + b * (v - ty)) / det2, sy = (-b * (u - tx) + a * (v - ty)) / det2;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    for (let c = 0; c < 3; c++) {
      const px = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : rgb[(y * w + x) * 3 + c]);
      const val = px(x0, y0) * (1 - fx) * (1 - fy) + px(x0 + 1, y0) * fx * (1 - fy) + px(x0, y0 + 1) * (1 - fx) * fy + px(x0 + 1, y0 + 1) * fx * fy;
      out[c * 12544 + v * 112 + u] = (val - 127.5) / 127.5;
    }
  }
  return out;
}
async function embed(img, kps) {
  const r = await rec.run({ [rec.inputNames[0]]: new ort.Tensor("float32", align(img, kps), [1, 3, 112, 112]) });
  const e = Array.from(r[rec.outputNames[0]].data), norm = Math.sqrt(e.reduce((t, v) => t + v * v, 0)) || 1;
  return e.map((v) => v / norm);
}
export const similarity = (a, b) => { let t = 0; for (let i = 0; i < a.length; i++) t += a[i] * b[i]; return t; }; // 1 = identical face, around 0 = unrelated
export const okEmbedding = (e) => Array.isArray(e) && e.length === 512 && e.every((x) => typeof x === "number" && Number.isFinite(x));

/** Look at a photo and say whether it holds one clear, usable face.
 *  Result: { ok, why, embedding?, box? (0..1 of the picture), score? }.  why = none | multiple | far | close | off | soft | turned */
export async function analyze(buf, { strict = false } = {}) {
  await loadEngine();
  const img = await decode(buf);
  let faces = await detect(img, 320);
  if (!faces.length) faces = await detect(img, 640, 0.45); // a small or distant face needs the bigger scan
  if (!faces.length) return { ok: false, why: "none" };
  const f = faces[0], bw = f.box[2] - f.box[0], bh = f.box[3] - f.box[1];
  const out = { box: [f.box[0] / img.w, f.box[1] / img.h, bw / img.w, bh / img.h], score: f.score };
  if (faces[1] && (faces[1].box[2] - faces[1].box[0]) > bw * 0.6 && faces[1].score > 0.6) return { ok: false, why: "multiple", ...out };
  const cx = (f.box[0] + bw / 2) / img.w, cy = (f.box[1] + bh / 2) / img.h;
  const [le, re, nose] = f.kps, eye = Math.hypot(re[0] - le[0], re[1] - le[1]) || 1;
  const yaw = Math.abs(nose[0] - (le[0] + re[0]) / 2) / eye, roll = Math.abs(Math.atan2(re[1] - le[1], Math.abs(re[0] - le[0])) * 180 / Math.PI);
  let why = "";
  if (f.score < (strict ? 0.7 : 0.55)) why = "soft";
  else if (bw / img.w < (strict ? 0.22 : 0.18)) why = "far";
  else if (bw / img.w > 0.85) why = "close";
  else if (cx < 0.12 || cx > 0.88 || cy < 0.1 || cy > 0.9) why = "off";
  else if (yaw > (strict ? 0.45 : 0.7) || roll > 35) why = "turned";
  if (why) return { ok: false, why, ...out };
  return { ok: true, why: "", embedding: await embed(img, f.kps), ...out };
}

/** Make a small JPEG of the picture for the attendance log. */
export const thumb = (buf, w = 240) => sharp(buf, { failOn: "none" }).rotate().resize({ width: w, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
