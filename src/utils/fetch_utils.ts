import {toDateOnly} from "@/utils/time";
import {formatting} from "@/utils/formatting";
import {OptomMap} from "@/data/stores";

const refresh = async (start?: Date, end?: Date, locationId?: number) => {
    console.log("=== Refreshing Roster Data ===");
    console.log(`Start: ${start}, End: ${end}, LocationId: ${locationId}`);
    
    try {
        // 날짜만 추출하여 전송 (백엔드에서 정규화하지만, 프론트엔드에서도 명확하게)
        const fromDate = toDateOnly(start ?? new Date("2025-09-01T00:00:00Z"));
        const toDate = toDateOnly(end ?? new Date("2025-09-16T23:59:59Z"));
        
        // LocationId를 OptCode로 변환 (branch 파라미터용)
        const branch = locationId 
            ? OptomMap.find(v => v.LocationId === locationId)?.OptCode 
            : undefined;
        const branchParam = branch ? `&branch=${branch}` : "";
        
        console.log(`Fetching roster data from ${fromDate} to ${toDate}${branch ? ` (Store: ${branch})` : ""}`);
        
        const response = await fetch(`/roster/api/roster/refresh?from=${fromDate}&to=${toDate}${branchParam}`, {
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
        
        const response = await fetch(`/roster/api/roster/refresh?from=${fromDate}&to=${toDate}`, {
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

const getList = async (start?: Date, end?: Date, locationId?: number) => {
    console.log("=== Getting Roster List ===");
    console.log(`Start: ${start}, End: ${end}, LocationId: ${locationId}`);
    
    try {
        // 날짜만 추출하여 전송 (백엔드에서 정규화하지만, 프론트엔드에서도 명확하게)
        const fromDate = toDateOnly(start ?? new Date("2025-09-01T00:00:00Z"));
        const toDate = toDateOnly(end ?? new Date("2025-09-16T23:59:59Z"));
        const locationParam = locationId ? `&locationId=${locationId}` : "";
        
        console.log(`Fetching roster list from ${fromDate} to ${toDate}${locationParam}`);

        // const product = process.env.NODE_ENV === 'production' ? "roster" : "";
        const res = await fetch(`/roster/api/roster/getList?from=${fromDate}&to=${toDate}${locationParam}`, {
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
        
        const res = await fetch(`/roster/api/roster/optom-count?date=${dateOnly}`, {
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
        const res = await fetch(`/roster/api/roster/optom-count?from=${fromDate}&to=${toDate}${weeklyParam}`, {
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