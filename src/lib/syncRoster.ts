import {optomData} from "@/types/types";
import Database from "better-sqlite3";

/**
 * 날짜 문자열을 ISO 8601 형식으로 변환
 * "YYYY-MM-DD" -> "YYYY-MM-DDT00:00:00Z"
 */
function convertToISO8601(dateStr: string): string {
    // 이미 ISO 형식인 경우 그대로 반환
    if (dateStr.includes('T')) {
        return dateStr;
    }
    
    // YYYY-MM-DD 형식인 경우 ISO 형식으로 변환
    const dateMatch = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
        return `${dateMatch[1]}T00:00:00Z`;
    }
    
    // 변환 실패 시 원본 반환 (에러는 나중에 발생)
    return dateStr;
}

/**
 * 날짜 범위의 종료일을 다음 날 00:00:00Z로 변환 (exclusive end)
 */
function convertEndDateToISO8601(dateStr: string): string {
    // 이미 ISO 형식인 경우 그대로 반환
    if (dateStr.includes('T')) {
        return dateStr;
    }
    
    // YYYY-MM-DD 형식인 경우 다음 날 00:00:00Z로 변환
    const dateMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (dateMatch) {
        const [, year, month, day] = dateMatch;
        const yearNum = parseInt(year, 10);
        const monthNum = parseInt(month, 10);
        const dayNum = parseInt(day, 10);
        
        // 다음 날 계산
        const nextDay = new Date(Date.UTC(yearNum, monthNum - 1, dayNum + 1));
        return nextDay.toISOString().split('.')[0] + 'Z'; // .000 제거
    }
    
    // 변환 실패 시 원본 반환
    return dateStr;
}

export async function syncRoster(db: Database.Database, incoming: optomData[], scope: { start: string, end: string }) {
    if (!Array.isArray(incoming)) {
        console.error("incoming is not an array:", incoming);
        throw new Error("incoming data must be an array");
    }
    
    db.exec('BEGIN');
    
    try {
        // 날짜 범위를 ISO 8601 형식으로 변환
        const scopeStartISO = convertToISO8601(scope.start);
        const scopeEndISO = convertEndDateToISO8601(scope.end);
        
        // 1) UPSERT: 신규 → INSERT, 기존 → UPDATE
        const upsert = db.prepare(`
      INSERT INTO ROSTER (
        id, employeeId, firstName, lastName, locationId, locationName, startTime, endTime, email, isLocum
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        employeeId   = excluded.employeeId,
        firstName    = excluded.firstName,
        lastName     = excluded.lastName,
        locationId   = excluded.locationId,
        locationName = excluded.locationName,
        startTime    = excluded.startTime,
        endTime      = excluded.endTime,
        email        = excluded.email,
        isLocum      = excluded.isLocum
    `);

        const upsertBreak = db.prepare(`
      INSERT INTO ROSTER_BREAK (id, rosterId, startTime, endTime, isPaidBreak)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        rosterId = excluded.rosterId,
        startTime = excluded.startTime,
        endTime = excluded.endTime,
        isPaidBreak = excluded.isPaidBreak
    `);
        
        const rosterData = [];
        const breakData = [];
        const incomingIds: number[] = [];

        for (const v of incoming) {
            try {
                // 필수 필드 검증 (NOT NULL 필드들)
                if (!v.id) {
                    console.warn("Skipping roster entry with missing id:", v);
                    continue;
                }
                
                if (v.locationId == null) {
                    console.warn(`Skipping roster entry ${v.id}: locationId is required but missing`);
                    continue;
                }
                
                if (!v.locationName) {
                    console.warn(`Skipping roster entry ${v.id}: locationName is required but missing`);
                    continue;
                }
                
                if (!v.startTime) {
                    console.warn(`Skipping roster entry ${v.id}: startTime is required but missing`);
                    continue;
                }
                
                if (!v.endTime) {
                    console.warn(`Skipping roster entry ${v.id}: endTime is required but missing`);
                    continue;
                }

                // UPSERT
                rosterData.push([
                    v.id,
                    v.employeeId ?? null,
                    v.firstName ?? null,
                    v.lastName ?? null,
                    v.locationId,
                    v.locationName,
                    v.startTime,
                    v.endTime,
                    v.email ?? null,
                    v.isLocum ? 1 : 0,
                ]);

                incomingIds.push(v.id);
                
                // Breaks 처리 (UPSERT)
                if (v.breaks?.length) {
                    for (const br of v.breaks) {
                        if (br.id != null && br.startTime && br.endTime) {
                            breakData.push([br.id, v.id, br.startTime, br.endTime, br.isPaidBreak ? 1 : 0]);
                        }
                    }
                }
            } catch (error) {
                console.error("Error during upsert for item:", v, "Error:", error);
                throw error;
            }
        }

        // 배치 실행 (트랜잭션 내에서)
        if (rosterData.length > 0 || breakData.length > 0) {
            const transaction = db.transaction((rosterBatch, breakBatch) => {
                // 로스터 데이터 배치 실행
                for (const data of rosterBatch) {
                    upsert.run(...data);
                }
                
                // 브레이크 데이터 배치 실행
                for (const data of breakBatch) {
                    upsertBreak.run(...data);
                }
            });

            transaction(rosterData, breakData);
        }

        // 2) DELETE: 받은 데이터에 없는 id는 삭제 (날짜 범위 내에서만)
        // 빈 배열이어도 범위 내의 데이터는 정리해야 함
        const validIncomingIds = incomingIds.filter(id => id != null);
        
        if (validIncomingIds.length > 0) {
            // 받은 데이터가 있는 경우: 받은 데이터에 없는 것만 삭제
            const placeholders = validIncomingIds.map(() => '?').join(',');
            const deleteResult = db.prepare(`
                DELETE FROM ROSTER
                 WHERE startTime >= ?
                   AND startTime < ?
                   AND id NOT IN (${placeholders})
            `).run(scopeStartISO, scopeEndISO, ...validIncomingIds);
            
            if (deleteResult.changes > 0) {
                console.log(`[SYNC] Deleted ${deleteResult.changes} roster entries not in incoming data (range: ${scope.start} to ${scope.end})`);
            }
        } else {
            // 받은 데이터가 없는 경우: 범위 내의 모든 데이터 삭제 (주의: 이건 정상적인 경우가 거의 없음)
            console.warn(`[SYNC] No incoming data for range ${scope.start} to ${scope.end}. This might indicate an issue.`);
            // 주석 처리: 모든 데이터를 삭제하면 위험할 수 있음
            // const deleteResult = db.prepare(`
            //     DELETE FROM ROSTER
            //      WHERE startTime >= ?
            //        AND startTime < ?
            // `).run(scopeStartISO, scopeEndISO);
        }

        db.exec('COMMIT');
    } catch (e) {
        console.error("Error during roster sync, rolling back transaction:", e);
        db.exec('ROLLBACK');
        throw e;
    }
}