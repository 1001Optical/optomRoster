import {dbGet} from "@/utils/db/db";
import {optomData} from "@/types/types";
import {formatHm, setTimeZone} from "@/utils/time";
import {addWorkHistory, invalidateOptomSearchCacheFor, searchOptomId} from "@/lib/optometrists";
import type { PostEmailData } from "@/lib/postEmail";
import { queueEmail } from "@/lib/postEmail";
import {OptomMap} from "@/data/stores";
import {createOptomAccount} from "@/lib/createOptomAccount";
import {calculateSlots} from "@/utils/slots";
import type { Client } from "@libsql/client";
import {PostAppAdjust, PostAppAdjustSwapOptom} from "@/lib/appointment";
import { createLogger, maskName } from "@/lib/logger";
import type { SlotMismatch, AppointmentConflict } from "@/lib/changeProcessor";
import type { OptomContext } from "@/lib/slotService";

export type { OptomContext };

const logger = createLogger('RosterAdjust');

/** 동일 인물에 대한 병렬 CHANGE_LOG 처리 시 계정 생성이 한 번만 일어나도록 */
const pendingAccountResolution = new Map<
    string,
    Promise<{ id: number; username?: string; isFirst: boolean; workHistory: string[] }>
>();

function accountResolutionKey(optomData: optomData): string {
    if (optomData.employeeId != null && String(optomData.employeeId).trim() !== "") {
        return `ext:${String(optomData.employeeId)}`;
    }
    if (optomData.id != null && String(optomData.id).trim() !== "") {
        return `ehid:${String(optomData.id)}`;
    }
    const em = (optomData.email ?? "").toLowerCase().trim();
    const fn = (optomData.firstName ?? "").replace(/[^a-zA-Z0-9 ]/g, "").trim();
    const ln = (optomData.lastName ?? "").replace(/[^a-zA-Z0-9 ]/g, "").trim();
    return `n:${fn}|${ln}|${em}`;
}

async function resolveAccountForOptom(optomData: optomData): Promise<{
    id: number;
    username?: string;
    isFirst: boolean;
    workHistory: string[];
}> {
    const key = accountResolutionKey(optomData);
    let inflight = pendingAccountResolution.get(key);
    if (inflight) {
        logger.info(`Account resolution coalesced`, {
            accountKeyType: key.startsWith("ext:")
                ? "employeeId"
                : key.startsWith("ehid:")
                  ? "ehRosterId"
                  : "nameEmail",
            accountKey: key.startsWith("n:") ? undefined : key,
        });
        return inflight;
    }

    const extForSearch = optomData.employeeId ? optomData.employeeId.toString() : undefined;
    const email = optomData.email;

    const safeTrySearch = async (): Promise<{ id: number; workHistory: string[] } | null> => {
        try {
            const r = await searchOptomId(optomData.firstName, optomData.lastName, email, extForSearch);
            return r ? { id: r.id, workHistory: r.workHistory ?? [] } : null;
        } catch (searchError) {
            logger.warn(`Search failed, will attempt to create account`, {
                name: `${maskName(optomData.firstName)} ${maskName(optomData.lastName)}`,
                error: String(searchError),
            });
            return null;
        }
    };

    inflight = new Promise((resolve, reject) => {
        void (async () => {
            try {
                let hit = await safeTrySearch();
                if (hit) {
                    resolve({
                        id: hit.id,
                        username: undefined,
                        isFirst: false,
                        workHistory: hit.workHistory,
                    });
                    return;
                }

                const extId = optomData.id ?? optomData.employeeId;
                if (!extId) {
                    throw new Error(
                        `Cannot create account: both id and employeeId are missing for ${optomData.firstName} ${optomData.lastName}`,
                    );
                }

                logger.info(`Creating new account`, {
                    name: `${maskName(optomData.firstName)} ${maskName(optomData.lastName)}`,
                    externalId: extId,
                });
                const info = await createOptomAccount(
                    extId.toString(),
                    optomData.firstName,
                    optomData.lastName,
                    email,
                );
                invalidateOptomSearchCacheFor({
                    employeeId: optomData.employeeId ?? undefined,
                    id: optomData.id ?? undefined,
                    firstName: optomData.firstName,
                    lastName: optomData.lastName,
                    email,
                });
                hit = await safeTrySearch();
                resolve({
                    id: info.id,
                    username: info.username,
                    isFirst: true,
                    workHistory: hit?.workHistory ?? [],
                });
            } catch (e) {
                reject(e);
            } finally {
                pendingAccountResolution.delete(key);
            }
        })();
    });

    pendingAccountResolution.set(key, inflight);
    return inflight;
}

