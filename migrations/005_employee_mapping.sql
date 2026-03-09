-- Up
CREATE TABLE IF NOT EXISTS employee_name_mapping (
    sheet_name   TEXT    PRIMARY KEY,   -- 스프레드시트에 적힌 이름
    employee_id  INTEGER NOT NULL,      -- EH employeeId
    employee_name TEXT   NOT NULL,      -- EH에 등록된 풀네임 (표시용)
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Down
DROP TABLE IF EXISTS employee_name_mapping;
