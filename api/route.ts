import { NextResponse, type NextRequest } from 'next/server';
import { experimental_evaluate as evaluate } from 'ai';
import { checkRateLimit, getClientIP, rateLimitResponse } from '@/lib/rateLimit';

/**
 * POST /api/fill/map — ジェネリック記入（/fill）の中継（docs/SPEC.md「/fill」）。
 *
 * 受け取るのは「欄の近くの文字の断片」と「項目名」だけ。**値（名前・住所・番号）は受け取らない設計**で、
 * 本文をログに出さない。Jev は Vercel AI Gateway（`typesafe-ai/jev`）経由で、関数の OIDC で認証される。
 * 1 リクエストに欄の数だけ choice を並べ、欄ごとに「どの項目か」と確率を返す。
 */

const MODEL = 'typesafe-ai/jev';
const MAX_FIELDS = 120;
const MAX_KEYS = 60;
const MAX_FRAGMENTS = 6;
const MAX_FRAGMENT_LEN = 40;
const MAX_LABEL_LEN = 30;
const MAX_TITLE_LEN = 120;
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
/** 1 日の総呼び出し上限（インメモリ・実行環境ごと＝緩い保険）。0 以下なら無制限 */
const DAILY_CAP = Number(process.env.FILL_DAILY_CAP ?? '2000');
const NONE = 'none';

interface FieldIn { id: string; page: number; fragments: string[]; w: number; h: number; multiline: boolean }
interface KeyIn { key: string; label: string }

const dayCounter = { day: '', count: 0 };
/** JST の日付で数える（CLAUDE.md §4.6 相当: UTC の日付を「今日」にしない） */
function jstDay(): string { return new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }); }
function underDailyCap(): boolean {
  if (DAILY_CAP <= 0) return true;
  const d = jstDay();
  if (dayCounter.day !== d) { dayCounter.day = d; dayCounter.count = 0; }
  if (dayCounter.count >= DAILY_CAP) return false;
  dayCounter.count += 1;
  return true;
}

const ID_RE = /^f\d{1,4}$/;
const KEY_RE = /^[A-Za-z0-9_-]{1,32}$/;
const clip = (s: unknown, n: number): string => (typeof s === 'string' ? s.trim().slice(0, n) : '');

function parseFields(v: unknown): FieldIn[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_FIELDS) return null;
  const out: FieldIn[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    const id = clip(r.id, 8);
    if (!ID_RE.test(id) || seen.has(id)) return null;
    seen.add(id);
    const fragments = Array.isArray(r.fragments) ? r.fragments.map((x) => clip(x, MAX_FRAGMENT_LEN)).filter(Boolean).slice(0, MAX_FRAGMENTS) : [];
    if (!fragments.length) continue;
    out.push({ id, page: Number.isInteger(r.page) ? (r.page as number) : 1, fragments, w: Math.max(0, Math.round(Number(r.w) || 0)), h: Math.max(0, Math.round(Number(r.h) || 0)), multiline: r.multiline === true });
  }
  return out.length ? out : null;
}
function parseKeys(v: unknown): KeyIn[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_KEYS) return null;
  const out: KeyIn[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    const key = clip(r.key, 32);
    const label = clip(r.label, MAX_LABEL_LEN);
    if (!KEY_RE.test(key) || key === NONE || !label || seen.has(key)) return null;
    seen.add(key);
    out.push({ key, label });
  }
  return out;
}

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(`fill:${getClientIP(request)}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!rate.allowed) return rateLimitResponse(rate);

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }); }
  if (typeof body !== 'object' || body === null) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const input = body as Record<string, unknown>;
  const fields = parseFields(input.fields);
  const keys = parseKeys(input.keys);
  if (!fields || !keys) return NextResponse.json({ error: 'invalid_fields_or_keys' }, { status: 400 });
  const title = clip(input.title, MAX_TITLE_LEN);

  if (!underDailyCap()) return NextResponse.json({ disabled: true, reason: 'daily_cap' }, { status: 503 });

  // 選択肢 = 項目名 + 「該当なし」。同じ criteria を全欄で使う
  const criteria: Record<string, string> = {};
  for (const k of keys) criteria[k.key] = k.label;
  criteria[NONE] = 'どの項目にも当たらない（見出し・説明・日付の年月日の一部・空欄のままにする欄）';

  const state = {
    form: title,
    note: '日本語の申請書・届出書。fields[].near は各入力欄の近く（左または上）にあった文字で、画像からの読み取り（OCR）のため崩れていたり、縦書きの見出しは文字順が逆になっていることがある。size は欄の幅×高さ（pt）。',
    fields: fields.map((f) => ({ id: f.id, page: f.page, near: f.fragments, size: `${f.w}x${f.h}`, multiline: f.multiline })),
  };
  const questions: Record<string, { type: 'choice'; instructions: string; criteria: Record<string, string> }> = {};
  for (const f of fields) {
    questions[f.id] = { type: 'choice', instructions: `入力欄 ${f.id} に入れるべき項目はどれか。近くの文字（崩れ・逆順あり）と欄の大きさから選ぶ。確信が持てなければ ${NONE}。`, criteria };
  }

  try {
    const result = await evaluate({ model: MODEL, state, questions });
    const answers: Record<string, { choice: string; probabilities: Record<string, number> }> = {};
    for (const f of fields) {
      const a = (result.answers as Record<string, { choice?: string; probabilities?: Record<string, number> } | undefined>)[f.id];
      if (!a || typeof a.choice !== 'string') continue;
      answers[f.id] = { choice: a.choice, probabilities: a.probabilities ?? {} };
    }
    return NextResponse.json({ answers, model: MODEL });
  } catch (e) {
    // 本文（断片や項目名）はログに出さない。種別だけ
    const reason = e instanceof Error ? e.name : 'error';
    console.warn(`[fill/map] evaluate failed: ${reason}`);
    return NextResponse.json({ disabled: true, reason: 'gateway_unavailable' }, { status: 503 });
  }
}
