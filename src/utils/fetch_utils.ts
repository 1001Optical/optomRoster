import {toLocalIsoNoOffset, toDateOnly} from "@/utils/time";
import {formatting} from "@/utils/formatting";

const refresh = async (start?: Date, end?: Date) => {
    console.log("=== Refreshing Roster Data ===");
    console.log(`Start: ${start}, End: ${end}`);
    
    try {
        // 날짜만 추출하여 전송 (백엔드에서 정규화하지만, 프론트엔드에서도 명확하게)
        const fromDate = toDateOnly(start ?? new Date("2025-09-01T00:00:00Z"));
        const toDate = toDateOnly(end ?? new Date("2025-09-16T23:59:59Z"));
        
        console.log(`Fetching roster data from ${fromDate} to ${toDate}`);
        
        const response = await fetch(`/roster/api/roster/refresh?from=${fromDate}&to=${toDate}`, {
            method: "GET",
        });
        
        if (!response.ok) {
            throw new Error(`Roster refresh failed: ${response.status} ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log(`Roster refresh completed, received ${result.data?.length || 0} items`);
        
        return result.data;
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

export {refresh, getList, refreshManual}