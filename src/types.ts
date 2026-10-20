// Dipakai bareng backend (src/) dan frontend (web/), jangan import apa pun di sini.
export type Note = { id: number; title: string; body: string; indexed: number; updated_at: string };
export type Source = Pick<Note, "id" | "title">;
export type Draft = Pick<Note, "title" | "body">; // usulan catatan dari file, belum disimpan
