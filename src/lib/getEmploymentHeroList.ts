import {getDB} from "@/utils/db/db";
import {createSecret} from "@/utils/crypto";
import {optomData} from "@/types/types";
import {Shift} from "@/types/employment_hero_response";
import {syncRoster} from "@/lib/syncRoster";
import {OptomMap} from "@/data/stores";
import {getEmployeeInfo} from "@/lib/getEmployeeInfo";
import {sendChangeToOptomateAPI} from "@/lib/changeProcessor";
import {chunk} from "@/lib/utils";

export const getEmploymentHeroList: (fromDate: string, toDate: string, branch?: string | null) => Promise<optomData[]> = async (fromDate, toDate, branch) => {
    try {
        const db = getDB();

        const secret = process.env.EMPLOYMENTHERO_SECRET;
        const server_url = process.env.EMPLOYMENTHERO_API_URL;
        
        if (!secret || !server_url) {
            throw new Error("Missing required environment variables: EMPLOYMENTHERO_SECRET or EMPLOYMENTHERO_API_URL");
        }

        let selectedLocations = OptomMap.map(v => `filter.selectedLocations=${v.LocationId}`).join("&")
        if(branch) {
            selectedLocations = `filter.selectedLocations=${OptomMap.find(v => v.OptCode === branch)?.LocationId}`
        }

        const api = `${server_url}/rostershift?filter.fromDate=${fromDate}&filter.toDate=${toDate}${selectedLocations ? `&${selectedLocations}` : ""}`
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

        const returnData: optomData[] = [];

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
        console.log(`Found ${uniqueEmployeeIds.length} unique employees out of ${result.length} shifts`);

        // 직원 정보를 배치로 병렬 처리
        const BATCH_SIZE = 20; // 동시에 5명씩 처리
        const batches = chunk(uniqueEmployeeIds, BATCH_SIZE);
        
        for (const batch of batches) {
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

            // 배치 간 짧은 지연 (API 서버 부하 방지)
            if (batches.length > 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        // 이제 모든 직원 정보가 준비되었으므로 변환 처리 (동일한 로직 유지)
        const convertedData: (optomData | undefined)[] | [] = Array.isArray(result) ? result.map((shift: Shift, index: number): optomData | undefined => {
            try {
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
                    console.warn(`No cached info for employee ${shift.employeeId}`);
                    return undefined;
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
        
        await syncRoster(db, filterData, {start: fromDate, end: toDate});
        
        await sendChangeToOptomateAPI();

        return returnData;
    } catch (error) {
        console.error("Error in getEmploymentHeroList:", error);
        throw error;
    }
}