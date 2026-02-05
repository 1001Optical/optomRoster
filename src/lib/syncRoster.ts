import {optomData} from "@/types/types";
import type { Client, InArgs } from "@libsql/client";
import {dbAll, dbExecute, getDB} from "@/utils/db/db";

const ROSTER_ANY_CHANGE_TRIGGER_SQL = `
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
`;

const ROSTER_INSERT_TRIGGER_SQL = `
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
`;

const ROSTER_DELETE_TRIGGER_SQL = `
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
`;

async function disableRosterChangeTriggers(db: Client) {
    await dbExecute(db, "DROP TRIGGER IF EXISTS roster_any_change");
    await dbExecute(db, "DROP TRIGGER IF EXISTS roster_insert_log");
    await dbExecute(db, "DROP TRIGGER IF EXISTS roster_delete_log");
}

async function enableRosterChangeTriggers(db: Client) {
    await dbExecute(db, ROSTER_ANY_CHANGE_TRIGGER_SQL);
    await dbExecute(db, ROSTER_INSERT_TRIGGER_SQL);
    await dbExecute(db, ROSTER_DELETE_TRIGGER_SQL);
}

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

export async function syncRoster(db: Client, incoming: optomData[], scope: { start: string, end: string, locationIds?: number[] }) {
    if (!Array.isArray(incoming)) {
        console.error("incoming is not an array:", incoming);
        throw new Error("incoming data must be an array");
    }
    
    const tx = await db.transaction("write");
    
    try {
        const txExecute = (sql: string, args?: InArgs) =>
            tx.execute({ sql, args: args ?? [] });
        const txAll = async <T>(sql: string, args?: InArgs): Promise<T[]> => {
            const result = await tx.execute({ sql, args: args ?? [] });
            return result.rows as T[];
        };

        // 날짜 범위를 ISO 8601 형식으로 변환
        const scopeStartISO = convertToISO8601(scope.start);
        const scopeEndISO = convertEndDateToISO8601(scope.end);
        
        // 동기화한 브랜치의 locationId 추출 (중복 제거)
        const syncedLocationIds = scope.locationIds || 
            [...new Set(incoming.map(v => v.locationId).filter(id => id != null))];
        
        // 0) 과거 데이터 삭제: 동기화 시작 날짜 이전의 모든 데이터 삭제
        // [수정] 8~14일 동기화 시 1~7일 데이터가 사라지는 문제를 해결하기 위해 과거 데이터 삭제 로직 제거
        /*
        if (syncedLocationIds.length > 0) {
            const locationPlaceholders = syncedLocationIds.map(() => '?').join(',');
            const deletePastResult = db.prepare(`
                DELETE FROM ROSTER
                 WHERE startTime < ?
                   AND locationId IN (${locationPlaceholders})
            `).run(scopeStartISO, ...syncedLocationIds);
            
            if (deletePastResult.changes > 0) {
                console.log(`[SYNC] Deleted ${deletePastResult.changes} past roster entries before ${scope.start} (locations: ${syncedLocationIds.join(', ')})`);
            }
        } else {
            // 브랜치 정보가 없으면 모든 브랜치의 과거 데이터 삭제
            const deletePastResult = db.prepare(`
                DELETE FROM ROSTER
                 WHERE startTime < ?
            `).run(scopeStartISO);
            
            if (deletePastResult.changes > 0) {
                console.log(`[SYNC] Deleted ${deletePastResult.changes} past roster entries before ${scope.start} (all locations)`);
            }
        }
        */

        // 0-1) 과거 데이터 삭제 (옵션): 오늘 날짜 기준으로 한 달 이상 지난 데이터만 정리 (DB 최적화용)
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        const oneMonthAgoISO = oneMonthAgo.toISOString().split('.')[0] + 'Z';
        
        const cleanupResult = await txExecute(
            `
            DELETE FROM ROSTER WHERE startTime < ?
        `,
            [oneMonthAgoISO]
        );
        
        const cleanupCount = cleanupResult.rowsAffected ?? 0;
        if (cleanupCount > 0) {
            console.log(`[SYNC] Cleaned up ${cleanupCount} old roster entries older than ${oneMonthAgoISO}`);
        }
        
        // 1) UPSERT: 신규 → INSERT, 기존 → UPDATE
        const upsertSql = `
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
    `;

        const upsertBreakSql = `
      INSERT INTO ROSTER_BREAK (id, rosterId, startTime, endTime, isPaidBreak)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        rosterId = excluded.rosterId,
        startTime = excluded.startTime,
        endTime = excluded.endTime,
        isPaidBreak = excluded.isPaidBreak
    `;
        
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
            // 로스터 데이터 배치 실행
            for (const data of rosterData) {
                await txExecute(upsertSql, data);
            }
            
            // 브레이크 데이터 배치 실행
            for (const data of breakData) {
                await txExecute(upsertBreakSql, data);
            }
        }

        // 2) DELETE: 받은 데이터에 없는 id는 삭제 (날짜 범위 + 브랜치 범위 내에서만)
        const validIncomingIds = incomingIds.filter(id => id != null);
        
        if (syncedLocationIds.length > 0) {
            // 동기화한 브랜치가 있는 경우에만 삭제 수행
            const locationPlaceholders = syncedLocationIds.map(() => '?').join(',');
            
            if (validIncomingIds.length > 0) {
                // 받은 데이터가 있는 경우: 받은 데이터에 없는 것만 삭제
                const idPlaceholders = validIncomingIds.map(() => '?').join(',');
                
                // 디버깅: 삭제 대상 조회
                const candidatesToDelete = await txAll<{id: number, startTime: string, locationId: number, firstName: string | null, lastName: string | null}>(
                    `
                    SELECT id, startTime, locationId, firstName, lastName
                     FROM ROSTER
                     WHERE startTime >= ?
                       AND startTime < ?
                       AND locationId IN (${locationPlaceholders})
                       AND id NOT IN (${idPlaceholders})
                `,
                    [scopeStartISO, scopeEndISO, ...syncedLocationIds, ...validIncomingIds]
                );
                
                if (candidatesToDelete.length > 0) {
                    console.log(`[SYNC] Found ${candidatesToDelete.length} roster entries to delete:`, candidatesToDelete.map(r => `id=${r.id}, startTime=${r.startTime}, locationId=${r.locationId}, name=${r.firstName} ${r.lastName}`));
                }
                
                const deleteResult = await txExecute(
                    `
                    DELETE FROM ROSTER
                     WHERE startTime >= ?
                       AND startTime < ?
                       AND locationId IN (${locationPlaceholders})
                       AND id NOT IN (${idPlaceholders})
                `,
                    [scopeStartISO, scopeEndISO, ...syncedLocationIds, ...validIncomingIds]
                );
                
                const deleteCount = deleteResult.rowsAffected ?? 0;
                if (deleteCount > 0) {
                    console.log(`[SYNC] Deleted ${deleteCount} roster entries not in incoming data (range: ${scope.start} to ${scope.end}, locations: ${syncedLocationIds.join(', ')})`);
                } else if (candidatesToDelete.length > 0) {
                    console.warn(`[SYNC] WARNING: Found ${candidatesToDelete.length} candidates to delete but deleteCount is ${deleteCount}`);
                }
            } else {
                // 받은 데이터가 없는 경우: 동기화한 브랜치의 날짜 범위 내 모든 데이터 삭제
                // (Employment Hero에서 모든 로스터를 지운 경우를 처리)
                const deleteResult = await txExecute(
                    `
                    DELETE FROM ROSTER
                     WHERE startTime >= ?
                       AND startTime < ?
                       AND locationId IN (${locationPlaceholders})
                `,
                    [scopeStartISO, scopeEndISO, ...syncedLocationIds]
                );
                
                const deleteCount = deleteResult.rowsAffected ?? 0;
                if (deleteCount > 0) {
                    console.log(`[SYNC] Deleted ${deleteCount} roster entries (all entries in range ${scope.start} to ${scope.end} for locations: ${syncedLocationIds.join(', ')}) - no incoming data received`);
                }
            }
        } else {
            // 동기화한 브랜치 정보가 없는 경우: 삭제하지 않음 (다른 브랜치 데이터 보호)
            console.log(`[SYNC] No location information available, skipping delete to protect other branch data`);
        }

        await tx.commit();
    } catch (e) {
        console.error("Error during roster sync, rolling back transaction:", e);
        await tx.rollback();
        throw e;
    } finally {
        if (!tx.closed) {
            tx.close();
        }
    }
}

