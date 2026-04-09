import {apiFetch} from "@/services/apiFetch";
import { createLogger, maskEmail, maskName } from "@/lib/logger";

const logger = createLogger('Optometrists');
const API_TOKEN = process.env.API_TOKENS

interface IResult { id: number, workHistory: string[] }
interface ICacheEntry extends IResult { cachedAt: number }

type SearchOptomIdType = (firstName: string, lastName: string, email?: string, externalId?: string) => Promise<IResult | undefined>;

interface SearchResult {
    optomId: number;
    fristName: string;
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
    logger.info(`Searching Optomate ID`, { name: `${maskName(safeFirstName)} ${maskName(safeLastName)}` });

    const cached = optomCache.get(cacheKey);
    if (cached && !isExpired(cached)) {
        logger.debug(`Cache hit for optom ID`, { name: `${maskName(safeFirstName)} ${maskName(safeLastName)}` });
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
            const maskedPayload = {
                externalUserId: payload.externalUserId,
                email: payload.email ? maskEmail(payload.email) : undefined
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
                logger.warn(`Failed to update optometrist`, { optomId, payload: maskedPayload });
            } else {
                logger.debug(`Updated optometrist`, { optomId, payload: maskedPayload });
            }
        } catch (err) {
            logger.warn(`Error updating optometrist`, { optomId, error: String(err) });
        }
    };

    const search = async (path: string, body: Record<string, unknown>) => {
        try {
            const response = await fetch(`${apiUrl}${path}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": API_TOKEN ?? ""
                },
                body: JSON.stringify(body ?? {})
            });
            const responseText = await response.text();
            logger.debug(responseText);
            // if (!response.ok) return null;
            return responseText ? JSON.parse(responseText) : null;
        } catch (e) {
            return null;
        }
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

        const result = await search("/api/optometrist/find", {
            externalUserId: externalId ?? null,
            email: email ?? null,
            firstName: safeFirstName || null,
            lastName: safeLastName || null
        })

        logger.debug(`Searching `, { name: `${maskName(safeFirstName)} ${maskName(safeLastName)}`, email: maskEmail(email ?? "none"), externalId: externalId });
        console.log(result)

        if (result?.success && result.data?.optomId) {
            return setAndReturn(result.data);
        }

        return undefined;
    } catch (error) {
        logger.error(`Error searching optometrist ID`, { name: `${maskName(safeFirstName)} ${maskName(safeLastName)}`, error: String(error) });
        throw error;
    }
}

type AddWorkHistory = (id: number, branch: string) => Promise<boolean>;

export const addWorkHistory: AddWorkHistory = async (id, branch) => {
    logger.info(`Posting work history`, { id, branch });

    try {
        if (!id || !branch) {
            throw new Error("id, branch is required");
        }

        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        if (!apiUrl) {
            throw new Error("NEXT_PUBLIC_API_BASE_URL environment variable is not set");
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
