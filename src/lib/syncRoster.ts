import {optomData} from "@/types/types";
import Database from "better-sqlite3";

export async function syncRoster(db: Database.Database, incoming: optomData[], scope: { start: string, end: string }) {
    if (!Array.isArray(incoming)) {
        console.error("incoming is not an array:", incoming);
        throw new Error("incoming data must be an array");
    }
    
    if (incoming.length === 0) {
        return;
    }
    
    db.exec('BEGIN');
    
    try {
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
                // 데이터 검증
                if (!v.id) continue;

                // UPSERT
                rosterData.push([
                    v.id ?? null,
                    v.employeeId ?? null,
                    v.firstName ?? null,
                    v.lastName ?? null,
                    v.locationId ?? null,
                    v.locationName ?? null,
                    v.startTime ?? null,
                    v.endTime ?? null,
                    v.email ?? null,
                    v.isLocum ? 1 : 0,
                ]);

                if (v.id != null) {
                    incomingIds.push(v.id);
                }
                // Breaks 처리 (UPSERT)
                if (v.breaks?.length) {
                    for (const br of v.breaks) {
                        breakData.push([br.id, v.id, br.startTime, br.endTime, br.isPaidBreak]);
                    }
                }
            } catch (error) {
                console.error("Error during upsert for item:", v, "Error:", error);
                throw error;
            }
        }

        // 3. 배치 실행 (트랜잭션 내에서)
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

        // 2) DELETE: 받은 데이터에 없는 id는 삭제 (날짜 범위 내에서만)
        const validIncomingIds = incomingIds.filter(id => id != null);
        
        if (validIncomingIds.length > 0) {
            const placeholders = validIncomingIds.map(() => '?').join(',');
            db.prepare(`
        DELETE FROM ROSTER
         WHERE startTime >= ?
           AND startTime <= ?
           AND id NOT IN (${placeholders})
        `).run(scope.start, scope.end, ...validIncomingIds);
        }

        db.exec('COMMIT');
    } catch (e) {
        console.error("Error during roster sync, rolling back transaction:", e);
        db.exec('ROLLBACK');
        throw e;
    }
}