/**
 * 오늘 이전의 모든 데이터를 모든 브랜치에서 삭제
 * 오늘 데이터는 보존
 * 매일 5시에 실행되는 store-by-store-sync 스크립트에서 사용
 * 
 * 클린업 시 생성된 CHANGE_LOG는 삭제하여 옵토메이트로 전송되지 않도록 함
 */
export async function deletePastDataForAllBranches(): Promise<number> {
    const db = await getDB();
    
    try {
        await disableRosterChangeTriggers(db);

        // Sydney 기준 오늘 날짜 계산
        const { formatInTimeZone } = await import("date-fns-tz");
        const now = new Date();
        const todayStr = formatInTimeZone(now, "Australia/Sydney", "yyyy-MM-dd");
        // Sydney 00:00:00을 UTC로 변환
        const todayStart = new Date(`${todayStr}T00:00:00+11:00`).toISOString();
        
        // 클린업 시작 시간 기록 (트리거로 생성된 CHANGE_LOG를 식별하기 위해)
        const cleanupStartTime = new Date().toISOString();
        
        // 삭제할 rosterId 목록 미리 조회 (나중에 CHANGE_LOG 삭제에 사용)
        const rosterIdsToDelete = await dbAll<{id: number}>(
            db,
            `
            SELECT id FROM ROSTER
            WHERE startTime < ?
        `,
            [todayStart]
        );
        
        const rosterIdList = rosterIdsToDelete.map(r => r.id);
        
        // 오늘 이전의 모든 데이터 삭제 (모든 브랜치)
        const deleteResult = await dbExecute(
            db,
            `
            DELETE FROM ROSTER
            WHERE startTime < ?
        `,
            [todayStart]
        );
        
        // 클린업으로 인해 생성된 CHANGE_LOG 삭제 (옵토메이트로 전송되지 않도록)
        // 삭제 직후 생성된 roster_deleted 타입의 CHANGE_LOG를 삭제
        if (rosterIdList.length > 0) {
            const placeholders = rosterIdList.map(() => '?').join(',');
            const cleanupLogDeleteResult = await dbExecute(
                db,
                `
                DELETE FROM CHANGE_LOG
                WHERE rosterId IN (${placeholders})
                  AND changeType = 'roster_deleted'
                  AND whenDetected >= ?
            `,
                [...rosterIdList, cleanupStartTime]
            );
            
            const cleanupLogDeleteCount = cleanupLogDeleteResult.rowsAffected ?? 0;
            if (cleanupLogDeleteCount > 0) {
                console.log(`[CLEANUP] Deleted ${cleanupLogDeleteCount} CHANGE_LOG entries created during cleanup (to prevent Optomate transmission)`);
            }
        }
        
        const deleteCount = deleteResult.rowsAffected ?? 0;
        if (deleteCount > 0) {
            console.log(`[CLEANUP] Deleted ${deleteCount} roster entries before today (${todayStr}, Sydney) for all branches`);
        } else {
            console.log(`[CLEANUP] No past roster entries found before today (${todayStr}, Sydney)`);
        }
        
        return deleteCount;
    } catch (error) {
        console.error(`[CLEANUP] Error deleting past data:`, error);
        throw error;
    } finally {
        try {
            await enableRosterChangeTriggers(db);
        } catch (triggerError) {
            console.error(`[CLEANUP] Failed to re-enable roster triggers:`, triggerError);
        }
    }
}
