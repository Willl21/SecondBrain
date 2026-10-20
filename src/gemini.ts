// Gemini REST langsung via fetch — nggak perlu SDK.
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
export const DIMS = 768; // harus sama dengan --dimensions waktu bikin index Vectorize

async function call(key: string, model: string, method: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}/${model}:${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
  });
}

export async function embed(
  key: string,
  model: string,
  text: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
): Promise<number[]> {
  const res = await call(key, model, "embedContent", {
    content: { parts: [{ text }] },
    taskType,
    outputDimensionality: DIMS,
  });
  if (!res.ok) throw new Error(`embed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { embedding: { values: number[] } };
  return data.embedding.values;
}

// Coba model satu per satu; pindah ke berikutnya cuma kalau kena limit (429) atau overload (503).
export async function chat(key: string, models: string[], system: string, prompt: string): Promise<string> {
  let last = "";
  for (const model of models) {
    const res = await call(key, model, "generateContent", {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    if (res.status === 429 || res.status === 503) {
      last = `${model} ${res.status}`;
      continue;
    }
    if (!res.ok) throw new Error(`chat ${model} ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  }
  throw new Error(`Semua model kena limit (${last}). Coba lagi nanti.`);
}
