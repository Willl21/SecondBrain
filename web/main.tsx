import { StrictMode, useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import type { Note, Source } from "../src/types.ts";
import { Import } from "./Import.tsx";
import "./style.css";

function savedToken(): string {
  try { return localStorage.getItem("token") ?? ""; } catch { return ""; }
}

function App() {
  const [token, setToken] = useState(savedToken);
  const [notes, setNotes] = useState<Note[]>([]);
  const [editing, setEditing] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<{ text: string; sources: Source[] } | null>(null);
  const formTitle = useRef<HTMLHeadingElement>(null);

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    });
    if (res.status === 401) { setToken(""); throw new Error("Token salah"); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  const load = async () => setNotes(await api<Note[]>("/api/notes"));

  useEffect(() => { if (token) load().catch(() => {}); }, [token]);

  function edit(n: Note | null) {
    setEditing(n);
    setTitle(n?.title ?? "");
    setBody(n?.body ?? "");
    setConfirmDelete(false);
    setStatus("");
    if (n) formTitle.current?.scrollIntoView({ behavior: "smooth" });
  }

  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const t = String(new FormData(e.currentTarget).get("token"));
    try { localStorage.setItem("token", t); } catch {}
    setToken(t);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = JSON.stringify({ title, body });
      const r = editing
        ? await api<{ indexed: boolean }>(`/api/notes/${editing.id}`, { method: "PUT", body: payload })
        : await api<{ indexed: boolean }>("/api/notes", { method: "POST", body: payload });
      edit(null);
      setStatus(r.indexed ? "Tersimpan." : "Tersimpan, tapi belum terindeks (limit AI?). Tekan Index ulang nanti.");
      await load();
    } catch (err) {
      setStatus((err as Error).message); // isi form dibiarkan biar tulisan nggak hilang
    } finally {
      setSaving(false);
    }
  }

  // Tap pertama minta konfirmasi, tap kedua baru hapus.
  async function remove() {
    if (!editing) return;
    if (!confirmDelete) return setConfirmDelete(true);
    try { await api(`/api/notes/${editing.id}`, { method: "DELETE" }); edit(null); await load(); }
    catch (err) { setStatus((err as Error).message); }
  }

  async function reindex() {
    try {
      const r = await api<{ reindexed: number; failed: number }>("/api/reindex", { method: "POST" });
      setStatus(`Terindeks ${r.reindexed}, gagal ${r.failed}.`);
      await load();
    } catch (err) { setStatus((err as Error).message); }
  }

  async function ask(e: FormEvent) {
    e.preventDefault();
    setAnswer({ text: "Mikir…", sources: [] });
    try {
      const r = await api<{ answer: string; sources: Source[] }>("/api/ask", { method: "POST", body: JSON.stringify({ q }) });
      setAnswer({ text: r.answer, sources: r.sources });
    } catch (err) {
      setAnswer({ text: (err as Error).message, sources: [] });
    }
  }

  if (!token) {
    return (
      <>
        <h1>Second Brain</h1>
        <form onSubmit={login}>
          <label htmlFor="token">Token akses</label>
          <input id="token" name="token" type="password" autoComplete="current-password" required />
          <button>Masuk</button>
        </form>
      </>
    );
  }

  return (
    <>
      <h1>Second Brain</h1>
      <main>
        <form onSubmit={ask}>
          <label htmlFor="q" className="muted">Tanya ke catatan kamu</label>
          <div className="row">
            <input id="q" enterKeyHint="send" placeholder="Misal: apa itu RAG?" required value={q} onChange={(e) => setQ(e.target.value)} />
            <button>Tanya</button>
          </div>
        </form>
        {answer && (
          <div className="card answer" aria-live="polite">
            {answer.text}
            {answer.sources.length > 0 && (
              <p className="muted">Sumber: {answer.sources.map((s) => `#${s.id} ${s.title || "Tanpa judul"}`).join(", ")}</p>
            )}
          </div>
        )}

        <h2 ref={formTitle}>{editing ? "Edit catatan" : "Catatan baru"}</h2>
        <form onSubmit={save}>
          <input placeholder="Judul" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea placeholder="Tulis catatan…" required value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="row">
            <button disabled={saving}>Simpan</button>
            {editing && (
              <>
                <button type="button" className="ghost" onClick={() => edit(null)}>Batal</button>
                <button type="button" className="ghost" onClick={remove}>{confirmDelete ? "Yakin?" : "Hapus"}</button>
              </>
            )}
          </div>
          <p className="muted" aria-live="polite">{status}</p>
        </form>

        <Import api={api} onSaved={load} />

        <h2>
          Catatan{" "}
          {notes.some((n) => !n.indexed) && <button type="button" className="ghost" onClick={reindex}>Index ulang</button>}
        </h2>
        {notes.length === 0 && <p className="muted">Belum ada catatan.</p>}
        {notes.map((n) => (
          <button key={n.id} type="button" className="card note" onClick={() => edit(n)}>
            <strong>{(n.title || "Tanpa judul") + (n.indexed ? "" : " · belum terindeks")}</strong>
            <p>{n.body}</p>
          </button>
        ))}
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
