CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  indexed INTEGER NOT NULL DEFAULT 0, -- 0 = belum masuk Vectorize (mis. embedding kena limit)
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
