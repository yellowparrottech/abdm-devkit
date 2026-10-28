-- Callbacks received from the ABDM gateway, kept until the core acknowledges them.
CREATE TABLE IF NOT EXISTS callbacks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL,
  received_at TEXT NOT NULL,
  headers TEXT NOT NULL,
  body TEXT NOT NULL
);

-- Request IDs seen recently, kept after their callback is deleted so replays are still refused.
CREATE TABLE IF NOT EXISTS seen_requests (
  request_id TEXT PRIMARY KEY,
  seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS seen_requests_seen_at ON seen_requests (seen_at);
