-- Up
CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO app_settings (key, value, updated_at)
VALUES ('google_sheet_id', '', datetime('now'));

-- Down
DROP TABLE IF EXISTS app_settings;
