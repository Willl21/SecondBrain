import { useState, type ChangeEvent } from "react";
import type { Draft } from "../src/types.ts";
import { officeText } from "./office.ts";

export type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

const MAX_FILE = 10 * 1024 * 1024; // batas kirim ke Gemini lewat Worker, lihat /api/extract

function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// PPTX/DOCX/TXT jadi teks di browser; PDF & gambar dikirim utuh biar Gemini bisa "lihat" isinya.
async function payload(file: File): Promise<{ text: string } | { file: string; mimeType: string }> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["pptx", "docx", "txt", "md"].includes(ext)) {
    const text = ext === "pptx" || ext === "docx" ? officeText(new Uint8Array(await file.arrayBuffer())) : await file.text();
    if (!text.trim()) throw new Error("Nggak ada teks yang kebaca di file ini.");
    return { text };
  }
  if (file.size > MAX_FILE) throw new Error("File maksimal 10 MB.");
  return { file: await base64(file), mimeType: file.type };
}

export function Import({ api, onSaved }: { api: Api; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [drafts, setDrafts] = useState<(Draft & { keep: boolean })[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const chosen = drafts.filter((d) => d.keep);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // biar file yang sama bisa dipilih lagi
    if (!file) return;
    setBusy(true);
    setDrafts([]);
    setName(file.name);
    setStatus("AI lagi baca file…");
    try {
      const body = JSON.stringify({ name: file.name, ...(await payload(file)) });
      const r = await api<{ drafts: Draft[] }>("/api/extract", { method: "POST", body });
      setDrafts(r.drafts.map((d) => ({ ...d, keep: !d.similar })));
      const dupes = r.drafts.filter((d) => d.similar).length;
      setStatus(
        !r.drafts.length ? "AI nggak nemu yang penting di file ini."
        : dupes ? `${dupes} usulan mirip catatan lama, sengaja nggak dicentang. Cek dulu, lalu simpan.`
        : "Buang yang nggak perlu, lalu simpan.",
      );
    } catch (err) {
      setStatus((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Simpan satu per satu; yang sudah tersimpan langsung dibuang dari daftar, jadi kalau gagal di tengah sisanya bisa diulang tanpa dobel.
  async function save() {
    setBusy(true);
    let unindexed = 0;
    try {
      for (const [i, d] of chosen.entries()) {
        setStatus(`Menyimpan ${i + 1}/${chosen.length}…`);
        const r = await api<{ indexed: boolean }>("/api/notes", {
          method: "POST",
          body: JSON.stringify({ title: d.title, body: `${d.body}\n\nSumber: ${name}` }),
        });
        if (!r.indexed) unindexed++;
        setDrafts((prev) => prev.filter((x) => x !== d));
      }
      setDrafts([]);
      setStatus(`Tersimpan ${chosen.length} catatan` + (unindexed ? `, ${unindexed} belum terindeks (tekan Index ulang nanti).` : "."));
    } catch (err) {
      setStatus((err as Error).message);
    } finally {
      setBusy(false);
      onSaved().catch(() => {});
    }
  }

  return (
    <>
      <h2>Import file</h2>
      <input type="file" accept=".pdf,.pptx,.docx,.txt,.md,image/*" onChange={pick} disabled={busy} />
      <p className="muted" aria-live="polite">{status}</p>
      {drafts.length > 0 && (
        <>
          {drafts.map((d, i) => (
            <label key={i} className="card draft">
              <input
                type="checkbox"
                checked={d.keep}
                onChange={() => setDrafts(drafts.map((x, j) => (j === i ? { ...x, keep: !x.keep } : x)))}
              />
              <span>
                <strong>{d.title}</strong>
                {d.similar && <small className="similar">Mirip catatan #{d.similar.id} {d.similar.title || "Tanpa judul"}</small>}
                <p>{d.body}</p>
              </span>
            </label>
          ))}
          <div className="row">
            <button type="button" onClick={save} disabled={busy || !chosen.length}>Simpan {chosen.length} catatan</button>
            <button type="button" className="ghost" onClick={() => { setDrafts([]); setStatus(""); }} disabled={busy}>Batal</button>
          </div>
        </>
      )}
    </>
  );
}
