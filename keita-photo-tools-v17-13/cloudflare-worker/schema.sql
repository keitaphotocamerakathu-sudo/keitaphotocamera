CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  key_hint TEXT NOT NULL,
  customer_name TEXT,
  photographer_code TEXT,
  plan_type TEXT NOT NULL,
  duration_value INTEGER,
  fixed_expires_at TEXT,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  expires_at TEXT,
  device_id TEXT,
  device_public_jwk TEXT,
  status TEXT NOT NULL DEFAULT 'unused',
  last_seen_at TEXT,
  activation_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_licenses_device ON licenses(device_id);
CREATE INDEX IF NOT EXISTS idx_licenses_created ON licenses(created_at);

CREATE TABLE IF NOT EXISTS activation_attempts (
  id TEXT PRIMARY KEY,
  bucket INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activation_attempts_bucket ON activation_attempts(bucket);