export interface ProcessedSummary {
    name: string;
    optomId: number;
    date: string;
    start: string;
    end: string;
}

export interface ProcessOptomResult {
    isLocum: boolean;
    emailData?: PostEmailData | null;
    isFirst?: boolean;
    workHistory?: string;
    optomId?: number;
    summary?: ProcessedSummary;
    workFirst?: boolean;
    slotMismatch?: SlotMismatch;
    appointmentConflict?: AppointmentConflict;
}

export type AppAdjustData = {
    ADJUST_DATE: string;
    BRANCH_IDENTIFIER: string;
    ADJUST_START: string;
    ADJUST_FINISH: string;
    INACTIVE?: boolean;
};

export function logLocumEmailSkip(
    result: { isLocum?: boolean, emailData?: PostEmailData | null, workFirst?: boolean, optomId?: number, summary?: ProcessedSummary },
    context: string
) {
    if (!result?.isLocum) return;
    const reason = !result.emailData
        ? "no-emailData"
        : result.workFirst === false
            ? "workFirst-false"
            : "unknown";
    logger.debug(
        `[LOCUM EMAIL] skip context=${context}` +
        ` reason=${reason}` +
        ` optomId=${result.optomId ?? "-"}` +
        ` date=${result.summary?.date ?? "-"}` +
        ` workFirst=${result.workFirst ?? "-"}` +
        ` hasEmailData=${!!result.emailData}`
    );
}

export async function resolveOptomContext(optomData: optomData): Promise<OptomContext> {
    const account = await resolveAccountForOptom(optomData);
    logger.debug(`Resolved optomId`, { optomId: account.id });

    if (!optomData.startTime || !optomData.endTime) {
        throw new Error("Missing startTime or endTime");
    }

    const [date, start] = optomData.startTime.split("T");
    if (!date || !start) {
        throw new Error("Invalid startTime format");
    }

    const branchInfo = OptomMap.find(v => v.LocationId === optomData.locationId);
    if (!branchInfo) {
        throw new Error(`Unknown locationId: ${optomData.locationId}`);
    }

    const workFirst = !account.workHistory.includes(branchInfo.OptCode);

    const startDate = new Date(optomData.startTime);
    const endDate = new Date(optomData.endTime);
    const workMinutes = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60));
    const employmentHeroSlots = workMinutes > 0 ? calculateSlots(workMinutes) : 0;

    return {
        optomId: account.id,
        isFirst: account.isFirst,
        username: account.username,
        branchInfo,
        date,
        adjustStart: formatHm(start),
        adjustFinish: formatHm(optomData.endTime.split("T")[1]),
        workFirst,
        employmentHeroSlots
    };
}

export function buildAppAdjust(context: OptomContext, includeInactive: boolean, inactiveValue: boolean): AppAdjustData {
    const base = {
        ADJUST_DATE: setTimeZone(`${context.date}T00:00:00`),
        BRANCH_IDENTIFIER: context.branchInfo.OptCode,
        ADJUST_START: context.adjustStart,
        ADJUST_FINISH: context.adjustFinish,
    };

    if (!includeInactive) {
        return base;
    }

    return { ...base, INACTIVE: inactiveValue };
}

