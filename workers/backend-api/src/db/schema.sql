PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Utilities',
  icon_url TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_screenshots (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  image_url TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_app_screenshots_app_id ON app_screenshots(app_id, position ASC);

CREATE TABLE IF NOT EXISTS build_history (
  id TEXT PRIMARY KEY,
  run_id INTEGER,
  workflow TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'matrix',
  status TEXT NOT NULL CHECK (status IN ('queued', 'in_progress', 'success', 'failed', 'cancelled', 'skipped', 'unknown')),
  commit_sha TEXT NOT NULL DEFAULT '',
  requested_by TEXT NOT NULL DEFAULT '',
  source_ref TEXT NOT NULL DEFAULT 'main',
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  html_url TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_build_history_created_at ON build_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_build_history_status ON build_history(status);

CREATE TABLE IF NOT EXISTS build_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  build_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (build_id) REFERENCES build_history(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_build_events_build_id ON build_events(build_id, created_at DESC);

CREATE TABLE IF NOT EXISTS release_metadata (
  id TEXT PRIMARY KEY,
  app_id TEXT,
  app_name TEXT NOT NULL,
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  filename TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  signature_status TEXT NOT NULL DEFAULT 'unverified',
  minimum_os TEXT NOT NULL DEFAULT '',
  release_notes TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (app_id) REFERENCES apps(id)
);
CREATE INDEX IF NOT EXISTS idx_release_metadata_public ON release_metadata(is_public, platform, published_at DESC);

CREATE TABLE IF NOT EXISTS source_sync_logs (
  id TEXT PRIMARY KEY,
  commit_sha TEXT NOT NULL,
  file_count INTEGER NOT NULL,
  requested_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success'
);

CREATE TABLE IF NOT EXISTS self_heal_attempts (
  id TEXT PRIMARY KEY,
  run_id INTEGER NOT NULL UNIQUE,
  commit_sha TEXT NOT NULL,
  source_ref TEXT NOT NULL DEFAULT 'main',
  status TEXT NOT NULL CHECK (status IN ('started', 'proposed', 'applied', 'skipped', 'failed', 'rate_limited')),
  patch_count INTEGER NOT NULL DEFAULT 0,
  patch_commit_sha TEXT NOT NULL DEFAULT '',
  diagnostics_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_self_heal_created_at ON self_heal_attempts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_self_heal_commit_sha ON self_heal_attempts(commit_sha);
