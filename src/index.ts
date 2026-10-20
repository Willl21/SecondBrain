import { chat, embed, embedMany, type Part } from "./gemini.ts";
import type { Draft, Note, Source } from "./types.ts";

// Format yang bisa dibaca Gemini langsung. PPTX/DOCX/TXT diubah jadi teks di browser.
const FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];

const EXTRACT_PROMPT =
  "Kamu memilah dokumen jadi catatan second brain. Ambil HANYA yang layak diingat jangka panjang: konsep, definisi, " +
  "fakta, rumus, keputusan, langkah penting. Buang basa-basi, daftar isi, slide judul, header/footer, dan pengulangan. " +
  "Tiap catatan satu ide, bisa dipahami tanpa dokumen aslinya, judul singkat, isi padat. Pakai bahasa dokumen. " +
  "Maksimal 15 catatan. Kalau nggak ada yang penting, kembalikan array kosong.";

const DRAFTS_SCHEMA = {
  responseMimeType: "application/json",
  responseSchema: {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: { title: { type: "STRING" }, body: { type: "STRING" } },
      required: ["title", "body"],
    },
  },
};

const json = (data: unknown, status = 200) => Response.json(data, { status });

// ponytail: satu token bersama, cukup buat app pribadi. Ganti ke Cloudflare Access kalau dipakai banyak orang.
function authorized(req: Request, token: string | undefined): boolean {
  if (!token) return false; // secret belum di-set = tolak semua, jangan sampai "Bearer undefined" lolos
  const a = new TextEncoder().encode(req.headers.get("authorization") ?? "");
  const b = new TextEncoder().encode(`Bearer ${token}`);
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

// Simpan vektor catatan. Gagal (mis. limit habis) = catatan tetap aman di D1, indexed tetap 0.
// ponytail: satu vektor per catatan (teks kepotong di batas model), pecah jadi chunk kalau catatannya panjang-panjang.
async function index(env: Env, note: Pick<Note, "id" | "title" | "body">): Promise<boolean> {
  try {
    const values = await embed(env.GEMINI_API_KEY, env.EMBED_MODEL, `${note.title}\n\n${note.body}`, "RETRIEVAL_DOCUMENT");
    await env.VECTORS.upsert([{ id: String(note.id), values }]);
    await env.DB.prepare("UPDATE notes SET indexed = 1 WHERE id = ?").bind(note.id).run();
    return true;
  } catch (e) {
    console.error("index gagal", note.id, e);
    return false;
  }
}

// Diukur 20 Okt (gemini-embedding-2): isi sama beda kalimat ±0.90, topik dekat tapi beda ±0.74.
// Naikkan kalau catatan beda ikut ketandai, turunkan kalau dobel lolos.
const SIMILAR = 0.85;

// Tandai usulan yang mirip catatan lama, biar import file yang sama dua kali nggak bikin dobel.
async function markSimilar(env: Env, drafts: Draft[]): Promise<Draft[]> {
  if (!drafts.length) return drafts;
  const vectors = await embedMany(env.GEMINI_API_KEY, env.EMBED_MODEL, drafts.map((d) => `${d.title}\n\n${d.body}`), "RETRIEVAL_DOCUMENT");
  const best = await Promise.all(vectors.map(async (v) => (await env.VECTORS.query(v, { topK: 1 })).matches[0]));
  const ids = best.filter((m) => m && m.score >= SIMILAR).map((m) => Number(m.id));
  if (!ids.length) return drafts;
  const { results } = await env.DB.prepare(`SELECT id, title FROM notes WHERE id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids).all<Source>();
  return drafts.map((d, i) => {
    const similar = results.find((n) => String(n.id) === best[i]?.id && best[i].score >= SIMILAR);
    return similar ? { ...d, similar } : d;
  });
}

async function readNote(req: Request): Promise<{ title: string; body: string } | null> {
  const data = (await req.json().catch(() => null)) as { title?: unknown; body?: unknown } | null;
  if (typeof data?.body !== "string" || !data.body.trim()) return null;
  const title = typeof data.title === "string" ? data.title.slice(0, 200) : "";
  return { title, body: data.body.slice(0, 100_000) };
}

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    if (!authorized(req, env.APP_TOKEN)) return json({ error: "unauthorized" }, 401);

    const [, , resource, rawId] = url.pathname.split("/");
    const id = Number(rawId);

    try {
      if (resource === "notes" && !rawId && req.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM notes ORDER BY updated_at DESC").all<Note>();
        return json(results);
      }

      if (resource === "notes" && !rawId && req.method === "POST") {
        const note = await readNote(req);
        if (!note) return json({ error: "body wajib diisi" }, 400);
        const row = await env.DB.prepare("INSERT INTO notes (title, body) VALUES (?, ?) RETURNING id")
          .bind(note.title, note.body).first<{ id: number }>();
        const indexed = await index(env, { id: row!.id, ...note });
        return json({ id: row!.id, indexed }, 201);
      }

      if (resource === "notes" && Number.isInteger(id) && req.method === "PUT") {
        const note = await readNote(req);
        if (!note) return json({ error: "body wajib diisi" }, 400);
        const { meta } = await env.DB.prepare(
          "UPDATE notes SET title = ?, body = ?, indexed = 0, updated_at = datetime('now') WHERE id = ?",
        ).bind(note.title, note.body, id).run();
        if (!meta.changes) return json({ error: "not found" }, 404);
        return json({ id, indexed: await index(env, { id, ...note }) });
      }

      if (resource === "notes" && Number.isInteger(id) && req.method === "DELETE") {
        await env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(id).run();
        await env.VECTORS.deleteByIds([String(id)]);
        return json({ ok: true });
      }

      // Ulang embedding catatan yang tadinya gagal di-index.
      if (resource === "reindex" && req.method === "POST") {
        const { results } = await env.DB.prepare("SELECT id, title, body FROM notes WHERE indexed = 0 LIMIT 50").all<Note>();
        let ok = 0;
        for (const n of results) if (await index(env, n)) ok++;
        return json({ reindexed: ok, failed: results.length - ok });
      }

      // File -> usulan catatan. Belum disimpan; user pilih dulu, lalu frontend POST /api/notes satu per satu.
      if (resource === "extract" && req.method === "POST") {
        const { name, text, file, mimeType } = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        let parts: Part[];
        if (typeof text === "string" && text.trim()) parts = [{ text: text.slice(0, 200_000) }];
        // ponytail: file base64 lewat JSON, maks ~10 MB. Kalau CPU limit Worker kena, pindah ke Gemini File API.
        else if (typeof file === "string" && file.length <= 14_000_000 && FILE_TYPES.includes(String(mimeType)))
          parts = [{ inlineData: { mimeType: String(mimeType), data: file } }];
        else return json({ error: "File kosong, kegedean, atau formatnya nggak didukung" }, 400);

        const out = await chat(
          env.GEMINI_API_KEY,
          env.CHAT_MODELS.split(","),
          EXTRACT_PROMPT,
          [{ text: `Nama file: ${String(name ?? "").slice(0, 200)}` }, ...parts],
          DRAFTS_SCHEMA,
        );
        const drafts = (JSON.parse(out) as Draft[])
          .filter((d) => typeof d?.title === "string" && typeof d?.body === "string" && d.body.trim())
          .slice(0, 15);
        // Cek dobel itu bonus; kalau gagal (mis. limit embedding), usulan tetap dikirim tanpa tanda.
        return json({ drafts: await markSimilar(env, drafts).catch((e) => (console.error("markSimilar", e), drafts)) });
      }

      if (resource === "ask" && req.method === "POST") {
        const { q } = (await req.json().catch(() => ({}))) as { q?: unknown };
        if (typeof q !== "string" || !q.trim()) return json({ error: "pertanyaan kosong" }, 400);

        const vector = await embed(env.GEMINI_API_KEY, env.EMBED_MODEL, q.slice(0, 2000), "RETRIEVAL_QUERY");
        const { matches } = await env.VECTORS.query(vector, { topK: 5 });
        const ids = matches.map((m) => Number(m.id));
        const notes = ids.length
          ? (await env.DB.prepare(`SELECT id, title, body FROM notes WHERE id IN (${ids.map(() => "?").join(",")})`)
              .bind(...ids).all<Note>()).results
          : [];

        const context = notes.map((n) => `[#${n.id}] ${n.title}\n${n.body.slice(0, 4000)}`).join("\n\n---\n\n");
        const answer = await chat(
          env.GEMINI_API_KEY,
          env.CHAT_MODELS.split(","),
          "Kamu asisten second brain. Jawab dalam bahasa yang dipakai user, HANYA berdasarkan catatan yang diberikan. " +
            "Sebut sumber dengan format [#id]. Kalau catatan nggak cukup, bilang terus terang.",
          `Catatan:\n${context || "(tidak ada catatan relevan)"}\n\nPertanyaan: ${q}`,
        );
        const sources: Source[] = notes.map((n) => ({ id: n.id, title: n.title }));
        return json({ answer, sources });
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      console.error(e);
      // Lokasi keluar request (colo/negara) — Gemini nolak beberapa negara, ini buat diagnosa.
      const trace = await fetch("https://cloudflare.com/cdn-cgi/trace").then((r) => r.text()).catch(() => "");
      const where = trace.match(/^(colo|loc)=.*$/gm)?.join(" ") ?? "?";
      return json({ error: `${e instanceof Error ? e.message : e} [${where}]` }, 502);
    }
  },
} satisfies ExportedHandler<Env>;
