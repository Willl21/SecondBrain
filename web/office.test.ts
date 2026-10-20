import { test } from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { officeText } from "./office.ts";

// Satu paragraf OOXML: <x:p><x:r><x:t>run</x:t></x:r>...</x:p>
const p = (ns: string, ...runs: string[]) =>
  `<${ns}:p>${runs.map((r) => `<${ns}:r><${ns}:t>${r}</${ns}:t></${ns}:r>`).join("")}</${ns}:p>`;

test("pptx: slide urut angka, paragraf per baris, entity di-decode, notes nggak ikut", () => {
  const zip = zipSync({
    "ppt/slides/slide10.xml": strToU8(`<p:sld>${p("a", "Sepuluh")}</p:sld>`),
    "ppt/slides/slide2.xml": strToU8(`<p:sld>${p("a", "R&amp;D ", "itu")}${p("a", "&#233;&#x41;")}</p:sld>`),
    "ppt/notesSlides/notesSlide1.xml": strToU8(p("a", "jangan ikut")),
  });
  assert.equal(officeText(zip), "--- Slide 2 ---\nR&D itu\néA\n\n--- Slide 10 ---\nSepuluh");
});

test("docx: ambil word/document.xml", () => {
  const zip = zipSync({ "word/document.xml": strToU8(`<w:body>${p("w", "Halo ", "dunia")}${p("w", "baris 2")}</w:body>`) });
  assert.equal(officeText(zip), "Halo dunia\nbaris 2");
});
