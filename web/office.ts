import { strFromU8, unzipSync } from "fflate";

// PPTX/DOCX itu zip isi XML. Ambil teksnya aja; gambar/diagram/chart nggak kebaca (export ke PDF kalau penting).
const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] !== "#" ? (ENTITIES[e] ?? m) : String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))),
  );

// Satu baris per paragraf (<a:p> di slide, <w:p> di Word).
const paragraphs = (xml: string, tag: string) =>
  xml.split(`</${tag}>`).map((p) => decode(p.replace(/<[^>]+>/g, "")).trim()).filter(Boolean).join("\n");

const slideNo = (path: string) => Number(path.match(/(\d+)\.xml$/)![1]);

export function officeText(zip: Uint8Array): string {
  const files = unzipSync(zip, { filter: (f) => /^ppt\/slides\/slide\d+\.xml$|^word\/document\.xml$/.test(f.name) });
  const doc = files["word/document.xml"];
  if (doc) return paragraphs(strFromU8(doc), "w:p");
  return Object.keys(files)
    .sort((a, b) => slideNo(a) - slideNo(b)) // slide10 jangan sampai sebelum slide2
    .map((path) => `--- Slide ${slideNo(path)} ---\n${paragraphs(strFromU8(files[path]), "a:p")}`)
    .join("\n\n");
}
