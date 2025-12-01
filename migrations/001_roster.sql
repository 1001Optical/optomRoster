-- Up
BEGIN;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ROSTER (
                                      id            INTEGER PRIMARY KEY,           -- Roster id (문자열)
                                      employeeId    INTEGER         ,           -- Employee id
                                      firstName     TEXT            ,           -- Employee name
                                      lastName      TEXT            ,           -- Employee name
                                      locationId    INTEGER NOT NULL,           -- Location id
                                      locationName  TEXT    NOT NULL,           -- Location name
                                      startTime     TEXT    NOT NULL,           -- ISO 8601 (e.g. 2025-09-07T09:00:00)
                                      endTime       TEXT    NOT NULL,            -- ISO 8601
                                      email         TEXT,
                                      isLocum       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ROSTER_BREAK (
                                            id           INTEGER PRIMARY KEY,            -- Break id
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

CREATE INDEX IF NOT EXISTS idx_roster_time_location ON ROSTER (startTime, locationId);
CREATE INDEX IF NOT EXISTS idx_roster_employee_time ON ROSTER (employeeId, startTime);
CREATE INDEX IF NOT EXISTS idx_roster_end_time ON ROSTER (endTime);
CREATE INDEX IF NOT EXISTS idx_break_end_time ON ROSTER_BREAK (endTime);
CREATE INDEX IF NOT EXISTS idx_break_roster_time ON ROSTER_BREAK (rosterId, startTime);

DROP TRIGGER IF EXISTS roster_any_change;

CREATE TRIGGER roster_any_change
    AFTER UPDATE ON ROSTER
    WHEN
        OLD.employeeId   IS NOT NEW.employeeId OR
        OLD.firstName IS NOT NEW.firstName OR
        OLD.lastName IS NOT NEW.lastName OR
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
                       'firstName',    OLD.firstName,
                       'lastName',     OLD.lastName,
                       'locationId',   OLD.locationId,
                       'locationName', OLD.locationName,
                       'startTime',    OLD.startTime,
                       'endTime',      OLD.endTime,
                       'email',        OLD.email,
                       'isLocum',      OLD.isLocum
                              ),
                       'new', json_object(
                               'employeeId',   NEW.employeeId,
                               'firstName',    NEW.firstName,
                               'lastName',     NEW.lastName,
                               'locationId',   NEW.locationId,
                               'locationName', NEW.locationName,
                               'startTime',    NEW.startTime,
                               'endTime',      NEW.endTime,
                               'email',        NEW.email,
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
                       'firstName',    NEW.firstName,
                       'lastName',     NEW.lastName,
                       'locationId',   NEW.locationId,
                       'locationName', NEW.locationName,
                       'startTime',    NEW.startTime,
                       'endTime',      NEW.endTime,
                       'email',        NEW.email,
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
                       'firstName',    OLD.firstName,
                       'lastName',     OLD.lastName,
                       'locationId',   OLD.locationId,
                       'locationName', OLD.locationName,
                       'startTime',    OLD.startTime,
                       'endTime',      OLD.endTime,
                       'email',        OLD.email,
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

DROP TRIGGER IF EXISTS roster_any_change;
DROP TRIGGER IF EXISTS roster_insert_log;
DROP TRIGGER IF EXISTS roster_delete_log;

DROP INDEX IF EXISTS idx_roster_time_location;
DROP INDEX IF EXISTS idx_roster_employee_time;
DROP INDEX IF EXISTS idx_roster_end_time;
DROP INDEX IF EXISTS idx_break_end_time;
DROP INDEX IF EXISTS idx_break_roster_time;

COMMIT;