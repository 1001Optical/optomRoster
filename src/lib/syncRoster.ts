import {optomData} from "@/types/types";
import {Database} from "sqlite";

export async function syncRoster(db: Database, incoming: optomData[], scope: { start: string, end: string }) {
    console.log(`=== Starting Roster Sync ===`);
    console.log(`Scope: ${scope.start} to ${scope.end}`);
    console.log(`Incoming data: ${incoming.length} items`);
    
    if (!Array.isArray(incoming)) {
        console.error("incoming is not an array:", incoming);
        throw new Error("incoming data must be an array");
    }
    
    if (incoming.length === 0) {
        console.log("No incoming data to sync");
        return;
    }
    
    await db.exec('BEGIN');
    console.log("Database transaction started");
    
    try {
        // 1) UPSERT: 신규 → INSERT, 기존 → UPDATE
        console.log("Preparing UPSERT statements...");
        const upsert = await db.prepare(`
      INSERT INTO ROSTER (
        id, employeeId, employeeName, locationId, locationName, startTime, endTime, isLocum
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        employeeId   = excluded.employeeId,
        employeeName = excluded.employeeName,
        locationId   = excluded.locationId,
        locationName = excluded.locationName,
        startTime    = excluded.startTime,
        endTime      = excluded.endTime,
        isLocum      = excluded.isLocum
    `);

        const upsertBreak = await db.prepare(`
      INSERT INTO ROSTER_BREAK (id, rosterId, startTime, endTime, isPaidBreak)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        rosterId = excluded.rosterId,
        startTime = excluded.startTime,
        endTime = excluded.endTime,
        isPaidBreak = excluded.isPaidBreak
    `);

        const incomingIds: number[] = [];
        let upsertCount = 0;
        let breakCount = 0;

        console.log("Processing incoming roster data...");
        for (const v of incoming) {
            try {
                // 데이터 검증
                if (!v.id) {
                    console.warn(`Skipping item with missing ID:`, v);
                    continue;
                }

                // UPSERT
                const upsertData = [
                    v.id ?? null,
                    v.employeeId ?? null,
                    v.employeeName ?? null,
                    v.locationId ?? null,
                    v.locationName ?? null,
                    v.startTime ?? null,
                    v.endTime ?? null,
                    v.isLocum ? 1 : 0,
                ];
                
                const result = await upsert.run(...upsertData);
                upsertCount++;
                
                if (result.changes > 0) {
                    console.log(`Upserted roster item: ${v.employeeName} (ID: ${v.id})`);
                }

                if (v.id != null) {
                    incomingIds.push(v.id);
                }
            } catch (error) {
                console.error("Error during upsert for item:", v, "Error:", error);
                throw error;
            }

            // Breaks 처리 (UPSERT)
            if (v.breaks?.length) {
                console.log(`Processing ${v.breaks.length} breaks for roster ID ${v.id}`);
                for (const br of v.breaks) {
                    try {
                        await upsertBreak.run(br.id, v.id, br.startTime, br.endTime, br.isPaidBreak);
                        breakCount++;
                    } catch (breakError) {
                        console.error(`Error upserting break ${br.id} for roster ${v.id}:`, breakError);
                        throw breakError;
                    }
                }
            }
        }

        console.log(`Upserted ${upsertCount} roster items and ${breakCount} breaks`);

        // 2) DELETE: 받은 데이터에 없는 id는 삭제 (날짜 범위 내에서만)
        const validIncomingIds = incomingIds.filter(id => id != null);
        console.log(`Valid incoming IDs: ${validIncomingIds.length}`);
        
        if (validIncomingIds.length > 0) {
            const placeholders = validIncomingIds.map(() => '?').join(',');
            const deleteResult = await db.run(
                `
        DELETE FROM ROSTER
         WHERE startTime >= ?
           AND startTime <= ?
           AND id NOT IN (${placeholders})
        `,
                scope.start,
                scope.end,
                ...validIncomingIds
            );
            console.log(`Deleted ${deleteResult.changes} outdated roster items`);
        }

        await db.exec('COMMIT');
        console.log("Database transaction committed successfully");
        console.log(`=== Roster Sync Completed ===`);
    } catch (e) {
        console.error("Error during roster sync, rolling back transaction:", e);
        await db.exec('ROLLBACK');
        console.log("Database transaction rolled back");
        throw e;
    }
}