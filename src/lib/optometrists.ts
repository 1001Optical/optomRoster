import { apiFetch, fetch1001OptometristApi } from "@/services/apiFetch";
import { createLogger } from "@/lib/logger";

const logger = createLogger('Optometrists');
const API_TOKEN = process.env.API_TOKENS

interface IResult { id: number, workHistory: string[] }
interface ICacheEntry extends IResult { cachedAt: number }

type SearchOptomIdType = (firstName: string, lastName: string, email?: string, externalId?: string) => Promise<IResult | undefined>;

interface SearchResult {
    optomId: number;
    firstName: string;
    lastName: string;
    identifier: string;
    workHistory: string[];
    externalUserId?: string | null;
    email?: string | null;
}

const optomCache = new Map<string, ICacheEntry>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// 특수문자 제거 (공백 유지)
const sanitizeName = (value: string) => value.replace(/[^a-zA-Z0-9 ]/g, '').trim();

function isExpired(entry?: ICacheEntry) {
    if (!entry) return true;
    return Date.now() - entry.cachedAt > CACHE_TTL;
}

export const searchOptomId: SearchOptomIdType = async (firstName, lastName, email, externalId) => {
    const safeFirstName = sanitizeName(firstName);
    const safeLastName = sanitizeName(lastName);
    const cacheKey = externalId
        ? `ext:${externalId}`
        : `${safeFirstName}_${safeLastName}_${email ?? ""}`;
    logger.info(`Searching Optomate ID`, { name: `${safeFirstName} ${safeLastName}` });

    const cached = optomCache.get(cacheKey);
    if (cached && !isExpired(cached)) {
        logger.debug(`Cache hit for optom ID`, { name: `${safeFirstName} ${safeLastName}` });
        return { id: cached.id, workHistory: cached.workHistory };
    } else if (cached && isExpired(cached)) {
        optomCache.delete(cacheKey);
    }
    const apiUrl = process.env.API_BASE_URL;

    const updateOptometrist = async (optomId: number, payload: { externalUserId?: string; email?: string }) => {
        try {
            if (!apiUrl) {
                throw new Error("API_BASE_URL environment variable is not set");
            }
            const logPayload = {
                externalUserId: payload.externalUserId,
                email: payload.email ?? undefined
            };
            const response = await apiFetch(`${apiUrl}/api/optometrist/${optomId}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": API_TOKEN ? `Bearer ${API_TOKEN}` : ""
                },
                body: JSON.stringify({
                    externalUserId: payload.externalUserId ?? null,
                    email: payload.email ?? null
                })
            });
            if (!response.success) {
                logger.warn(`Failed to update optometrist`, { optomId, payload: logPayload });
            } else {
                logger.debug(`Updated optometrist`, { optomId, payload: logPayload });
            }
        } catch (err) {
            logger.warn(`Error updating optometrist`, { optomId, error: String(err) });
        }
    };

    const search = async (path: string, body: Record<string, unknown>) => {
        try {
            const response = await fetch1001OptometristApi(`${apiUrl}${path}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": API_TOKEN ?? ""
                },
                body: JSON.stringify(body ?? {})
            });
            const responseText = await response.text();
            logger.debug(responseText);
            return responseText ? JSON.parse(responseText) : null;
        } catch (e) {
            return null;
        }
    };


    try {
        if (!apiUrl) {
            throw new Error("API_BASE_URL environment variable is not set");
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

        const result = await search("/api/optometrist/find", {
            externalUserId: externalId ?? null,
            email: email ?? null,
            firstName: safeFirstName || null,
            lastName: safeLastName || null
        })

        logger.debug(`Searching`, { name: `${safeFirstName} ${safeLastName}`, email: email ?? "none", externalId: externalId });

        if (result?.success && result.data?.optomId) {
            return setAndReturn(result.data);
        }

        return undefined;
    } catch (error) {
        logger.error(`Error searching optometrist ID`, { name: `${safeFirstName} ${safeLastName}`, error: String(error) });
        throw error;
    }
}

/** 신규 계정 생성 직후 캐시에 "없음"이 남지 않도록 무효화 (병렬 처리 시 재검색용) */
export function invalidateOptomSearchCacheFor(optomData: {
    employeeId?: number | null;
    id?: number | null;
    firstName: string;
    lastName: string;
    email?: string | null;
}) {
    const { employeeId, id, firstName, lastName, email } = optomData;
    if (employeeId != null && String(employeeId).trim() !== "") {
        optomCache.delete(`ext:${String(employeeId)}`);
    }
    if (id != null && String(id).trim() !== "") {
        optomCache.delete(`ext:${String(id)}`);
    }
    const safeFirstName = sanitizeName(firstName);
    const safeLastName = sanitizeName(lastName);
    optomCache.delete(`${safeFirstName}_${safeLastName}_${email ?? ""}`);
}

type AddWorkHistory = (id: number, branch: string) => Promise<boolean>;

export const addWorkHistory: AddWorkHistory = async (id, branch) => {
    logger.info(`Posting work history`, { id, branch });

    try {
        if (!id || !branch) {
            throw new Error("id, branch is required");
        }

        const apiUrl = process.env.API_BASE_URL;
        if (!apiUrl) {
            throw new Error("API_BASE_URL environment variable is not set");
        }

        const url = `${apiUrl}/api/optometrists/optomWorkHistory`;
        logger.debug(`Calling work history endpoint`, { url });

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
        logger.error(`Error in addWorkHistory`, { id, error: String(error) });
        throw error;
    }
}
