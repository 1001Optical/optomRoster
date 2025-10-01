-- Up
BEGIN;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ROSTER (
    id            INTEGER PRIMARY KEY,           -- Roster id (문자열)
    employeeId    INTEGER         ,           -- Employee id
    employeeName  TEXT            ,           -- Employee name
    locationId    INTEGER NOT NULL,           -- Location id
    locationName  TEXT    NOT NULL,           -- Location name
    startTime     TEXT    NOT NULL,           -- ISO 8601 (e.g. 2025-09-07T09:00:00)
    endTime       TEXT    NOT NULL,            -- ISO 8601
    isLocum       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ROSTER_BREAK (
    id           INTEGER PRIMARY KEY,            -- Break id (문자열; 외부 시스템 id를 그대로 저장)
    rosterId     INTEGER NOT NULL,               -- 부모 ROSTER.id
    startTime    TEXT    NOT NULL,               -- ISO 8601
    endTime      TEXT    NOT NULL,               -- ISO 8601
    isPaidBreak  INTEGER NOT NULL DEFAULT 0,  -- 0/1 (불리언)
    CONSTRAINT fk_roster
    FOREIGN KEY (rosterId)
    REFERENCES ROSTER(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

-- 조회 최적화를 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_roster_employee ON ROSTER (employeeId);
CREATE INDEX IF NOT EXISTS idx_roster_location ON ROSTER (locationId);
CREATE INDEX IF NOT EXISTS idx_roster_start ON ROSTER (startTime);

CREATE INDEX IF NOT EXISTS idx_break_roster ON ROSTER_BREAK (rosterId);
CREATE INDEX IF NOT EXISTS idx_break_start  ON ROSTER_BREAK (startTime);

DROP TRIGGER IF EXISTS roster_any_change;

CREATE TRIGGER roster_any_change
    AFTER UPDATE ON ROSTER
    WHEN
        OLD.employeeId   IS NOT NEW.employeeId OR
        OLD.employeeName IS NOT NEW.employeeName OR
        OLD.locationId   IS NOT NEW.locationId OR
        OLD.locationName IS NOT NEW.locationName OR
        OLD.startTime    IS NOT NEW.startTime OR
        OLD.endTime      IS NOT NEW.endTime
BEGIN
    INSERT INTO CHANGE_LOG (
        rosterId, changeType, whenDetected, windowStart, windowEnd, diffSummary
    )
    VALUES (
               NEW.id,
               'roster_changed',
               datetime('now'),
               COALESCE(NEW.startTime, OLD.startTime),
               COALESCE(NEW.endTime,   OLD.endTime),
               json_object(
                       'old', json_object(
                       'employeeId',   OLD.employeeId,
                       'employeeName', OLD.employeeName,
                       'locationId',   OLD.locationId,
                       'locationName', OLD.locationName,
                       'startTime',    OLD.startTime,
                       'endTime',      OLD.endTime,
                       'isLocum',      OLD.isLocum
                              ),
                       'new', json_object(
                               'employeeId',   NEW.employeeId,
                               'employeeName', NEW.employeeName,
                               'locationId',   NEW.locationId,
                               'locationName', NEW.locationName,
                               'startTime',    NEW.startTime,
                               'endTime',      NEW.endTime,
                               'isLocum',      NEW.isLocum
                              )
               )
           );
END;

DROP TRIGGER IF EXISTS roster_insert_log;

CREATE TRIGGER roster_insert_log
    AFTER INSERT ON ROSTER
BEGIN
    INSERT INTO CHANGE_LOG (
        rosterId, changeType, whenDetected, windowStart, windowEnd, diffSummary
    )
    VALUES (
               NEW.id,
               'roster_inserted',
               datetime('now'),
               NEW.startTime,
               NEW.endTime,
               json_object(
                       'new', json_object(
                       'employeeId',   NEW.employeeId,
                       'employeeName', NEW.employeeName,
                       'locationId',   NEW.locationId,
                       'locationName', NEW.locationName,
                       'startTime',    NEW.startTime,
                       'endTime',      NEW.endTime,
                       'isLocum',      NEW.isLocum
                              )
               )
           );
END;

DROP TRIGGER IF EXISTS roster_delete_log;

CREATE TRIGGER roster_delete_log
    AFTER DELETE ON ROSTER
BEGIN
    INSERT INTO CHANGE_LOG (
        rosterId, changeType, whenDetected, windowStart, windowEnd, diffSummary
    )
    VALUES (
               OLD.id,
               'roster_deleted',
               datetime('now'),
               OLD.startTime,
               OLD.endTime,
               json_object(
                       'old', json_object(
                       'employeeId',   OLD.employeeId,
                       'employeeName', OLD.employeeName,
                       'locationId',   OLD.locationId,
                       'locationName', OLD.locationName,
                       'startTime',    OLD.startTime,
                       'endTime',      OLD.endTime,
                       'isLocum',      OLD.isLocum
                              )
               )
           );
END;

COMMIT;

-- Down
BEGIN;

DROP INDEX IF EXISTS idx_break_start;
DROP INDEX IF EXISTS idx_break_roster;
DROP TABLE IF EXISTS ROSTER_BREAK;

DROP INDEX IF EXISTS idx_roster_start;
DROP INDEX IF EXISTS idx_roster_location;
DROP INDEX IF EXISTS idx_roster_employee;
DROP TABLE IF EXISTS ROSTER;

DROP TRIGGER IF EXISTS roster_empid_change;

COMMIT;