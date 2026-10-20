# Progress — Second Brain

_Terakhir diupdate: 2026-10-20_

## Status
- MVP jadi: catatan (CRUD), tanya ke catatan (RAG), PWA, login pakai `APP_TOKEN`.
- 20 Okt: frontend pindah ke React + TSX (Vite, `web/`), ikon PNG logo Berserk, fitur Import file (`/api/extract`, review dulu sebelum simpan). Dites lokal (teks + PDF), BELUM di-deploy.
- Live: https://second-brain.apaya357.workers.dev (Worker dikunci di region `gcp:us-central1`, jalan di Omaha/OMA).
- D1 `second-brain` (id `278b2ff4-…`) + Vectorize `second-brain` (768 dim, cosine) sudah dibuat, schema sudah di-apply ke remote.
- Secrets `APP_TOKEN` & `GEMINI_API_KEY` sudah di-set di Cloudflare.
- `npm test` (fallback model) + `npm run check` lolos.
- ID model terverifikasi: `gemini-embedding-2` jalan (768 dim). Model chat `gemini-3.5-flash-lite` sempat menjawab sekali → kemungkinan valid.

## Masalah yang lagi dikejar
**Gemini kadang balas `400 User location is not supported`** di production.
- Dari laptop (loc=ID, WARP off) Gemini jalan normal.
- Production sudah `Cf-Placement: remote-OMA` (AS), tapi error tetap muncul kadang-kadang.
- Dugaan: Google cek lokasi dari IP keluar Cloudflare, sebagian kebaca negara yang diblokir (mis. HK).
- Sudah ditambah diagnosa: pesan error `/api/ask` sekarang diakhiri `[colo=... loc=...]`.

**Langkah berikutnya:**
1. `npm run deploy` (perubahan diagnosa belum di-deploy).
2. Dari HP pakai fitur **Tanya** sampai error muncul, catat `[colo=... loc=...]`.
3. Tentukan solusi berdasarkan lokasinya (mis. ganti region placement, atau proxy Gemini lewat tempat lain).
4. Setelah beres, hapus/biarkan diagnosa lokasi di `src/index.ts` (catch block).

## Catatan penting
- ISP XL/Axiata memblokir `*.workers.dev` (DNS ke blockpage). Akses pakai 1.1.1.1 (HP) / Secure DNS (Chrome).
  `wrangler tail` juga gagal karena blokir yang sama.
- Database production masih kosong — catatan percobaan sebelumnya masuk ke D1 **lokal** (`npm run dev`).
- Jangan pakai WARP di laptop saat `npm run dev` (bisa keluar lewat HK → ditolak Gemini).
- Jangan ganti `EMBED_MODEL` setelah ada catatan (vektor beda model nggak bisa dicampur).

## Belum dikerjakan
- Domain sendiri (biar nggak kena blokir ISP + aman ditaruh di CV).
- `APP_TOKEN` production → ganti ke string acak panjang kalau belum.
- Chunking catatan panjang yang ditulis manual (import file sudah otomatis dipecah), push notif / service worker.
- Import: file > ~10 MB belum didukung (base64 lewat JSON); kalau kena CPU limit Worker, pindah ke Gemini File API.