export async function finalizeOptomAdjust(
    context: OptomContext,
    optomData: optomData,
    db: Client,
    key: string,
    appAdjust: AppAdjustData,
    options?: { sendAdjust?: boolean }
): Promise<ProcessOptomResult> {
    let appAdjustSuccess = false;
    if (options?.sendAdjust !== false) {
        const response = await PostAppAdjust(context.optomId, appAdjust as Required<AppAdjustData>);
        appAdjustSuccess = response.ok === true;
        if (!appAdjustSuccess) {
            const err = response.error instanceof Error ? response.error.message : String(response.error);
            logger.warn(`APP_ADJUST failed but continuing`, { error: err });
        }
    }

    let emailData = null;
    if (key !== "deleted" && optomData.isLocum) {
        const template = await dbGet<{ info: string }>(
            db,
            'SELECT info FROM STORE_INFO WHERE OptCode = ?',
            [context.branchInfo.OptCode]
        );

        if (context.workFirst) {
            emailData = {
                email: optomData.email,
                lastName: optomData.firstName,
                storeName: context.branchInfo.StoreName,
                rosterDate: context.date,
                rosterStart: context.adjustStart,
                rosterEnd: context.adjustFinish,
                storeTemplet: template?.info ?? "",
                optomateId: context.username,
                optomatePw: context.username ? '1001' : undefined,
            };
        }
    }

    const summary: ProcessedSummary = {
        name: `${optomData.firstName} ${optomData.lastName}`,
        optomId: context.optomId,
        date: context.date,
        start: context.adjustStart,
        end: context.adjustFinish
    };

    return {
        isLocum: optomData.isLocum === 1,
        emailData,
        isFirst: context.isFirst,
        workHistory: context.branchInfo.OptCode,
        optomId: context.optomId,
        summary,
        workFirst: context.workFirst,
        slotMismatch: undefined,
        appointmentConflict: undefined
    };
}

function locumEmailDedupeKey(result: ProcessOptomResult): string | null {
    if (!result.emailData || result.optomId == null || !result.workHistory) return null;
    const e = result.emailData;
    return [
        result.optomId,
        result.workHistory,
        e.email.toLowerCase().trim(),
        e.rosterDate,
        e.rosterStart,
        e.rosterEnd,
        e.storeName,
    ].join("|");
}

export function handleProcessResult(
    result: ProcessOptomResult,
    context: string,
    summaries: ProcessedSummary[],
    mismatches: SlotMismatch[],
    conflicts: AppointmentConflict[],
    locumResults: {emailData?: PostEmailData | null, isFirst?: boolean, optomId?: number, workHistory?: string}[],
    locumEmailDedupeKeys?: Set<string>,
) {
    if (result.summary) {
        summaries.push(result.summary);
        if (result.slotMismatch) {
            mismatches.push(result.slotMismatch);
        }
        if (result.isLocum && result.emailData && result.workFirst) {
            const dedupeKey = locumEmailDedupeKey(result);
            if (dedupeKey && locumEmailDedupeKeys?.has(dedupeKey)) {
                logger.info(`Locum email deduped (skipped duplicate queue)`, {
                    context,
                    rosterDate: result.emailData.rosterDate,
                    storeName: result.emailData.storeName,
                });
            } else {
                if (dedupeKey) locumEmailDedupeKeys?.add(dedupeKey);
                locumResults.push({
                    emailData: result.emailData,
                    isFirst: result.isFirst,
                    optomId: result.optomId,
                    workHistory: result.workHistory
                });
            }
        } else {
            logLocumEmailSkip(result, context);
        }
    }
    if (result.appointmentConflict) {
        conflicts.push(result.appointmentConflict);
    }
}

export function isSwapOptomChange(diffSummary: { old?: optomData; new?: optomData }): boolean {
    const oldData = diffSummary.old;
    const newData = diffSummary.new;
    if (!oldData || !newData) return false;
    if (!oldData.employeeId || !newData.employeeId) return false;
    if (oldData.employeeId === newData.employeeId) return false;
    if (!oldData.locationId || !newData.locationId) return false;
    if (oldData.locationId !== newData.locationId) return false;
    if (!oldData.startTime || !newData.startTime) return false;
    const oldDate = oldData.startTime.split("T")[0];
    const newDate = newData.startTime.split("T")[0];
    if (!oldDate || !newDate || oldDate !== newDate) return false;
    return true;
}

