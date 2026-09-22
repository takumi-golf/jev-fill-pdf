// 画像だけの様式（文字層なし）から、各欄の近くのラベル断片を OCR で集める
// 横書き jpn でページ全体を1回、縦書き jpn_vert（PSM 5・逆順で返る）で欄の左の帯を読む
// 使い方: node scripts/ocr-labels.mjs [form.pdf]   （描画は pdf.js + @napi-rs/canvas。外部コマンド不要）
import fs from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { createWorker } from "tesseract.js";
import { fetchTo, pdfjs, argPdf, CACHE, NTA_FORM_URL, TESSDATA_URL } from "./_common.mjs";
const file = argPdf(await fetchTo(NTA_FORM_URL, "nta-kaigyo-r06.pdf"));
await fetchTo(TESSDATA_URL + "jpn.traineddata", "jpn.traineddata");
await fetchTo(TESSDATA_URL + "jpn_vert.traineddata", "jpn_vert.traineddata");
const lib = await pdfjs();
const pdf = await lib.getDocument({ data: new Uint8Array(fs.readFileSync(file)), isEvalSupported: false }).promise;
const p1 = await pdf.getPage(1);
const H = p1.getViewport({ scale: 1 }).height;
const widgets = (await p1.getAnnotations()).filter((a) => a.subtype === "Widget").map((a) => ({ name: a.fieldName, type: a.fieldType, x0: a.rect[0], x1: a.rect[2], top: H - a.rect[3], bottom: H - a.rect[1] }));
// scale 1 で描くと 1pt = 1px になり、欄の座標がそのまま画素になる
const vp = p1.getViewport({ scale: 1 });
const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
await p1.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
const PNG = path.join(CACHE, "page1.png");
fs.writeFileSync(PNG, canvas.toBuffer("image/png"));
const opts = { langPath: CACHE, cachePath: CACHE, gzip: false, logger: () => {} };
const t0 = Date.now();
const wH = await createWorker("jpn", 1, opts);
await wH.setParameters({ preserve_interword_spaces: "1" });
const r = await wH.recognize(PNG, {}, { blocks: true });
const lines = [];
for (const b of r.data.blocks || []) for (const pg of b.paragraphs || []) for (const ln of pg.lines || []) { const t = ln.text.replace(/\s+/g, ""); if (t) lines.push({ text: t, conf: Math.round(ln.confidence), ...ln.bbox }); }
console.log(`horizontal OCR: ${Date.now() - t0} ms | lines ${lines.length} | mean conf ${Math.round(lines.reduce((s, l) => s + l.conf, 0) / Math.max(1, lines.length))}`);
await wH.terminate();
const wV = await createWorker("jpn_vert", 1, opts);
await wV.setParameters({ tessedit_pageseg_mode: "5" });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const near = (w) => {
  const c = [];
  for (const l of lines) {
    if (l.conf < 30) continue;
    const oy = Math.min(l.y1, w.bottom) - Math.max(l.y0, w.top), ox = Math.min(l.x1, w.x1) - Math.max(l.x0, w.x0), h = w.bottom - w.top;
    if (l.x1 <= w.x0 + 4 && oy > Math.min(h, l.y1 - l.y0) * 0.4) c.push({ rel: "left", d: w.x0 - l.x1, t: l.text });
    else if (l.y1 <= w.top + 4 && ox > 0 && w.top - l.y1 < 60) c.push({ rel: "above", d: w.top - l.y1, t: l.text });
  }
  return c.sort((a, b) => a.d - b.d).slice(0, 3).map((x) => `${x.rel}:${x.t}`);
};
const t1 = Date.now(); let n = 0;
for (const w of widgets.filter((w) => w.type === "Tx").slice(0, 12)) {
  const left = clamp(Math.round(w.x0 - 260), 0, 4000), width = clamp(Math.round(w.x0 - 4) - left, 8, 4000), top = clamp(Math.round(w.top - 30), 0, H - 1), height = clamp(Math.round(w.bottom - w.top + 60), 8, H - top);
  const v = await wV.recognize(PNG, { rectangle: { left, top, width, height } });
  const vt = v.data.text.replace(/\s+/g, ""); n++;
  console.log(`${String(w.name).padEnd(12)} horizontal=${JSON.stringify(near(w))} vertical=${JSON.stringify(vt.slice(0, 16))} reversed=${JSON.stringify([...vt].reverse().join("").slice(0, 16))}`);
}
console.log(`vertical strips: ${n} in ${Date.now() - t1} ms`);
await wV.terminate();
