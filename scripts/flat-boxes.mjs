// 文字層あり・入力欄なし（線だけ）の様式: ラベル（文字）と枠（経路の外接矩形・CTM を追う）を取り、枠の中に値を描く
// 使い方: node scripts/flat-boxes.mjs [form.pdf]   （省略時はサンプル様式を生成して実証）
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { fetchTo, pdfjs, CACHE, FONT_URL } from "./_common.mjs";
const font = fs.readFileSync(await fetchTo(FONT_URL, "NotoSansJP-Regular.subset.otf"));
const arg = process.argv.find((x) => x.endsWith(".pdf"));
let bytes;
if (arg) bytes = fs.readFileSync(arg);
else {
  const d = await PDFDocument.create(); d.registerFontkit(fontkit); const f = await d.embedFont(font, { subset: true }); const pg = d.addPage([595, 842]);
  for (const [label, y] of [["申請者氏名", 700], ["フリガナ", 660], ["郵便番号", 620], ["住所", 580], ["電話番号", 540], ["生年月日", 500]]) { pg.drawText(label, { x: 60, y: y + 6, size: 11, font: f }); pg.drawRectangle({ x: 180, y, width: 340, height: 26, borderWidth: 0.8, borderColor: rgb(0, 0, 0) }); }
  bytes = await d.save(); fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(path.join(CACHE, "flat-sample.pdf"), bytes);
}
const lib = await pdfjs();
const pdf = await lib.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
const p1 = await pdf.getPage(1);
const labels = (await p1.getTextContent()).items.filter((i) => i.str.trim()).map((i) => ({ text: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width }));
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const ops = await p1.getOperatorList(); const O = lib.OPS;
const ARGC = { [O.moveTo]: 2, [O.lineTo]: 2, [O.curveTo]: 6, [O.curveTo2]: 4, [O.curveTo3]: 4, [O.closePath]: 0, [O.rectangle]: 4 };
let ctm = [1, 0, 0, 1, 0, 0]; const st = []; const boxes = [];
for (let i = 0; i < ops.fnArray.length; i++) {
  const fn = ops.fnArray[i], a = ops.argsArray[i];
  if (fn === O.save) st.push(ctm); else if (fn === O.restore) ctm = st.pop() || [1, 0, 0, 1, 0, 0]; else if (fn === O.transform) ctm = mul(ctm, a);
  else if (fn === O.constructPath) { // pdf.js 4.x: re は moveTo/lineTo に展開され、座標は CTM の下
    const [codes, co] = a; let k = 0; const pts = [];
    for (const c of codes) { const n = ARGC[c] ?? 0; if (c === O.rectangle) { const [x, y, w, h] = co.slice(k, k + 4); pts.push(ap(ctm, x, y), ap(ctm, x + w, y + h)); } else if (n >= 2) { const [x, y] = co.slice(k + n - 2, k + n); pts.push(ap(ctm, x, y)); } k += n; }
    if (pts.length >= 2 && (codes.includes(O.closePath) || codes.includes(O.rectangle))) { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); const b = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; if (b.w > 40 && b.h > 10 && b.h < 80) boxes.push(b); }
  }
}
console.log(`labels: ${labels.length} | boxes: ${boxes.length}`);
const profile = { "申請者氏名": "山田 太郎", "フリガナ": "ヤマダ タロウ", "郵便番号": "150-0000", "住所": "東京都渋谷区テスト町1-2-3", "電話番号": "03-0000-0000", "生年月日": "1989年4月1日" };
const plan = [];
for (const b of boxes) { const lab = labels.filter((l) => l.x + l.w <= b.x + 2 && Math.abs(l.y - (b.y + b.h * 0.25)) < b.h).sort((p, q) => (b.x - (p.x + p.w)) - (b.x - (q.x + q.w)))[0]; if (lab && profile[lab.text]) plan.push({ b, label: lab.text, value: profile[lab.text] }); }
console.log(`matched: ${plan.map((p) => `${p.label}→${p.value}`).join(" / ") || "(none)"}`);
if (!plan.length) process.exit(0);
const doc = await PDFDocument.load(bytes); doc.registerFontkit(fontkit); const f2 = await doc.embedFont(font, { subset: true }); const pg = doc.getPage(0);
for (const p of plan) { const size = Math.min(12, p.b.h * 0.6); pg.drawText(p.value, { x: p.b.x + 6, y: p.b.y + (p.b.h - size) / 2 + 1, size, font: f2 }); }
const out = await doc.save(); const outPath = path.join(CACHE, "flat-filled.pdf"); fs.writeFileSync(outPath, out);
console.log(`wrote ${outPath} (${out.length} bytes), placed ${plan.length}`);
