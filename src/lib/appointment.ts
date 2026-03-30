import {apiFetch} from "@/services/apiFetch";

const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
const API_TOKEN = process.env.NEXT_PUBLIC_API_TOKENS

interface IAdjustData {
    ADJUST_DATE: string,
    BRANCH_IDENTIFIER: string,
    ADJUST_START: string,
    ADJUST_FINISH: string,
    INACTIVE: boolean  // "new"가 아니면 INACTIVE=true (old, deleted 모두)
}

export const PostAppAdjust = async (id: number | string, adjust_data: IAdjustData) => {
    const url = `${apiUrl}/api/appointments/appAdjust`;

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
