import { test } from "node:test";
import assert from "node:assert/strict";
import { chat } from "./gemini.ts";

test("chat pindah ke model berikutnya kalau kena 429, error lain langsung throw", async () => {
  const hit: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const model = url.split("/models/")[1].split(":")[0];
    hit.push(model);
    if (model === "a") return new Response("limit", { status: 429 });
    if (model === "bad") return new Response("nope", { status: 400 });
    return Response.json({ candidates: [{ content: { parts: [{ text: "halo" }] } }] });
  }) as typeof fetch;

  assert.equal(await chat("k", ["a", "b"], "s", "p"), "halo");
  assert.deepEqual(hit, ["a", "b"]);

  await assert.rejects(chat("k", ["a", "a"], "s", "p"), /Semua model kena limit/);
  await assert.rejects(chat("k", ["bad", "b"], "s", "p"), /chat bad 400/);
});
