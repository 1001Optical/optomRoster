import {apiFetch} from "@/services/apiFetch";
import { createLogger } from "@/lib/logger";

const logger = createLogger('Appointment');
const apiUrl = process.env.API_BASE_URL;
const API_TOKEN = process.env.API_TOKENS

interface IAdjustData {
    ADJUST_DATE: string,
    BRANCH_IDENTIFIER: string,
    ADJUST_START: string,
    ADJUST_FINISH: string,
    INACTIVE: boolean  // "new"가 아니면 INACTIVE=true (old, deleted 모두)
}

interface IAdjustSwapData {
    ADJUST_DATE: string,
    BRANCH_IDENTIFIER: string,
    ADJUST_START: string,
    ADJUST_FINISH: string
}

export const PostAppAdjust = async (id: number | string, adjust_data: IAdjustData) => {
    const url = `${apiUrl}/api/appointments/appAdjust`;

    logger.info(`PostAppAdjust`, { id, adjust_data });

    try {
        const result = await apiFetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": API_TOKEN ?? ""
            },
            body: JSON.stringify({
                id: id,
                adjust_data: adjust_data
            })
        });

        return { ok: true as const, data: result };
    } catch (e) {
        return { ok: false as const, error: e };
    }
}

export const PostAppAdjustSwapOptom = async (
    id: number | string,
    adjust_data: IAdjustSwapData,
    newOptomId?: number | string,
    new_adjust_data?: IAdjustSwapData
) => {
    const url = `${apiUrl}/api/appointments/appAdjust/swapOptom`;

    try {
        const body: {
            id: number | string;
            adjust_data: IAdjustSwapData;
            newOptomId?: number | string;
            new_adjust_data?: IAdjustSwapData;
        } = { id, adjust_data };

        if (newOptomId !== undefined) {
            body.newOptomId = newOptomId;
        }
        if (new_adjust_data !== undefined) {
            body.new_adjust_data = new_adjust_data;
        }

        logger.info(`PostAppAdjustSwapOptom`, { body });

        const result = await apiFetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": API_TOKEN ?? ""
            },
            body: JSON.stringify(body)
        });

        return { ok: true as const, data: result };
    } catch (e) {
        return { ok: false as const, error: e };
    }
}