export async function processOptomSwap(
    oldData: optomData,
    newData: optomData,
    db: Client
): Promise<ProcessOptomResult[]> {
    const oldContext = await resolveOptomContext(oldData);
    const newContext = await resolveOptomContext(newData);

    const oldSwapAdjust = buildAppAdjust(oldContext, false, false);
    const newSwapAdjust = buildAppAdjust(newContext, false, false);

    logger.info(`Using swapOptom`, {
        oldOptomId: oldContext.optomId,
        newOptomId: newContext.optomId,
        branch: oldContext.branchInfo.StoreName,
        date: oldContext.date
    });

    const swapResponse = await PostAppAdjustSwapOptom(
        oldContext.optomId,
        oldSwapAdjust,
        newContext.optomId,
        newSwapAdjust
    );

    const swapSuccess = swapResponse.ok === true;
    if (!swapSuccess) {
        const err = swapResponse.error instanceof Error ? swapResponse.error.message : String(swapResponse.error);
        logger.warn(`APP_ADJUST swapOptom failed but continuing`, { error: err });
    }

    const oldResult = await finalizeOptomAdjust(
        oldContext,
        oldData,
        db,
        "old",
        oldSwapAdjust,
        { sendAdjust: false }
    );

    const newResult = await finalizeOptomAdjust(
        newContext,
        newData,
        db,
        "new",
        newSwapAdjust,
        { sendAdjust: false }
    );

    return [oldResult, newResult];
}

export async function processSwapWithoutNew(
    oldData: optomData,
    db: Client
): Promise<ProcessOptomResult> {
    const context = await resolveOptomContext(oldData);
    const adjust = buildAppAdjust(context, false, false);

    logger.info(`Using swapOptom without new data`, {
        optomId: context.optomId,
        branch: context.branchInfo.StoreName,
        date: context.date
    });

    const swapResponse = await PostAppAdjustSwapOptom(context.optomId, adjust);
    const swapSuccess = swapResponse.ok === true;
    if (!swapSuccess) {
        const err = swapResponse.error instanceof Error ? swapResponse.error.message : String(swapResponse.error);
        logger.warn(`APP_ADJUST swapOptom failed but continuing`, { error: err });
    }

    return await finalizeOptomAdjust(
        context,
        oldData,
        db,
        "new",
        adjust,
        { sendAdjust: false }
    );
}

export async function processOptomData(
    optomData: optomData,
    db: Client,
    key: string
): Promise<ProcessOptomResult> {
    const context = await resolveOptomContext(optomData);
    const appAdjust = buildAppAdjust(context, true, key !== "new");

    if (key === "deleted") {
        logger.info(`Setting AppAdjust INACTIVE for deleted roster`, { optomId: context.optomId, branch: context.branchInfo.StoreName, date: context.date });
    } else if (key === "old") {
        logger.info(`Setting AppAdjust INACTIVE for changed roster (old)`, { optomId: context.optomId, branch: context.branchInfo.StoreName, date: context.date });
    }

    return await finalizeOptomAdjust(
        context,
        optomData,
        db,
        key,
        appAdjust,
        { sendAdjust: true }
    );
}

export async function processLocumResults(
    locumResults: {emailData?: PostEmailData | null, isFirst?: boolean, optomId?: number, workHistory?: string}[]
): Promise<void> {
    if (locumResults.length === 0) return;

    const workSeen = new Set<string>();
    const emailSeen = new Set<string>();

    const promises = locumResults.map(async (result) => {
        const tasks: Promise<unknown>[] = [];

        if (result.optomId && result.workHistory) {
            const wk = `${result.optomId}|${result.workHistory}`;
            if (!workSeen.has(wk)) {
                workSeen.add(wk);
                tasks.push(addWorkHistory(result.optomId, result.workHistory));
            }
        }

        if (result.emailData) {
            const ek = `${result.optomId}|${result.emailData.email}|${result.emailData.rosterDate}|${result.emailData.rosterStart}|${result.emailData.rosterEnd}|${result.emailData.storeName}`;
            if (!emailSeen.has(ek)) {
                emailSeen.add(ek);
                tasks.push(queueEmail(result.emailData, result.isFirst ?? false));
            }
        }

        await Promise.allSettled(tasks);
    });

    await Promise.allSettled(promises);
}
