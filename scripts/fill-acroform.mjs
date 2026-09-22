// 暗号化された AcroForm の様式に日本語で記入して確定する: qpdf --decrypt → pdf-lib setText/check → updateFieldAppearances(日本語フォント) → flatten
// 使い方: node scripts/fill-acroform.mjs [form.pdf]   出力: .cache/filled.pdf
import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { fetchTo, pdfjs, argPdf, require, CACHE, NTA_FORM_URL, FONT_URL } from "./_common.mjs";
const file = argPdf(await fetchTo(NTA_FORM_URL, "nta-kaigyo-r06.pdf"));
const font = fs.readFileSync(await fetchTo(FONT_URL, "NotoSansJP-Regular.subset.otf"));
let bytes = new Uint8Array(fs.readFileSync(file));
if (Buffer.from(bytes).includes("/Encrypt")) {
  // ブラウザでは locateFile で読ませるが、Node は fetch で wasm を取りに行って落ちるので instantiateWasm で手元のバイト列から起動する
  const factory = require("@jspawn/qpdf-wasm/qpdf.js");
  const wasm = fs.readFileSync(require.resolve("@jspawn/qpdf-wasm/qpdf.wasm"));
  let err = "";
  const q = await factory({ instantiateWasm: (imports, cb) => { WebAssembly.instantiate(wasm, imports).then((r) => cb(r.instance)); return {}; }, print: () => {}, printErr: (m) => { err += m + "\n"; } });
  q.FS.writeFile("in.pdf", bytes);
  let code = 0; try { code = q.callMain(["--decrypt", "--password=", "in.pdf", "out.pdf"]); } catch (e) { code = e?.status ?? 1; }
  if (code !== 0 && code !== 3) throw new Error(`qpdf exit ${code}: ${err}`);
  bytes = q.FS.readFile("out.pdf");
  console.log(`decrypted with qpdf (exit ${code}): ${bytes.length} bytes`);
}
const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
doc.registerFontkit(fontkit);
const form = doc.getForm();
const fields = form.getFields();
const texts = fields.filter((f) => f.constructor.name === "PDFTextField");
const checks = fields.filter((f) => f.constructor.name === "PDFCheckBox");
console.log(`fields: ${fields.length} (text ${texts.length}, checkbox ${checks.length})`);
if (!texts.length) { console.log("no text fields; nothing to fill"); process.exit(0); }
// 実証用: 最初の3つの文字欄に日本語を入れ、最初のチェックを付ける（本番では Jev の対応結果に従う）
const sample = ["山田 太郎", "東京都渋谷区テスト町1-2-3", "令和"];
texts.slice(0, 3).forEach((f, i) => f.setText(sample[i]));
if (checks[0]) checks[0].check();
const jp = await doc.embedFont(font, { subset: true }); // 描くものがあると分かってから埋め込む（空サブセットは save で落ちる）
form.updateFieldAppearances(jp);
form.flatten({ updateFieldAppearances: false });
const out = await doc.save();
const outPath = path.join(CACHE, "filled.pdf"); fs.writeFileSync(outPath, out);
const lib = await pdfjs();
const pdf = await lib.getDocument({ data: new Uint8Array(out), isEvalSupported: false }).promise;
const p1 = await pdf.getPage(1);
const strs = (await p1.getTextContent()).items.map((i) => i.str.trim()).filter(Boolean);
const left = (await p1.getAnnotations()).filter((a) => a.subtype === "Widget").length;
console.log(`wrote ${outPath} (${out.length} bytes) | text now on page: ${JSON.stringify(strs)} | widgets left: ${left}`);
