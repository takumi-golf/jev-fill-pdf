// 様式の中身を見る: 暗号化・AcroForm の欄（名前・種類・ツールチップ・位置）・文字層の有無・画像かどうか
// 使い方: node scripts/inspect-form.mjs [form.pdf]   （省略時は国税庁の開業届を取得して検査）
import fs from "node:fs";
import { fetchTo, pdfjs, argPdf, NTA_FORM_URL } from "./_common.mjs";
const file = argPdf(await fetchTo(NTA_FORM_URL, "nta-kaigyo-r06.pdf"));
const lib = await pdfjs();
const bytes = new Uint8Array(fs.readFileSync(file));
const encrypted = Buffer.from(bytes).includes("/Encrypt");
const pdf = await lib.getDocument({ data: bytes, isEvalSupported: false }).promise;
const p1 = await pdf.getPage(1);
const vp = p1.getViewport({ scale: 1 });
const widgets = (await p1.getAnnotations()).filter((a) => a.subtype === "Widget");
const text = (await p1.getTextContent()).items.filter((i) => i.str && i.str.trim());
const ops = await p1.getOperatorList();
const images = ops.fnArray.filter((f) => f === lib.OPS.paintImageXObject || f === lib.OPS.paintJpegXObject).length;
console.log(`file: ${file}\npages: ${pdf.numPages} | page1: ${vp.width}x${vp.height}pt | encrypted(/Encrypt): ${encrypted}`);
console.log(`AcroForm widgets: ${widgets.length} | text items: ${text.length} | image XObjects: ${images}`);
const rows = widgets.map((a) => ({ type: a.fieldType, name: a.fieldName, tu: a.alternativeText || "", x: Math.round(a.rect[0]), y: Math.round(a.rect[1]), w: Math.round(a.rect[2] - a.rect[0]), h: Math.round(a.rect[3] - a.rect[1]) }));
rows.sort((a, b) => (b.y - a.y) || (a.x - b.x));
for (const r of rows.slice(0, 20)) console.log(`  ${String(r.type).padEnd(4)} ${JSON.stringify(r.name).padEnd(20)} TU=${JSON.stringify(r.tu).padEnd(8)} @(${r.x},${r.y}) ${r.w}x${r.h}`);
if (rows.length > 20) console.log(`  … ${rows.length - 20} more`);
console.log(`\nverdict: ${text.length === 0 && widgets.length > 0 ? "C: image + AcroForm (labels only via OCR)" : widgets.length > 0 ? "B: text layer + AcroForm" : "A: text layer, no fields (boxes from vector paths)"}`);
