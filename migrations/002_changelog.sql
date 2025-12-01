-- Up
CREATE TABLE IF NOT EXISTS CHANGE_LOG (
                                          id           INTEGER PRIMARY KEY AUTOINCREMENT,
                                          rosterId     TEXT    NOT NULL,                 -- ROSTER.id
                                          changeType   TEXT    NOT NULL,                 -- 'created' | 'updated' | 'deleted'
                                          whenDetected TEXT    NOT NULL,                 -- ISO 8601 (로그 생성 시각)
    -- 어떤 기간 동기화 중 발생했는지(쿼리 편의)
                                          windowStart  TEXT    NOT NULL,                 -- ISO 8601
                                          windowEnd    TEXT    NOT NULL,                 -- ISO 8601
    -- 변경 요약(선택: 필드별 차이)
                                          diffSummary  TEXT                             -- JSON 문자열
    -- 참조 무결성(선택): 삭제 로그는 부모가 없어질 수 있어 FK는 옵션
    -- FOREIGN KEY(rosterId) REFERENCES ROSTER(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS employee_cache (
                                              employee_id INTEGER PRIMARY KEY,
                                              data TEXT NOT NULL,
                                              updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_change_log_window
    ON CHANGE_LOG (windowStart, windowEnd, whenDetected);

CREATE INDEX IF NOT EXISTS idx_change_log_roster
    ON CHANGE_LOG (rosterId);

CREATE INDEX IF NOT EXISTS idx_change_log_type ON CHANGE_LOG (changeType);
CREATE INDEX IF NOT EXISTS idx_change_log_detected ON CHANGE_LOG (whenDetected);

-- Down
DROP TABLE IF EXISTS CHANGE_LOG;
DROP INDEX IF EXISTS idx_change_log_window;
DROP INDEX IF EXISTS idx_change_log_roster;
DROP TABLE IF EXISTS employee_cache;

DROP INDEX IF EXISTS idx_change_log_type;
DROP INDEX IF EXISTS idx_change_log_detected;