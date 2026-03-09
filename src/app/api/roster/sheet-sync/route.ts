import { NextResponse } from "next/server";
import { readGoogleSheet } from "@/lib/readGoogleSheet";
import { resolveEmployeeNames } from "@/lib/resolveSheetEmployees";
import { writeEHRoster } from "@/lib/writeEmploymentHeroRoster";
import { getWeekNumber } from "@/utils/time";

/**
 * 구글 시트 → Employment Hero 로스터 동기화
 * GET /api/roster/sheet-sync?week=1&dryRun=true
 *   week:   주차 번호 (생략 시 현재 주차 자동)
 *   dryRun: true 이면 EH 업로드 없이 파싱 결과만 반환
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const weekParam = searchParams.get("week");
        const dryRun = searchParams.get("dryRun") === "true";
        const storeFilter = searchParams.get("store")?.trim().toLowerCase() ?? null;

        const weekNumber = weekParam ? parseInt(weekParam, 10) : getWeekNumber(new Date());

        if (isNaN(weekNumber) || weekNumber < 1) {
            return NextResponse.json(
                { message: "Invalid week parameter" },
                { status: 400 }
            );
        }

        console.log(`[SHEET SYNC] Starting ${dryRun ? "DRY RUN" : "sync"} for Week ${weekNumber}${storeFilter ? ` / store: ${storeFilter}` : ""}...`);

        // 1. 구글 시트 읽기
        let shifts = await readGoogleSheet(weekNumber);
        if (shifts.length === 0) {
            return NextResponse.json({
                message: `No shifts found for Week ${weekNumber}`,
                data: { weekNumber, dryRun, shifts: [], synced: 0, skipped: 0, errors: [] },
            });
        }

        // store 필터 적용
        if (storeFilter) {
            shifts = shifts.filter((s) => s.storeName?.trim().toLowerCase() === storeFilter);
            console.log(`[SHEET SYNC] After store filter "${storeFilter}": ${shifts.length} shift(s)`);
        }

        console.log(`[SHEET SYNC] Found ${shifts.length} shift(s) to process`);

        // 2. 직원 이름 → employeeId 해석
        const uniqueNames = [...new Set(shifts.map((s) => s.employeeName))];
        const nameToIdMap = await resolveEmployeeNames(uniqueNames);

        // dryRun: EH 업로드 없이 파싱 결과만 반환
        if (dryRun) {
            const preview = shifts.map((s) => ({
                ...s,
                employeeId: nameToIdMap.get(s.employeeName) ?? null,
                resolved: nameToIdMap.get(s.employeeName) != null,
            }));
            const unresolved = preview.filter((s) => !s.resolved).map((s) => s.employeeName);
            const uniqueUnresolved = [...new Set(unresolved)];

            return NextResponse.json({
                message: "[DRY RUN] Sheet parsed — no data written to EH",
                data: {
                    weekNumber,
                    dryRun: true,
                    totalShifts: shifts.length,
                    resolvedCount: preview.filter((s) => s.resolved).length,
                    unresolvedNames: uniqueUnresolved,
                    shifts: preview,
                },
            });
        }

        // 3. EH에 업로드
        const result = await writeEHRoster(shifts, nameToIdMap);

        console.log(
            `[SHEET SYNC] Done — created: ${result.created}, updated: ${result.updated}, skipped: ${result.skipped}, errors: ${result.errors.length}`
        );

        return NextResponse.json({
            message: "Sheet sync complete",
            data: {
                weekNumber,
                dryRun: false,
                totalShifts: shifts.length,
                ...result,
            },
        });
    } catch (error) {
        console.error("[SHEET SYNC] Error:", error);
        return NextResponse.json(
            {
                message: "Sheet sync failed",
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}
