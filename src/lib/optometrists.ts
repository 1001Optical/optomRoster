import {apiFetch} from "@/services/apiFetch";

const API_TOKEN = process.env.NEXT_PUBLIC_API_TOKENS

interface IResult { id: number, workHistory: string[] }
interface ICacheEntry extends IResult { cachedAt: number }

type SearchOptomIdType = (firstName: string, lastName: string, email?: string, externalId?: string) => Promise<IResult | undefined>;

interface SearchResult {
    optomId: number;
    workHistory: string[];
    externalUserId?: string | null;
    email?: string | null;
}

const optomCache = new Map<string, ICacheEntry>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function isExpired(entry?: ICacheEntry) {
    if (!entry) return true;
    return Date.now() - entry.cachedAt > CACHE_TTL;
}

export const searchOptomId: SearchOptomIdType = async (firstName, lastName, email, externalId) => {
    const cacheKey = externalId
        ? `ext:${externalId}`
        : `${firstName}_${lastName}_${email ?? ""}`;
    console.log(`=== Searching Optomate ID ===`);
    console.log(`Full name: ${firstName} ${lastName}`);

    const cached = optomCache.get(cacheKey);
    if (cached && !isExpired(cached)) {
        console.log(`Using cached optom ID for ${firstName} ${lastName}`);
        return { id: cached.id, workHistory: cached.workHistory };
    } else if (cached && isExpired(cached)) {
        optomCache.delete(cacheKey);
    }
    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

    const updateOptometrist = async (optomId: number, payload: { externalUserId?: string; email?: string }) => {
        try {
            if (!apiUrl) {
                throw new Error("NEXT_PUBLIC_API_BASE_URL environment variable is not set");
            }
            const response = await apiFetch(`${apiUrl}/api/optometrist/${optomId}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": API_TOKEN ?? ""
                },
                body: JSON.stringify({
                    externalUserId: payload.externalUserId ?? null,
                    email: payload.email ?? null
                })
            });
            if (!response.success) {
                console.warn(`[OPTOMETRIST UPDATE] Failed to update optomId=${optomId}`, response);
            } else {
                console.log(`[OPTOMETRIST UPDATE] Updated optomId=${optomId}`, payload);
            }
        } catch (err) {
            console.warn(`[OPTOMETRIST UPDATE] Error updating optomId=${optomId}:`, err);
        }
    };

    const search = async (path: string, body: Record<string, unknown>) => {
        const result = await apiFetch(`${apiUrl}${path}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": API_TOKEN ?? ""
            },
            body: JSON.stringify(body ?? {})
        });
        return result;
    };

    
    try {

        if (!apiUrl) {
            throw new Error("NEXT_PUBLIC_API_BASE_URL environment variable is not set");
        }

        const setAndReturn = (data: SearchResult) => {
            optomCache.set(cacheKey, { id: data.optomId, workHistory: data.workHistory, cachedAt: Date.now() });

            // 필요 시 externalUserId / email 업데이트
            const needsExternal = externalId && data?.externalUserId !== externalId;
            const needsEmail = email && data?.email !== email;
            if (data?.optomId && (needsExternal || needsEmail)) {
                const payload: { externalUserId?: string; email?: string } = {};
                if (needsExternal) payload.externalUserId = externalId;
                if (needsEmail) payload.email = email;
                updateOptometrist(data.optomId, payload);
            }

            return { id: data.optomId, workHistory: data.workHistory };
        };

        // 1) ExternalId 우선
        if (externalId) {
            console.log(`Fetching optometrists by externalId: ${externalId}`);
            const result = await search("/api/optometrists/searchByExternalId", { externalUserId: externalId });
            if (result.success && result.data?.optomId) {
                return setAndReturn(result.data);
            }
        }

        // 2) Email
        if (email) {
            console.log(`Fetching optometrists by email: ${email}`);
            const result = await search("/api/optometrists/searchByEmail", { email });
            if (result.success && result.data?.optomId) {
                return setAndReturn(result.data);
            }
        }

        // 3) 이름
        console.log(`Fetching optometrists by name: ${firstName} ${lastName}`);
        const result = await search("/api/optometrists/search", { firstName, lastName });
        if (result.success && result.data?.optomId) {
            return setAndReturn(result.data);
        }

        return undefined;
    } catch (error) {
        console.error(`Error searching for optometrist ID for ${firstName} ${lastName}:`, error);
        throw error;
    }
}

type AddWorkHistory = (id: number, branch: string) => Promise<boolean>;

export const addWorkHistory: AddWorkHistory = async (id, branch) => {
    console.log(`=== Post Work History ===`);
    console.log(`ID: ${id}`);

    try {
        if (!id || !branch) {
            throw new Error("id, branch is required");
        }

        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        if (!apiUrl) {
            throw new Error("NEXT_PUBLIC_API_BASE_URL environment variable is not set");
        }

        // search에 값 넣어 달라고 해야됨
        const url = `${apiUrl}/api/optometrists/optomWorkHistory`;
        console.log(`Fetching optometrists from: ${url}`);

        const result = await apiFetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": API_TOKEN ?? ""
            },
            body: JSON.stringify({
                optomId: id,
                workedHistory: branch
            })
        });

        // 캐시 동기화: addWorkHistory 성공 시 optomCache 업데이트/무효화
        if (result.success) {
            const now = Date.now();
            for (const [key, value] of optomCache.entries()) {
                if (value.id === id) {
                    const history = Array.isArray(value.workHistory) ? value.workHistory : [];
                    const nextHistory = history.includes(branch) ? history : [...history, branch];
                    optomCache.set(key, { id: value.id, workHistory: nextHistory, cachedAt: now });
                }
            }
        }

        return result.success
    } catch (error) {
        console.error(`ERROR AddWorkHistory:`, error);
        throw error;
    }
}