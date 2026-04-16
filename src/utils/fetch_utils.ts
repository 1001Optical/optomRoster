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
    try {
        const fallbackRange = getCurrentWeekRange();
        const fromDate = toDateOnly(start ?? fallbackRange.from);
        const toDate = toDateOnly(end ?? fallbackRange.to);

        let extraParams = "";

        if (typeof selectOption === "string") {
            extraParams = `&state=${selectOption}`;
        } else if (typeof selectOption === "number" && selectOption !== 0) {
            const branch = OptomMap.find(v => v.LocationId === selectOption)?.OptCode;
            if (branch) {
                extraParams = `&branch=${branch}`;
            }
        }

        const response = await fetch(`/api/roster/refresh?manual=true&scheduler=true&from=${fromDate}&to=${toDate}${extraParams}`, {
            method: "GET",
        });

        if (!response.ok) {
            throw new Error(`Roster refresh failed: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        const responseData = result.data || { data: [], slotMismatches: [], appointmentConflicts: [] };

        if (responseData.slotMismatches && responseData.slotMismatches.length > 0) {
            console.warn(`[refresh] ${responseData.slotMismatches.length} slot mismatch(es) found`);
        }
        if (responseData.appointmentConflicts && responseData.appointmentConflicts.length > 0) {
            console.warn(`[refresh] ${responseData.appointmentConflicts.length} appointment conflict(s) found`);
        }

        return {
            data: responseData.data || [],
            slotMismatches: responseData.slotMismatches || [],
            appointmentConflicts: responseData.appointmentConflicts || []
        };
    } catch (err) {
        console.error("[refresh] Error:", err);
        throw err;
    }
}

const refreshManual = async () => {
    try {
        const now = new Date();
        const thisMonth = new Date(now.getFullYear(), now.getMonth()+1, 1);
        const nextMonth = new Date(now.getFullYear(), now.getMonth()+3, 1);

        const fromDate = toDateOnly(thisMonth);
        const toDate = toDateOnly(nextMonth);

        const response = await fetch(`/api/roster/refresh?from=${fromDate}&to=${toDate}`, {
            method: "GET",
        });

        if (!response.ok) {
            throw new Error(`Manual roster refresh failed: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        return result.data;
    } catch (err) {
        console.error("[refreshManual] Error:", err);
        throw err;
    }
}

const getList = async (start?: Date, end?: Date, selectOption?: number | string) => {
    try {
        const fallbackRange = getCurrentWeekRange();
        const fromDate = toDateOnly(start ?? fallbackRange.from);
        const toDate = toDateOnly(end ?? fallbackRange.to);

        let extraParams = "";
        if (typeof selectOption === "string") {
            const locationIds = OptomMap.filter(v => v.State.toUpperCase() === selectOption.toUpperCase()).map(v => v.LocationId);
            if (locationIds.length > 0) {
                extraParams = `&locationIds=${locationIds.join(',')}`;
            }
        } else if (typeof selectOption === "number" && selectOption !== 0) {
            extraParams = `&locationId=${selectOption}`;
        }

        const res = await fetch(`/api/roster/getList?from=${fromDate}&to=${toDate}${extraParams}`, {
            method: "GET",
        });

        if (!res.ok) {
            throw new Error(`Roster list request failed: ${res.status} ${res.statusText}`);
        }

        const result = await res.json();
        const formattedData = formatting(result.data);
        return formattedData;
    } catch (err) {
        console.error("[getList] Error:", err);
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
    try {
        const dateOnly = date.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];

        if (!dateOnly) {
            throw new Error(`Invalid date format: ${date}. Expected: YYYY-MM-DD`);
        }

        const res = await fetch(`/api/roster/optom-count?date=${dateOnly}`, {
            method: "GET",
        });

        if (!res.ok) {
            throw new Error(`Optom count request failed: ${res.status} ${res.statusText}`);
        }

        const result = await res.json();
        return result.data || [];
    } catch (err) {
        console.error("[getOptomCount] Error:", err);
        throw err;
    }
}

const getOptomCountByRange = async (from: string, to: string, weekly: boolean = false): Promise<OptomCountResult[] | { data: OptomCountResult[]; dates: string[] }> => {
    try {
        const fromMatch = from.match(/^(\d{4}-\d{2}-\d{2})/);
        const toMatch = to.match(/^(\d{4}-\d{2}-\d{2})/);

        if (!fromMatch || !toMatch) {
            throw new Error(`Invalid date format. Expected: YYYY-MM-DD`);
        }

        const fromDate = fromMatch[1];
        const toDate = toMatch[1];

        const weeklyParam = weekly ? "&weekly=true" : "";
        const res = await fetch(`/api/roster/optom-count?from=${fromDate}&to=${toDate}${weeklyParam}`, {
            method: "GET",
        });

        if (!res.ok) {
            throw new Error(`Optom count request failed: ${res.status} ${res.statusText}`);
        }

        const result = await res.json();

        if (weekly && result.dates) {
            return { data: result.data || [], dates: result.dates };
        }

        return result.data || [];
    } catch (err) {
        console.error("[getOptomCountByRange] Error:", err);
        throw err;
    }
}

const getChangeLogPendingCount = async (): Promise<number> => {
    try {
        const res = await fetch("/api/roster/change-log-pending-count", {
            method: "GET",
        });
        if (!res.ok) {
            return 0;
        }
        const result = await res.json();
        const count = result?.data?.count;
        return typeof count === "number" ? count : 0;
    } catch {
        return 0;
    }
};

export { refresh, getList, refreshManual, getOptomCount, getOptomCountByRange, getChangeLogPendingCount };
export type { OptomCountResult };
