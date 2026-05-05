import {dbAll, dbExecute, getDB} from "@/utils/db/db";
import {ChangeLog, optomData} from "@/types/types";
import type { PostEmailData } from "@/lib/postEmail";
import {chunk} from "@/lib/utils";
import { createLogger } from "@/lib/logger";
import {
    processOptomData,
    processOptomSwap,
    processSwapWithoutNew,
    isSwapOptomChange,
    handleProcessResult,
    processLocumResults,
    type ProcessedSummary,
} from "@/lib/rosterAdjustService";

const logger = createLogger('ChangeProcessor');

export interface SlotMismatch {
    branch: string;
    branchName: string;
    date: string;
    optomId: number;
    name: string;
    employmentHeroSlots: number;
    optomateSlots: number;
}

export interface AppointmentConflict {
    branch: string;
    branchName: string;
    date: string;
    optomId: number;
    name: string;
    email: string;
    startTime: string;
    endTime: string;
    changeType: 'roster_deleted' | 'roster_changed';
    isApiError?: boolean;
}

export async function sendChangeToOptomateAPI(locationFilter?: number[]): Promise<{slotMismatches: SlotMismatch[], appointmentConflicts: AppointmentConflict[]}> {
    const db = await getDB();
    const raw = await dbAll<ChangeLog>(db, `SELECT * FROM CHANGE_LOG`);

    const locSet = new Set(locationFilter ?? []);
    const result = locSet.size === 0 ? raw : raw.filter((log) => {
        if (!log.diffSummary) return false;
        try {
            const diff = JSON.parse(log.diffSummary);
            const locNew = diff?.new?.locationId;
            const locOld = diff?.old?.locationId;
            return (locNew && locSet.has(locNew)) || (locOld && locSet.has(locOld));
        } catch {
            return false;
        }
    });

    if(result.length === 0) {
        return { slotMismatches: [], appointmentConflicts: [] };
    }

    /** 한 번의 플러시에서 동일 로컴 환영 메일이 여러 CHANGE_LOG로 중복 큐잉되지 않도록 */
    const locumEmailDedupeKeys = new Set<string>();

    const BATCH_SIZE = 8;
    const batches = chunk(result, BATCH_SIZE);
    const successIds: number[] = [];
    const processedSummaries: ProcessedSummary[] = [];
    const slotMismatches: SlotMismatch[] = [];
    const appointmentConflicts: AppointmentConflict[] = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];

        const batchPromises = batch.map(async (changeLog) => {
            try {
                const diffSummary = changeLog.diffSummary ? JSON.parse(changeLog.diffSummary) : null;
                const { summaries, mismatches, conflicts } = await callOptomateAPI(changeLog, diffSummary, locumEmailDedupeKeys);
                const hasRealConflicts = conflicts?.some(c => !c.isApiError) ?? false;
                return { id: changeLog.id, success: !hasRealConflicts, summaries, mismatches, conflicts };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.error(`Failed to process change log`, { id: changeLog.id, rosterId: changeLog.rosterId, error: errorMessage });
                return { id: changeLog.id, success: false, summaries: [], mismatches: [], conflicts: [] };
            }
        });

        const batchResults = await Promise.allSettled(batchPromises);

        batchResults.forEach(result => {
            if (result.status === 'fulfilled') {
                const value = result.value;
                if (value?.success) {
                    successIds.push(value.id);
                }
                if (value?.summaries) {
                    processedSummaries.push(...value.summaries);
                }
                if (value?.mismatches) {
                    slotMismatches.push(...value.mismatches);
                }
                if (value?.conflicts) {
                    appointmentConflicts.push(...value.conflicts);
                }
            }
        });

        if (batchIndex < batches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    if (appointmentConflicts.length > 0) {
        logger.info(`Keeping change logs with appointment conflicts`, { count: appointmentConflicts.length });
    }

    if (processedSummaries.length > 0) {
        const summaryItems = processedSummaries.map((s) => ({
            name: (s.name ?? "").trim() || "(unknown)",
            optomId: s.optomId,
            date: s.date,
            start: s.start,
            end: s.end,
        }));
        logger.info(`Processed summary`, { count: processedSummaries.length, items: summaryItems });
    }

    // DELETE는 로깅 등 이후 작업이 끝난 뒤에만 실행 (중간 예외 시 CHANGE_LOG 누락 방지)
    if (successIds.length > 0) {
        const placeholders = successIds.map(() => "?").join(",");
        await dbExecute(db, `DELETE FROM CHANGE_LOG WHERE id IN (${placeholders})`, successIds);
        logger.info(`Deleted processed change logs`, { count: successIds.length });
    }

    return { slotMismatches, appointmentConflicts };
}

