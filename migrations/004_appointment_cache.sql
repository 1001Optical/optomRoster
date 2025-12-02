-- Up
-- 예약 개수 영구 저장 테이블 (과거 날짜는 변하지 않으므로 영구 저장)
CREATE TABLE IF NOT EXISTS appointment_count_cache (
    branch TEXT NOT NULL,
    date TEXT NOT NULL,
    count INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (branch, date)
);

CREATE INDEX IF NOT EXISTS idx_appointment_cache_date ON appointment_count_cache (date);
CREATE INDEX IF NOT EXISTS idx_appointment_cache_updated ON appointment_count_cache (updated_at);

-- Down
DROP INDEX IF EXISTS idx_appointment_cache_date;
DROP INDEX IF EXISTS idx_appointment_cache_updated;
DROP TABLE IF EXISTS appointment_count_cache;

