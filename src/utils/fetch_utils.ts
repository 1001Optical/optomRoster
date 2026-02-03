import {toDateOnly} from "@/utils/time";
import {formatting} from "@/utils/formatting";
import {OptomMap} from "@/data/stores";

function getCurrentWeekRange(): { from: Date; to: Date } {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0(Sun) ~ 6(Sat)
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - dayOfWeek);
    sunday.setHours(0, 0, 0, 0);

    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    saturday.setHours(23, 59, 59, 999);

    return { from: sunday, to: saturday };
}

const refresh = async (start?: Date, end?: Date, selectOption?: number | string) => {
    console.log("=== Refreshing Roster Data ===");
    console.log(`Start: ${start}, End: ${end}, SelectOption: ${selectOption}`);
    
    try {
        const fallbackRange = getCurrentWeekRange();
        // 날짜만 추출하여 전송 (백엔드에서 정규화하지만, 프론트엔드에서도 명확하게)
        const fromDate = toDateOnly(start ?? fallbackRange.from);
        const toDate = toDateOnly(end ?? fallbackRange.to);
        
        let extraParams = "";
        
        if (typeof selectOption === "string") {
            // 주(State) 단위 동기화
            extraParams = `&state=${selectOption}`;
        } else if (typeof selectOption === "number" && selectOption !== 0) {
            // LocationId를 OptCode로 변환 (branch 파라미터용)
            const branch = OptomMap.find(v => v.LocationId === selectOption)?.OptCode;
            if (branch) {
                extraParams = `&branch=${branch}`;
            }
        }

        // manual=true: 서버에서 수동 호출에만 추가 안전장치를 적용하기 위한 플래그
        const response = await fetch(`/api/roster/refresh?manual=true&scheduler=true&from=${fromDate}&to=${toDate}${extraParams}`, {
            method: "GET",
        });
        
        if (!response.ok) {
            throw new Error(`Roster refresh failed: ${response.status} ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log("[FETCH_UTILS] Full API response:", result);
        
        // API 응답 구조: { message: "success", data: { data: [], slotMismatches: [], appointmentConflicts: [] } }
        const responseData = result.data || { data: [], slotMismatches: [], appointmentConflicts: [] };
        
        console.log(`[FETCH_UTILS] Extracted responseData:`, {
            dataLength: responseData.data?.length || 0,
            slotMismatchesLength: responseData.slotMismatches?.length || 0,
            appointmentConflictsLength: responseData.appointmentConflicts?.length || 0,
            slotMismatches: responseData.slotMismatches,
            appointmentConflicts: responseData.appointmentConflicts
        });
        
        if (responseData.slotMismatches && responseData.slotMismatches.length > 0) {
            console.warn(`⚠️ Found ${responseData.slotMismatches.length} slot mismatches`);
        }
        if (responseData.appointmentConflicts && responseData.appointmentConflicts.length > 0) {
            console.warn(`❌ Found ${responseData.appointmentConflicts.length} appointment conflicts`);
        }
        
        return {
            data: responseData.data || [],
            slotMismatches: responseData.slotMismatches || [],
            appointmentConflicts: responseData.appointmentConflicts || []
        };
    } catch (err) {
        console.error("Error in roster refresh:", err);
        throw err;
    }
}

const refreshManual = async () => {
    console.log("=== Manual Roster Refresh ===");
    
    try {
        const now = new Date();
        const thisMonth = new Date(now.getFullYear(), now.getMonth()+1, 1);
        const nextMonth = new Date(now.getFullYear(), now.getMonth()+3, 1);
        
        console.log(`Manual refresh period: ${thisMonth.toISOString()} to ${nextMonth.toISOString()}`);

        const fromDate = toDateOnly(thisMonth);
        const toDate = toDateOnly(nextMonth);
        
        console.log(`Fetching manual roster data from ${fromDate} to ${toDate}`);
        
        const response = await fetch(`/api/roster/refresh?from=${fromDate}&to=${toDate}`, {
            method: "GET",
        });
        
        if (!response.ok) {
            throw new Error(`Manual roster refresh failed: ${response.status} ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log(`Manual roster refresh completed, received ${result.data?.length || 0} items`);
        
        return result.data;
    } catch (err) {
        console.error("Error in manual roster refresh:", err);
        throw err;
    }
}

const getList = async (start?: Date, end?: Date, selectOption?: number | string) => {
    console.log("=== Getting Roster List ===");
    console.log(`Start: ${start}, End: ${end}, SelectOption: ${selectOption}`);
    
    try {
        const fallbackRange = getCurrentWeekRange();
        // 날짜만 추출하여 전송 (백엔드에서 정규화하지만, 프론트엔드에서도 명확하게)
        const fromDate = toDateOnly(start ?? fallbackRange.from);
        const toDate = toDateOnly(end ?? fallbackRange.to);
        
        let extraParams = "";
        if (typeof selectOption === "string") {
            // 주(State) 단위 조회 (백엔드 getList에서 state 파라미터를 지원하는지 확인 필요, 
            // 현재 DB 구조상 locationId 필터만 가능하므로 locationId 목록으로 변환하여 전달하거나 
            // 백엔드 수정을 고려해야 할 수도 있음. 우선 locationId 파라미터 방식을 유지하되 여러 개 가능 여부 확인)
            const locationIds = OptomMap.filter(v => v.State.toUpperCase() === selectOption.toUpperCase()).map(v => v.LocationId);
            if (locationIds.length > 0) {
                // 여러 locationId를 전달하는 방식이 백엔드에서 지원되는지 확인 필요. 
                // 지원 안 된다면 백엔드 수정 필요. 우선 단일 locationId 처리 방식 유지
                extraParams = `&locationIds=${locationIds.join(',')}`;
            }
        } else if (typeof selectOption === "number" && selectOption !== 0) {
            extraParams = `&locationId=${selectOption}`;
        }
        
        console.log(`Fetching roster list from ${fromDate} to ${toDate}${extraParams}`);

        // const product = process.env.NODE_ENV === 'production' ? "roster" : "";
        const res = await fetch(`/api/roster/getList?from=${fromDate}&to=${toDate}${extraParams}`, {
            method: "GET",
        });
        
        if (!res.ok) {
            throw new Error(`Roster list request failed: ${res.status} ${res.statusText}`);
        }
        
        const result = await res.json();
        console.log(`Roster list retrieved, processing ${result.data?.length || 0} items`);
        
        const formattedData = formatting(result.data);
        console.log(`Roster list formatting completed`);
        
        return formattedData;
    } catch (err) {
        console.error("Error getting roster list:", err);
        throw err;
    }
}

interface OptomCountResult {
    storeName: string;
    locationId: number;
    branch: string;
    state: string;
    slotCount: number;
    appointmentCount: number;
    occupancyRate: number;
}

const getOptomCount = async (date: string): Promise<OptomCountResult[]> => {
    console.log("=== Getting Optom Count ===");
    console.log(`Date: ${date}`);
    
    try {
        // 날짜 형식: YYYY-MM-DD
        const dateOnly = date.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
        
        if (!dateOnly) {
            throw new Error(`Invalid date format: ${date}. Expected: YYYY-MM-DD`);
        }
        
        console.log(`Fetching optom count for date: ${dateOnly}`);
        
        const res = await fetch(`/api/roster/optom-count?date=${dateOnly}`, {
            method: "GET",
        });
        
        if (!res.ok) {
            throw new Error(`Optom count request failed: ${res.status} ${res.statusText}`);
        }
        
        const result = await res.json();
        console.log(`Optom count retrieved, processing ${result.data?.length || 0} stores`);
        
        return result.data || [];
    } catch (err) {
        console.error("Error getting optom count:", err);
        throw err;
    }
}

const getOptomCountByRange = async (from: string, to: string, weekly: boolean = false): Promise<OptomCountResult[] | { data: OptomCountResult[]; dates: string[] }> => {
    console.log("=== Getting Optom Count by Range ===");
    console.log(`From: ${from}, To: ${to}, Weekly: ${weekly}`);
    
    try {
        // 날짜 형식 검증
        const fromMatch = from.match(/^(\d{4}-\d{2}-\d{2})/);
        const toMatch = to.match(/^(\d{4}-\d{2}-\d{2})/);
        
        if (!fromMatch || !toMatch) {
            throw new Error(`Invalid date format. Expected: YYYY-MM-DD`);
        }
        
        const fromDate = fromMatch[1];
        const toDate = toMatch[1];
        
        console.log(`Fetching optom count for range: ${fromDate} to ${toDate}`);
        
        const weeklyParam = weekly ? "&weekly=true" : "";
        const res = await fetch(`/api/roster/optom-count?from=${fromDate}&to=${toDate}${weeklyParam}`, {
            method: "GET",
        });
        
        if (!res.ok) {
            throw new Error(`Optom count request failed: ${res.status} ${res.statusText}`);
        }
        
        const result = await res.json();
        console.log(`Optom count retrieved, processing ${result.data?.length || 0} stores`);
        
        if (weekly && result.dates) {
            return { data: result.data || [], dates: result.dates };
        }
        
        return result.data || [];
    } catch (err) {
        console.error("Error getting optom count by range:", err);
        throw err;
    }
}

export {refresh, getList, refreshManual, getOptomCount, getOptomCountByRange}
export type {OptomCountResult}