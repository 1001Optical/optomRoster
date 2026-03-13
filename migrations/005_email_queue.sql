-- Up
CREATE TABLE IF NOT EXISTS EMAIL_QUEUE (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    webhookType TEXT    NOT NULL,                       -- 'first' | 'existing'
    payload     TEXT    NOT NULL,                       -- PostEmailData JSON
    status      TEXT    NOT NULL DEFAULT 'pending',     -- 'pending' | 'sent' | 'failed' | 'abandoned'
    retryCount  INTEGER NOT NULL DEFAULT 0,
    nextRetryAt TEXT    NOT NULL,                       -- ISO 8601 (datetime('now') 기준)
    lastError   TEXT,
    createdAt   TEXT    NOT NULL DEFAULT (datetime('now')),
    updatedAt   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_queue_status ON EMAIL_QUEUE (status, nextRetryAt);

-- Down
DROP INDEX IF EXISTS idx_email_queue_status;
DROP TABLE IF EXISTS EMAIL_QUEUE;
