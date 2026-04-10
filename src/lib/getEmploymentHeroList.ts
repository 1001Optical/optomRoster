import {dbExecute, dbGet, getDB} from "@/utils/db/db";
import {createSecret} from "@/utils/crypto";
import {optomData} from "@/types/types";
import {Shift} from "@/types/employment_hero_response";
import {syncRoster} from "@/lib/syncRoster";
import {OptomMap} from "@/data/stores";
import {getEmployeeInfo} from "@/lib/getEmployeeInfo";
import {sendChangeToOptomateAPI, SlotMismatch, AppointmentConflict} from "@/lib/changeProcessor";
import {chunk} from "@/lib/utils";
import { createLogger, maskName } from "@/lib/logger";

const logger = createLogger('EHList');

export const getEmploymentHeroList: (fromDate: string, toDate: string, branch?: string | null, isScheduler?: boolean, skipEmail?: boolean, state?: string | null) => Promise<{data: optomData[], slotMismatches: SlotMismatch[], appointmentConflicts: AppointmentConflict[]}> = async (fromDate, toDate, branch, isScheduler = false, skipEmail = false, state = null) => {
    try {
        const db = await getDB();

        const secret = process.env.EMPLOYMENTHERO_SECRET;
        const server_url = process.env.EMPLOYMENTHERO_API_URL;

        if (!secret || !server_url) {
            throw new Error("Missing required environment variables: EMPLOYMENTHERO_SECRET or EMPLOYMENTHERO_API_URL");
        }

        let selectedLocations = ""
        if(branch) {
            const locationId = OptomMap.find(v => v.OptCode === branch)?.LocationId;
            if (!locationId) {
                throw new Error(`Invalid branch code: ${branch}`);
            }
            selectedLocations = `filter.selectedLocations=${locationId}`
        } else if (state) {
            const stateLocations = OptomMap.filter(v => v.State.toUpperCase() === state.toUpperCase());
            if (stateLocations.length === 0) {
                throw new Error(`Invalid state: ${state}`);
            }
            selectedLocations = stateLocations.map(v => `filter.selectedLocations=${v.LocationId}`).join("&")
        } else {
            selectedLocations = OptomMap.map(v => `filter.selectedLocations=${v.LocationId}`).join("&")
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

        // 하이브리드 캐싱: 메모리 + DB
        const employeeMap = new Map();
        const CACHE_TTL = 24 * 60 * 60 * 1000; // 24시간

        // DB 캐시 테이블 생성 (한 번만)
        await dbExecute(db, `
            CREATE TABLE IF NOT EXISTS employee_cache (
                employee_id INTEGER PRIMARY KEY,
                data TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            )
        `);

        // 성능 최적화: 고유한 직원 ID만 먼저 추출하여 병렬 처리
        const uniqueEmployeeIds = [...new Set(result.map((shift: Shift) => shift.employeeId).filter(Boolean))];
        logger.info(`Processing roster data`, { totalShifts: result.length, uniqueEmployees: uniqueEmployeeIds.length, range: `${fromDate} to ${toDate}` });

        // 직원 정보를 배치로 병렬 처리
        const BATCH_SIZE = 5; // 동시에 5명씩 처리
        const batches = chunk(uniqueEmployeeIds, BATCH_SIZE);

        logger.debug(`Processing employees in batches`, { batchCount: batches.length, batchSize: BATCH_SIZE });

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            logger.debug(`Processing employee batch`, { batch: batchIndex + 1, of: batches.length, size: batch.length });
            const batchPromises = batch.map(async (employeeId) => {
                try {
                    // 메모리 캐시 확인
                    if (employeeMap.has(employeeId)) {
                        return { id: employeeId, info: employeeMap.get(employeeId) };
                    }

                    // DB 캐시 확인
                    const dbCached = await dbGet<{ data: string; updated_at: number }>(
                        db,
                        `
                        SELECT data, updated_at FROM employee_cache
                        WHERE employee_id = ? AND updated_at > ?
                    `,
                        [Number(employeeId), Date.now() - CACHE_TTL]
                    );

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
                    await dbExecute(
                        db,
                        `
                        INSERT OR REPLACE INTO employee_cache (employee_id, data, updated_at)
                        VALUES (?, ?, ?)
                    `,
                        [Number(employeeId), JSON.stringify(employeeInfo), Date.now()]
                    );

                    return { id: employeeId, info: processedInfo };
                } catch (error) {
                    logger.error(`Failed to get employee info`, { employeeId, error: String(error) });
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
            if (batches.length > 1 && batchIndex < batches.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        logger.info(`All employee info processed`, { count: employeeMap.size });

        // 이제 모든 직원 정보가 준비되었으므로 변환 처리 (동일한 로직 유지)
        const convertedData: (optomData | undefined)[] | [] = Array.isArray(result) ? result.map((shift: Shift, index: number): optomData | undefined => {
            try {
                // workTypeId가 472663인 경우 Optomate로 보내지 않도록 제외
                if (shift.workTypeId === 472663 || shift.workTypeId === 536674) {
                    logger.debug(`Skipping shift — excluded workTypeId`, { shiftId: shift.id, workTypeId: shift.workTypeId });
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
                    logger.warn(`No cached info for employee, parsing from employeeName`, { employeeId: shift.employeeId });
                    if (shift.employeeName) {
                        const nameParts = shift.employeeName.trim().split(/\s+/);
                        if (nameParts.length >= 2) {
                            firstName = nameParts[0];
                            lastName = nameParts.slice(1).join(' ');
                            email = ""; // 이메일은 없음
                            logger.debug(`Parsed name from shift`, { name: `${maskName(firstName)} ${maskName(lastName)}` });
                        } else {
                            logger.error(`Cannot parse employee name`, { employeeId: shift.employeeId });
                            return undefined;
                        }
                    } else {
                        logger.error(`No employee name available`, { employeeId: shift.employeeId });
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
                logger.error(`Error converting shift`, { index, shiftId: shift.id, error: String(conversionError) });
                return undefined;
            }
        }) : [];

        const filterData: optomData[] = convertedData.filter((v): v is optomData => v !== undefined)

        logger.info(`Data conversion summary`, { total: result.length, converted: filterData.length, failed: result.length - filterData.length });

        // 동기화한 브랜치의 locationId 추출 (중복 제거)
        const syncedLocationIds = branch
            ? [OptomMap.find(v => v.OptCode === branch)?.LocationId].filter((id): id is number => id != null)
            : [...new Set(filterData.map(v => v.locationId).filter((id): id is number => id != null))];

        await syncRoster(db, filterData, {
            start: fromDate,
            end: toDate,
            locationIds: syncedLocationIds
        });

        const { slotMismatches, appointmentConflicts } = await sendChangeToOptomateAPI(syncedLocationIds);

        return { data: filterData, slotMismatches, appointmentConflicts }; // 실제 필터링된 데이터와 타임슬롯 불일치 정보, appointment 충돌 정보 반환
    } catch (error) {
        logger.error("Error in getEmploymentHeroList", { error: String(error) });
        throw error;
    }
}
