import {dbAll, dbExecute, getDB} from "@/utils/db/db";
import {ChangeLog, optomData} from "@/types/types";
import type { PostEmailData } from "@/lib/postEmail";
import {chunk} from "@/lib/utils";
import { createLogger, maskName } from "@/lib/logger";
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
                const { summaries, mismatches, conflicts } = await callOptomateAPI(changeLog, diffSummary);
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

    if(successIds.length > 0){
        const placeholders = successIds.map(() => "?").join(',');
        await dbExecute(db, `DELETE FROM CHANGE_LOG WHERE id IN (${placeholders})`, successIds);
        logger.info(`Deleted processed change logs`, { count: successIds.length });
    }

    if (appointmentConflicts.length > 0) {
        logger.info(`Keeping change logs with appointment conflicts`, { count: appointmentConflicts.length });
    }

    if (processedSummaries.length > 0) {
        logger.info(`Processed summary`, { count: processedSummaries.length, items: processedSummaries.map(s => ({
            name: maskName(s.name.split(' ')[0]) + ' ' + maskName(s.name.split(' ')[1] ?? ''),
            optomId: s.optomId,
            date: s.date,
            start: s.start,
            end: s.end
        })) });
    }

    return { slotMismatches, appointmentConflicts };
}

async function callOptomateAPI(changeLog: ChangeLog, diffSummary: {old?: optomData, new?: optomData}): Promise<{summaries: ProcessedSummary[], mismatches: SlotMismatch[], conflicts: AppointmentConflict[]}> {
    logger.info(`Processing change log`, { changeType: changeLog.changeType, rosterId: changeLog.rosterId });

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
            logger.info(`Processing deleted roster`, { name: `${maskName(diffSummary.old.firstName)} ${maskName(diffSummary.old.lastName)}` });
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
        }
    } else if (changeLog.changeType === 'roster_changed') {
        if (diffSummary.old && diffSummary.new && isSwapOptomChange(diffSummary)) {
            logger.info(`Processing swap roster`, {
                oldName: `${maskName(diffSummary.old.firstName)} ${maskName(diffSummary.old.lastName)}`,
                newName: `${maskName(diffSummary.new.firstName)} ${maskName(diffSummary.new.lastName)}`
            });
            try {
                const swapResults = await processOptomSwap(diffSummary.old, diffSummary.new, db);
                swapResults.forEach((result, index) => {
                    const label = index === 0 ? "old" : "new";
                    handleProcessResult(result, `swap:${label}`, summaries, mismatches, conflicts, locumResults);
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
                    handleProcessResult(result, "change:old-only", summaries, mismatches, conflicts, locumResults);
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
                    handleProcessResult(result, `change:${key}`, summaries, mismatches, conflicts, locumResults);

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
                handleProcessResult(result, "insert:new", summaries, mismatches, conflicts, locumResults);
            } catch (error) {
                logger.error(`Failed to process inserted roster`, { error: String(error) });
            }
        }
    }

    await processLocumResults(locumResults);

    return { summaries, mismatches, conflicts };
}

export { callOptomateAPI };
