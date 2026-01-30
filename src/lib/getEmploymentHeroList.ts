import {getDB} from "@/utils/db/db";
import {createSecret} from "@/utils/crypto";
import {optomData} from "@/types/types";
import {Shift} from "@/types/employment_hero_response";
import {syncRoster} from "@/lib/syncRoster";
import {OptomMap} from "@/data/stores";
import {getEmployeeInfo} from "@/lib/getEmployeeInfo";
import {sendChangeToOptomateAPI, SlotMismatch, AppointmentConflict} from "@/lib/changeProcessor";
import {chunk} from "@/lib/utils";

export const getEmploymentHeroList: (fromDate: string, toDate: string, branch?: string | null, isScheduler?: boolean, skipEmail?: boolean) => Promise<{data: optomData[], slotMismatches: SlotMismatch[], appointmentConflicts: AppointmentConflict[]}> = async (fromDate, toDate, branch, isScheduler = false, skipEmail = false) => {
    try {
        const db = getDB();

        const secret = process.env.EMPLOYMENTHERO_SECRET;
        const server_url = process.env.EMPLOYMENTHERO_API_URL;
        
        if (!secret || !server_url) {
            throw new Error("Missing required environment variables: EMPLOYMENTHERO_SECRET or EMPLOYMENTHERO_API_URL");
        }

        let selectedLocations = OptomMap.map(v => `filter.selectedLocations=${v.LocationId}`).join("&")
        if(branch) {
            const locationId = OptomMap.find(v => v.OptCode === branch)?.LocationId;
            if (!locationId) {
                throw new Error(`Invalid branch code: ${branch}`);
            }
            selectedLocations = `filter.selectedLocations=${locationId}`
        }

        const api = `${server_url}/rostershift?filter.SelectAllRoles=true&filter.ShiftStatuses=published&filter.fromDate=${fromDate}&filter.toDate=${toDate}${selectedLocations ? `&${selectedLocations}` : ""}`
        const response = await fetch(
            api,
            {
                headers: {
                    "Authorization": createSecret(secret)
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Employment Hero API request failed: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();

        // const returnData: optomData[] = [];

        // 하이브리드 캐싱: 메모리 + DB
        const employeeMap = new Map();
        const CACHE_TTL = 24 * 60 * 60 * 1000; // 24시간

        // DB 캐시 테이블 생성 (한 번만)
        db.exec(`
            CREATE TABLE IF NOT EXISTS employee_cache (
                employee_id INTEGER PRIMARY KEY,
                data TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            )
        `);

        // 성능 최적화: 고유한 직원 ID만 먼저 추출하여 병렬 처리
        const uniqueEmployeeIds = [...new Set(result.map((shift: Shift) => shift.employeeId).filter(Boolean))];
        console.log(`\n📊 [EMPLOYMENT HERO] Processing roster data`);
        console.log(`   └─ Total shifts: ${result.length}`);
        console.log(`   └─ Unique employees: ${uniqueEmployeeIds.length}`);
        console.log(`   └─ Date range: ${fromDate} to ${toDate}`);

        // 직원 정보를 배치로 병렬 처리
        const BATCH_SIZE = 5; // 동시에 5명씩 처리
        const batches = chunk(uniqueEmployeeIds, BATCH_SIZE);

        console.log(`   └─ Processing in ${batches.length} batch(es) of ${BATCH_SIZE} employees\n`);

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            console.log(`📦 [EMPLOYMENT HERO] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} employees)`);
            const batchPromises = batch.map(async (employeeId) => {
                try {
                    // 메모리 캐시 확인
                    if (employeeMap.has(employeeId)) {
                        return { id: employeeId, info: employeeMap.get(employeeId) };
                    }

                    // DB 캐시 확인
                    const dbCached = db.prepare(`
                        SELECT data, updated_at FROM employee_cache 
                        WHERE employee_id = ? AND updated_at > ?
                    `).get(employeeId, Date.now() - CACHE_TTL) as { data: string; updated_at: number } | undefined;

                    if (dbCached) {
                        const cachedData = JSON.parse(dbCached.data);
                        const employeeInfo = {
                            first: cachedData.firstName,
                            last: cachedData.surname,
                            email: cachedData.emailAddress
                        };
                        employeeMap.set(employeeId, employeeInfo);
                        return { id: employeeId, info: employeeInfo };
                    }

                    // API 호출
                    const employeeInfo = await getEmployeeInfo(employeeId as number);
                    const processedInfo = {
                        first: employeeInfo.firstName,
                        last: employeeInfo.surname,
                        email: employeeInfo.emailAddress
                    };

                    // 캐시 저장
                    employeeMap.set(employeeId, processedInfo);
                    db.prepare(`
                        INSERT OR REPLACE INTO employee_cache (employee_id, data, updated_at)
                        VALUES (?, ?, ?)
                    `).run(employeeId, JSON.stringify(employeeInfo), Date.now());

                    return { id: employeeId, info: processedInfo };
                } catch (error) {
                    console.error(`Failed to get employee info for ${employeeId}:`, error);
                    return { id: employeeId, info: null };
                }
            });

            // 배치 결과 대기
            const batchResults = await Promise.allSettled(batchPromises);
            batchResults.forEach(result => {
                if (result.status === 'fulfilled' && result.value?.info) {
                    employeeMap.set(result.value.id, result.value.info);
                }
            });

            // 배치 간 지연 (API 서버 부하 방지, Rate Limiting 방지)
            // 429 에러를 줄이기 위해 배치 간 지연 증가
            if (batches.length > 1 && batchIndex < batches.length - 1) {
                console.log(`   ⏳ Waiting 500ms before next batch...\n`);
                await new Promise(resolve => setTimeout(resolve, 500)); // 100ms -> 500ms로 증가
            }
        }

        console.log(`✅ [EMPLOYMENT HERO] All employee info processed\n`);

        // 이제 모든 직원 정보가 준비되었으므로 변환 처리 (동일한 로직 유지)
        const convertedData: (optomData | undefined)[] | [] = Array.isArray(result) ? result.map((shift: Shift, index: number): optomData | undefined => {
            try {
                // workTypeId가 472663인 경우 Optomate로 보내지 않도록 제외
                if (shift.workTypeId === 472663 || shift.workTypeId === 536674) {
                    console.log(`[EMPLOYMENT HERO] Skipping shift ${shift.id} - workTypeId is 472663`);
                    return undefined;
                }

                // 이름 확인
                if (!shift.employeeName || !shift.employeeId) {
                    return undefined;
                }

                let firstName, lastName, email

                // 메모리 캐시 확인 (이제 모든 직원 정보가 준비됨)
                if (employeeMap.has(shift.employeeId)) {
                    const name = employeeMap.get(shift.employeeId);
                    firstName = name.first;
                    lastName = name.last;
                    email = name.email;
                } else {
                    // 캐시에 없거나 API 호출 실패 시 shift.employeeName에서 파싱 시도
                    console.warn(`  ⚠️  [EMPLOYMENT HERO] No cached info for employee ${shift.employeeId}, attempting to parse from employeeName`);
                    if (shift.employeeName) {
                        const nameParts = shift.employeeName.trim().split(/\s+/);
                        if (nameParts.length >= 2) {
                            firstName = nameParts[0];
                            lastName = nameParts.slice(1).join(' ');
                            email = ""; // 이메일은 없음
                            console.log(`     └─ Parsed name: ${firstName} ${lastName}`);
                        } else {
                            console.error(`     └─ ❌ Cannot parse employee name: ${shift.employeeName}`);
                            return undefined;
                        }
                    } else {
                        console.error(`     └─ ❌ No employee name available`);
                        return undefined;
                    }
                }

                const [firstname, type] = firstName.split("_");

                return {
                    id: shift.id,
                    employeeId: shift.employeeId,
                    firstName: firstname ?? "",
                    lastName: lastName ?? "",
                    locationId: shift.locationId,
                    locationName: shift.locationName,
                    startTime: shift.startTime,
                    endTime: shift.endTime,
                    email: email ?? "",
                    isLocum: type === "Locum" ? 1 : 0,
                    breaks: shift.breaks?.map(breakItem => ({
                        id: breakItem.id,
                        startTime: breakItem.startTime,
                        endTime: breakItem.endTime,
                        isPaidBreak: breakItem.isPaidBreak ? 1 : 0
                    }))
                };
            } catch (conversionError) {
                console.error(`Error converting shift at index ${index}:`, conversionError, shift);
                return undefined;
            }
        }) : [];

        const filterData: optomData[] = convertedData.filter((v): v is optomData => v !== undefined)

        console.log(`\n📊 [EMPLOYMENT HERO] Data conversion summary`);
        console.log(`   └─ Total shifts: ${result.length}`);
        console.log(`   └─ Converted: ${filterData.length}`);
        console.log(`   └─ Failed: ${result.length - filterData.length}\n`);

        // 동기화한 브랜치의 locationId 추출 (중복 제거)
        const syncedLocationIds = branch 
            ? [OptomMap.find(v => v.OptCode === branch)?.LocationId].filter((id): id is number => id != null)
            : [...new Set(filterData.map(v => v.locationId).filter((id): id is number => id != null))];

        await syncRoster(db, filterData, {
            start: fromDate, 
            end: toDate, 
            locationIds: syncedLocationIds
        });

        const { slotMismatches, appointmentConflicts } = await sendChangeToOptomateAPI(
            isScheduler,
            syncedLocationIds,
            skipEmail
        );

        return { data: filterData, slotMismatches, appointmentConflicts }; // 실제 필터링된 데이터와 타임슬롯 불일치 정보, appointment 충돌 정보 반환
    } catch (error) {
        console.error("Error in getEmploymentHeroList:", error);
        throw error;
    }
}