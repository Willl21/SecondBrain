import { chat, embed } from "./gemini.ts";

type Note = { id: number; title: string; body: string; indexed: number; updated_at: string };

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
        return json({ answer, sources: notes.map((n) => ({ id: n.id, title: n.title })) });
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
