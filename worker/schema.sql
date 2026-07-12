CREATE TABLE IF NOT EXISTS pings (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT NOT NULL,
  device_id TEXT NOT NULL,
  evt       TEXT NOT NULL,
  v         TEXT,
  pwa       INTEGER NOT NULL DEFAULT 0,       -- 1 = instalada como PWA (standalone), 0 = pestaña de navegador
  os        TEXT    NOT NULL DEFAULT 'other'  -- 'ios' | 'android' | 'other'
);
CREATE INDEX IF NOT EXISTS idx_device ON pings(device_id);
