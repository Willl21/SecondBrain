# Second Brain

Catatan pribadi + tanya jawab AI ke catatan sendiri (RAG). PWA, bisa di-install ke iPhone.

**Stack:** React + TypeScript (Vite) · Cloudflare Workers (static assets) · D1 · Vectorize · Gemini API

## Cara kerja
1. Catatan disimpan di D1, lalu di-embed (Gemini Embedding) dan vektornya disimpan di Vectorize.
2. Pertanyaan di-embed, 5 catatan paling mirip diambil, lalu dikirim ke Gemini Flash Lite sebagai konteks.
3. Kalau model pertama kena limit (429), otomatis pindah ke model berikutnya di `CHAT_MODELS`.

## Setup
```bash
npm install
npx wrangler login
npx wrangler d1 create second-brain                # salin database_id ke wrangler.jsonc
npx wrangler d1 execute second-brain --remote --file=schema.sql
npx wrangler d1 execute second-brain --local --file=schema.sql
npx wrangler vectorize create second-brain --dimensions=768 --metric=cosine
```
Isi `.dev.vars` (`GEMINI_API_KEY`, `APP_TOKEN`), lalu cek ID model di `wrangler.jsonc` sesuai yang ada di AI Studio.

## Jalanin
```bash
npm run dev      # API lokal di :8787 (Vectorize tetap pakai index asli di Cloudflare)
npm run dev:web  # frontend (Vite) di terminal lain, /api di-proxy ke :8787
npm test         # test fallback model
npm run check    # type check backend + frontend
```

## Deploy
```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put APP_TOKEN
npm run deploy
```
Buka URL `*.workers.dev` di Safari iPhone → Share → **Add to Home Screen**.
