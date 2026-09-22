# The relay (`/api/fill/map`)

`route.ts` is the Next.js route handler that the page posts to. It is the only server-side code, and the only place that talks to Jev.

- Runs on Vercel and calls `typesafe-ai/jev` through **Vercel AI Gateway** with the AI SDK (`experimental_evaluate`). Authentication is the function's OIDC token, so no API key is stored anywhere. To run it elsewhere, set `AI_GATEWAY_API_KEY` or point a TypeSafe client at `https://ai-gateway.vercel.sh/typesafe`.
- Accepts only `{ title, keys: [{key,label}], fields: [{id, page, fragments[], w, h, multiline}] }`. Fragments are clipped to 6 × 40 chars, labels to 30 chars, at most 120 fields and 60 keys per request. Anything else is a 400.
- Builds one `choice` question per field; criteria are the key labels plus `none`. Returns `{ answers: { [id]: { choice, probabilities } } }`.
- Rate limit per IP (20 / 10 min) and a daily cap (`FILL_DAILY_CAP`, default 2000). When the gateway is unreachable or the cap is hit it returns `503 { disabled: true, reason }` and the page falls back to tap-to-pick.
- Never logs request bodies. On failure it logs the error *name* only.

`rateLimit` is a small in-memory helper (per instance); copy any equivalent.
