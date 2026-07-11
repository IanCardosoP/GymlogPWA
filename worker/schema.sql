CREATE TABLE IF NOT EXISTS pings (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT NOT NULL,
  device_id TEXT NOT NULL,
  evt       TEXT NOT NULL,
  v         TEXT
);
CREATE INDEX IF NOT EXISTS idx_device ON pings(device_id);
