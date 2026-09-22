// 共通: 検証用の様式（国税庁 開業届 r06）と日本語フォント（Noto Sans JP のサブセット）を .cache に用意する
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
export const require = createRequire(import.meta.url);
export const CACHE = path.resolve(".cache");
export const NTA_FORM_URL = "https://www.nta.go.jp/taxes/tetsuzuki/shinsei/annai/shinkoku/pdf/r06/05.pdf";
export const FONT_URL = "https://ilove-ai.net/pdf/fonts/NotoSansJP-Regular.subset.otf";
export const TESSDATA_URL = "https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_fast@main/";
export async function fetchTo(url, file) {
  fs.mkdirSync(CACHE, { recursive: true });
  const p = path.join(CACHE, file);
  if (fs.existsSync(p)) return p;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  fs.writeFileSync(p, Buffer.from(await r.arrayBuffer()));
  return p;
}
export async function pdfjs() {
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  lib.GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  return lib;
}
export function argPdf(def) { const a = process.argv.find((x) => x.endsWith(".pdf")); return a || def; }
