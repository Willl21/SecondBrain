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

type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export async function embed(key: string, model: string, text: string, taskType: TaskType): Promise<number[]> {
  return (await embedMany(key, model, [text], taskType))[0];
}

// Banyak teks dalam satu request (batchEmbedContents).
export async function embedMany(key: string, model: string, texts: string[], taskType: TaskType): Promise<number[][]> {
  const res = await call(key, model, "batchEmbedContents", {
    requests: texts.map((text) => ({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: DIMS,
    })),
  });
  if (!res.ok) throw new Error(`embed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { embeddings: { values: number[] }[] };
  return data.embeddings.map((e) => e.values);
}

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

// Coba model satu per satu; pindah ke berikutnya cuma kalau kena limit (429) atau overload (503).
export async function chat(
  key: string,
  models: string[],
  system: string,
  prompt: string | Part[],
  generationConfig?: object,
): Promise<string> {
  let last = "";
  for (const model of models) {
    const res = await call(key, model, "generateContent", {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: typeof prompt === "string" ? [{ text: prompt }] : prompt }],
      generationConfig,
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
