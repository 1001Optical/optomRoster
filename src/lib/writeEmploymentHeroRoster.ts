import { EmploymentHeroClient } from "@/lib/api-client/EmploymentHeroClient";
import type { SheetShift } from "@/lib/readGoogleSheet";

export interface EHRosterWriteResult {
    synced: number;
    skipped: number;
    created: number;
    updated: number;
    errors: string[];
}

interface EHExistingShift {
    id: number;
    employeeId: number;
    locationId: number;
    startTime: string;  // "2026-03-22T10:00:00"
    endTime: string;
    published: boolean;
}

/**
 * 주어진 날짜 범위 + 로케이션의 기존 EH 시프트 조회
 * key: `{employeeId}_{date}` → EHExistingShift
 */
async function fetchExistingShifts(
    fromDate: string,
    toDate: string,
    locationIds: number[]
): Promise<Map<string, EHExistingShift>> {
    const locationParams = locationIds
        .map((id) => `filter.selectedLocations=${id}`)
        .join("&");

    const res = await EmploymentHeroClient<EHExistingShift[]>({
        path: `/rostershift?filter.SelectAllRoles=true&filter.ShiftStatuses=published&filter.fromDate=${fromDate}&filter.toDate=${toDate}&${locationParams}`,
    });

    const map = new Map<string, EHExistingShift>();
    if (!res.ok || !Array.isArray(res.data)) return map;

    for (const shift of res.data) {
        const date = shift.startTime.split("T")[0];
        const key = `${shift.employeeId}_${date}`;
        map.set(key, shift);
    }

    return map;
}

/**
 * 시프트 하나를 EH에 upsert
 * - 기존 없음 → POST
 * - 기존 있고 시간 동일 → skip
 * - 기존 있고 시간 다름 → (published면 unpublish 후) PUT → republish
 */
async function upsertEHShift(
    employeeId: number,
    shift: SheetShift,
    existing: EHExistingShift | null
): Promise<{ ok: boolean; action: "created" | "updated" | "skipped"; error?: string }> {
    const startDateTime = `${shift.date}T${shift.startTime}`;
    const endDateTime = `${shift.date}T${shift.endTime}`;

    // 기존 없음 → POST 생성
    if (existing == null) {
        const res = await EmploymentHeroClient({
            path: "/rostershift",
            init: {
                method: "POST",
                body: JSON.stringify({
                    employeeId,
                    locationId: shift.locationId,
                    startTime: startDateTime,
                    endTime: endDateTime,
                    published: true,
                }),
            },
        });
        if (!res.ok) return { ok: false, action: "created", error: res.error };
        return { ok: true, action: "created" };
    }

    // 기존 있음 → 시간 비교
    const existingStart = existing.startTime.substring(0, 16); // "2026-03-22T10:00"
    const existingEnd = existing.endTime.substring(0, 16);
    const newStart = startDateTime.substring(0, 16);
    const newEnd = endDateTime.substring(0, 16);

    if (existingStart === newStart && existingEnd === newEnd) {
        return { ok: true, action: "skipped" };
    }

    // 시간이 다름 → 업데이트 필요
    const payload = {
        id: existing.id,
        employeeId,
        locationId: shift.locationId,
        startTime: startDateTime,
        endTime: endDateTime,
        published: true,
    };

    // published 상태면 먼저 unpublish
    if (existing.published) {
        const unpubRes = await EmploymentHeroClient({
            path: `/rostershift/${existing.id}`,
            init: {
                method: "PUT",
                body: JSON.stringify({ ...payload, published: false }),
            },
        });
        if (!unpubRes.ok) {
            return { ok: false, action: "updated", error: `Unpublish failed: ${unpubRes.error}` };
        }
    }

    // 수정 + republish
    const putRes = await EmploymentHeroClient({
        path: `/rostershift/${existing.id}`,
        init: { method: "PUT", body: JSON.stringify(payload) },
    });
    if (!putRes.ok) return { ok: false, action: "updated", error: putRes.error };
    return { ok: true, action: "updated" };
}

/**
 * 시트에서 파싱된 시프트 목록을 EH에 upsert
 */
export async function writeEHRoster(
    shifts: SheetShift[],
    nameToIdMap: Map<string, number | null>
): Promise<EHRosterWriteResult> {
    const result: EHRosterWriteResult = { synced: 0, skipped: 0, created: 0, updated: 0, errors: [] };

    if (shifts.length === 0) return result;

    // 날짜 범위 및 로케이션 수집
    const dates = shifts.map((s) => s.date).sort();
    const fromDate = dates[0];
    const toDate = dates[dates.length - 1];
    const locationIds = [...new Set(shifts.map((s) => s.locationId))];

    console.log(`[EH WRITE] Fetching existing shifts ${fromDate}~${toDate} for locationIds: ${locationIds}`);
    const existingMap = await fetchExistingShifts(fromDate, toDate, locationIds);
    console.log(`[EH WRITE] Found ${existingMap.size} existing shift(s) in EH`);

    for (const shift of shifts) {
        const employeeId = nameToIdMap.get(shift.employeeName);

        if (!employeeId) {
            const msg = `"${shift.employeeName}" → EH employeeId 찾지 못함 (${shift.storeName} ${shift.date}) — skip`;
            console.warn(`[EH WRITE] ⚠️  ${msg}`);
            result.skipped++;
            result.errors.push(msg);
            continue;
        }

        const key = `${employeeId}_${shift.date}`;
        const existing = existingMap.get(key) ?? null;

        const { ok, action, error } = await upsertEHShift(employeeId, shift, existing);

        if (ok) {
            if (action === "skipped") {
                console.log(`[EH WRITE] ⏭️  [SKIP] ${shift.employeeName} | ${shift.storeName} | ${shift.date} (이미 동일)`);
                result.skipped++;
            } else {
                console.log(
                    `[EH WRITE] ✅ [${action.toUpperCase()}] ${shift.employeeName} | ${shift.storeName} | ${shift.date} ${shift.startTime}~${shift.endTime}`
                );
                result.synced++;
                if (action === "created") result.created++;
                else result.updated++;
            }
        } else {
            const msg = `[${action.toUpperCase()}] "${shift.employeeName}" ${shift.storeName} ${shift.date}: ${error}`;
            console.error(`[EH WRITE] ❌ ${msg}`);
            result.errors.push(msg);
        }
    }

    return result;
}