async function callOptomateAPI(changeLog: ChangeLog, diffSummary: {old?: optomData, new?: optomData}, locumEmailDedupeKeys: Set<string>): Promise<{summaries: ProcessedSummary[], mismatches: SlotMismatch[], conflicts: AppointmentConflict[]}> {
    logger.info(`Processing change log`, {
        changeType: changeLog.changeType,
        rosterId: changeLog.rosterId,
        old: diffSummary?.old ? {
            employeeId: diffSummary.old.employeeId,
            name: `${diffSummary.old.firstName ?? ''} ${diffSummary.old.lastName ?? ''}`.trim(),
            locationId: diffSummary.old.locationId,
            locationName: diffSummary.old.locationName,
            startTime: diffSummary.old.startTime,
            endTime: diffSummary.old.endTime,
            isLocum: diffSummary.old.isLocum,
        } : null,
        new: diffSummary?.new ? {
            employeeId: diffSummary.new.employeeId,
            name: `${diffSummary.new.firstName ?? ''} ${diffSummary.new.lastName ?? ''}`.trim(),
            locationId: diffSummary.new.locationId,
            locationName: diffSummary.new.locationName,
            startTime: diffSummary.new.startTime,
            endTime: diffSummary.new.endTime,
            isLocum: diffSummary.new.isLocum,
        } : null,
    });

    if(!diffSummary) {
        return { summaries: [], mismatches: [], conflicts: [] };
    }

    const db = await getDB();

    const summaries: ProcessedSummary[] = [];
    const mismatches: SlotMismatch[] = [];
    const conflicts: AppointmentConflict[] = [];
    const locumResults: {emailData?: PostEmailData | null, isFirst?: boolean, optomId?: number, workHistory?: string}[] = [];

    if (changeLog.changeType === 'roster_deleted') {
        if (diffSummary.old && diffSummary.old.firstName && diffSummary.old.lastName && diffSummary.old.employeeId) {
            logger.info(`Processing deleted roster`, {
                rosterId: changeLog.rosterId,
                employeeId: diffSummary.old.employeeId,
                name: `${diffSummary.old.firstName} ${diffSummary.old.lastName}`,
                locationName: diffSummary.old.locationName,
                date: diffSummary.old.startTime?.split("T")[0],
            });
            try {
                const result = await processOptomData(diffSummary.old, db, "deleted");
                if (result.summary) {
                    summaries.push(result.summary);
                }
                if (result.appointmentConflict) {
                    conflicts.push(result.appointmentConflict);
                }
            } catch (error) {
                logger.error(`Failed to process deleted roster`, { error: String(error) });
            }
        } else {
            logger.warn(`Skipped roster_deleted: missing required fields`, {
                rosterId: changeLog.rosterId,
                hasOld: !!diffSummary.old,
                firstName: diffSummary.old?.firstName ?? null,
                lastName: diffSummary.old?.lastName ?? null,
                employeeId: diffSummary.old?.employeeId ?? null,
            });
        }
    } else if (changeLog.changeType === 'roster_changed') {
        if (diffSummary.old && diffSummary.new && isSwapOptomChange(diffSummary)) {
            logger.info(`Processing swap roster`, {
                rosterId: changeLog.rosterId,
                oldEmployeeId: diffSummary.old.employeeId,
                oldName: `${diffSummary.old.firstName} ${diffSummary.old.lastName}`,
                newEmployeeId: diffSummary.new.employeeId,
                newName: `${diffSummary.new.firstName} ${diffSummary.new.lastName}`,
                locationId: diffSummary.old.locationId,
                locationName: diffSummary.old.locationName,
                date: diffSummary.old.startTime?.split("T")[0],
            });
            try {
                const swapResults = await processOptomSwap(diffSummary.old, diffSummary.new, db);
                swapResults.forEach((result, index) => {
                    const label = index === 0 ? "old" : "new";
                    handleProcessResult(result, `swap:${label}`, summaries, mismatches, conflicts, locumResults, locumEmailDedupeKeys);
                });
            } catch (error) {
                logger.error(`Failed to process swap roster`, { error: String(error) });
            }
        } else {
            const dataToProcess: Array<{data: optomData, key: string}> = [];
            const hasOldValid = !!(diffSummary.old && diffSummary.old.firstName && diffSummary.old.lastName && diffSummary.old.employeeId);
            const hasNewValid = !!(diffSummary.new && diffSummary.new.firstName && diffSummary.new.lastName && diffSummary.new.employeeId);

            if (hasOldValid && !hasNewValid && diffSummary.old) {
                try {
                    const result = await processSwapWithoutNew(diffSummary.old, db);
                    handleProcessResult(result, "change:old-only", summaries, mismatches, conflicts, locumResults, locumEmailDedupeKeys);
                } catch (error) {
                    logger.error(`Failed to process old-only roster change`, { error: String(error) });
                }
                return { summaries, mismatches, conflicts };
            }

            if (hasOldValid && diffSummary.old) {
                dataToProcess.push({ data: diffSummary.old, key: "old" });
            }

            if (hasNewValid && diffSummary.new) {
                dataToProcess.push({ data: diffSummary.new, key: "new" });
            }

            for (let i = 0; i < dataToProcess.length; i++) {
                const {data, key} = dataToProcess[i];

                try {
                    const result = await processOptomData(data, db, key);
                    handleProcessResult(result, `change:${key}`, summaries, mismatches, conflicts, locumResults, locumEmailDedupeKeys);

                    if (i < dataToProcess.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                } catch (error) {
                    logger.error(`Failed to process ${key} roster data`, { error: String(error) });
                    if (i < dataToProcess.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }
            }
        }
    } else if (changeLog.changeType === 'roster_inserted') {
        if (diffSummary.new && diffSummary.new.firstName && diffSummary.new.lastName && diffSummary.new.employeeId) {
            try {
                const result = await processOptomData(diffSummary.new, db, "new");
                handleProcessResult(result, "insert:new", summaries, mismatches, conflicts, locumResults, locumEmailDedupeKeys);
            } catch (error) {
                logger.error(`Failed to process inserted roster`, { error: String(error) });
            }
        } else {
            logger.warn(`Skipped roster_inserted: missing required fields`, {
                rosterId: changeLog.rosterId,
                hasNew: !!diffSummary.new,
                firstName: diffSummary.new?.firstName ?? null,
                lastName: diffSummary.new?.lastName ?? null,
                employeeId: diffSummary.new?.employeeId ?? null,
            });
        }
    }

    await processLocumResults(locumResults);

    return { summaries, mismatches, conflicts };
}

export { callOptomateAPI };
