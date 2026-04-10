import {dbAll, dbExecute, dbGet, getDB} from "@/utils/db/db";
import {ChangeLog, optomData} from "@/types/types";
import {formatHm, setTimeZone} from "@/utils/time";
import {addWorkHistory, searchOptomId} from "@/lib/optometrists";
import type { PostEmailData } from "@/lib/postEmail";
import { queueEmail } from "@/lib/postEmail";
import {OptomMap} from "@/data/stores";
import {createOptomAccount} from "@/lib/createOptomAccount";
import {chunk} from "@/lib/utils";
import {createSecret} from "@/utils/crypto";
import {calculateSlots} from "@/utils/slots";
import type { Client } from "@libsql/client";
import {PostAppAdjust, PostAppAdjustSwapOptom} from "@/lib/appointment";
import { createLogger, maskName } from "@/lib/logger";

const logger = createLogger('ChangeProcessor');

// 처리된 데이터 요약 타입
interface ProcessedSummary {
    name: string;
    optomId: number;
    date: string;
    start: string;
    end: string;
}

interface ProcessOptomResult {
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

type BranchInfo = (typeof OptomMap)[number];

interface OptomContext {
    optomId: number;
    isFirst: boolean;
    username?: string;
    branchInfo: BranchInfo;
    date: string;
    adjustStart: string;
    adjustFinish: string;
    workFirst: boolean;
    employmentHeroSlots: number;
}

type AppAdjustData = {
    ADJUST_DATE: string;
    BRANCH_IDENTIFIER: string;
    ADJUST_START: string;
    ADJUST_FINISH: string;
    INACTIVE?: boolean;
};

function logLocumEmailSkip(
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

// 타임슬롯 불일치 정보 타입
export interface SlotMismatch {
    branch: string;
    branchName: string;
    date: string;
    optomId: number;
    name: string;
    employmentHeroSlots: number;
    optomateSlots: number;
}

// Appointment 충돌 정보 타입
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
    isApiError?: boolean; // true: API 오류로 확인 불가 (CHANGE_LOG 삭제), false/undefined: 실제 예약 존재 (CHANGE_LOG 유지)
}

// ---- 외부 API 전송 함수 ----
// locationFilter: 처리할 locationId 제한 (없으면 전체)
// skipEmail: legacy param (email alerts disabled)
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

        // 배치 내부의 change log들을 병렬 처리
        const batchPromises = batch.map(async (changeLog) => {
            try {
                const diffSummary = changeLog.diffSummary ? JSON.parse(changeLog.diffSummary) : null;
                const { summaries, mismatches, conflicts } = await callOptomateAPI(changeLog, diffSummary);
                // 실제 예약이 있는 경우만 CHANGE_LOG 유지 (API 오류는 재시도 불필요하므로 삭제)
                const hasRealConflicts = conflicts?.some(c => !c.isApiError) ?? false;
                const hasConflicts = conflicts && conflicts.length > 0;
                return { id: changeLog.id, success: !hasRealConflicts, summaries, mismatches, conflicts, hasConflicts };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.error(`Failed to process change log`, { id: changeLog.id, rosterId: changeLog.rosterId, error: errorMessage });
                return { id: changeLog.id, success: false, summaries: [], mismatches: [], conflicts: [], hasConflicts: false };
            }
        });

        // 배치 내부의 모든 change log가 병렬로 처리됨 (각 change log 내부는 순차 처리)
        const batchResults = await Promise.allSettled(batchPromises);

        // 성공한 change log ID 수집 및 요약 수집
        batchResults.forEach(result => {
            if (result.status === 'fulfilled') {
                const value = result.value;
                // 실제 예약 충돌이 없는 경우 CHANGE_LOG 삭제 (API 오류 포함)
                if (value?.success) {
                    successIds.push(value.id);
                }
                // 요약 정보는 항상 수집 (충돌이 있어도 로그는 남김)
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

        // 마지막 배치가 아니면 배치 간 1초 대기
        if (batchIndex < batches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    if(successIds.length > 0){
        const placeholders = successIds.map(() => "?").join(',');
        await dbExecute(db, `DELETE FROM CHANGE_LOG WHERE id IN (${placeholders})`, successIds);
        logger.info(`Deleted processed change logs`, { count: successIds.length });
    }

    // Appointment 충돌이 있는 경우 CHANGE_LOG를 유지하여 재시도 가능하도록 함
    if (appointmentConflicts.length > 0) {
        logger.info(`Keeping change logs with appointment conflicts`, { count: appointmentConflicts.length });
    }

    // 모든 처리가 끝난 후 요약 출력
    if (processedSummaries.length > 0) {
        logger.info(`Processed summary`, { count: processedSummaries.length, items: processedSummaries.map(s => ({
            name: maskName(s.name.split(' ')[0]) + ' ' + maskName(s.name.split(' ')[1] ?? ''),
            optomId: s.optomId,
            date: s.date,
            start: s.start,
            end: s.end
        })) });
    }

    // 타임슬롯 비교 비활성화 (성능 이슈)

    // Appointment conflict email alerts disabled for performance.

    return { slotMismatches, appointmentConflicts };
}

function buildAppAdjust(context: OptomContext, includeInactive: boolean, inactiveValue: boolean): AppAdjustData {
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

async function resolveOptomContext(optomData: optomData): Promise<OptomContext> {
    let isFirst = false;
    let username = undefined;
    const email = optomData.email;
    const externalId = optomData.employeeId ? optomData.employeeId.toString() : undefined;

    // 이름으로 먼저 검색, 실패 시 email로 재검색
    // 검색 실패 시에도 계정 생성을 시도하도록 에러를 catch
    let optomInfo: { id: number; workHistory: string[] } | undefined = undefined;
    try {
        optomInfo = await searchOptomId(optomData.firstName, optomData.lastName, email, externalId);
    } catch (searchError) {
        logger.warn(`Search failed, will attempt to create account`, { name: `${maskName(optomData.firstName)} ${maskName(optomData.lastName)}`, error: String(searchError) });
        // 검색 실패해도 계속 진행 (계정 생성 시도)
    }

    let id = optomInfo?.id;

    logger.debug(`Resolved optomId`, { optomId: id });

    // 검색 후 아이디가 없을 시 생성로직 (검색 실패 또는 결과 없음)
    if (!id) {
        try {
            // id가 없으면 employeeId를 사용 (둘 다 Employment Hero 식별자)
            // id는 roster ID, employeeId는 employee ID
            const externalId = optomData.id ?? optomData.employeeId;
            if (!externalId) {
                throw new Error(`Cannot create account: both id and employeeId are missing for ${optomData.firstName} ${optomData.lastName}`);
            }

            logger.info(`Creating new account`, { name: `${maskName(optomData.firstName)} ${maskName(optomData.lastName)}`, externalId });
            const info = await createOptomAccount(externalId.toString(), optomData.firstName, optomData.lastName, email);
            id = info.id;
            username = info.username;
            isFirst = true;
            logger.info(`Account created`, { optomId: id, username });
        } catch (accountError) {
            logger.error(`Failed to create account`, { name: `${maskName(optomData.firstName)} ${maskName(optomData.lastName)}`, error: String(accountError) });
            throw accountError;
        }
    }

    // 시간 파싱 및 검증
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

    // workHistory에 BRANCH_IDENTIFIER가 없을 때 workFirst = true
    const workFirst = !optomInfo?.workHistory?.includes(branchInfo.OptCode);

    // Employment Hero 로스터의 타임슬롯 계산
    const startDate = new Date(optomData.startTime);
    const endDate = new Date(optomData.endTime);
    const workMinutes = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60));
    const employmentHeroSlots = workMinutes > 0 ? calculateSlots(workMinutes) : 0;

    return {
        optomId: id!,
        isFirst,
        username,
        branchInfo,
        date,
        adjustStart: formatHm(start),
        adjustFinish: formatHm(optomData.endTime.split("T")[1]),
        workFirst,
        employmentHeroSlots
    };
}

async function computeSlotMismatchForNew(
    context: OptomContext,
    optomData: optomData,
    OptomateApiUrl: string,
    appAdjustSuccess: boolean
): Promise<SlotMismatch | undefined> {
    // Optomate에 데이터가 반영될 시간을 주기 위해 약간 대기 (전송 성공한 경우만)
    if (appAdjustSuccess) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    let optomateSlots = 0;
    try {
        optomateSlots = await getOptomateRosterSlots(OptomateApiUrl, context.optomId ?? 0, context.branchInfo.OptCode, context.date);

        // 타임슬롯 비교 (APP_ADJUST 전송 성공 여부와 관계없이 항상 체크)
        if (context.employmentHeroSlots !== optomateSlots && optomateSlots > 0) {
            logger.warn(`Slot mismatch`, {
                branch: context.branchInfo.OptCode,
                branchName: context.branchInfo.StoreName,
                date: context.date,
                optomId: context.optomId,
                ehSlots: context.employmentHeroSlots,
                optomateSlots
            });

            return {
                branch: context.branchInfo.OptCode,
                branchName: context.branchInfo.StoreName,
                date: context.date,
                optomId: context.optomId,
                name: `${optomData.firstName} ${optomData.lastName}`,
                employmentHeroSlots: context.employmentHeroSlots,
                optomateSlots: optomateSlots
            };
        } else if (context.employmentHeroSlots === optomateSlots && optomateSlots > 0) {
            logger.debug(`Slot match`, { branch: context.branchInfo.OptCode, date: context.date, slots: context.employmentHeroSlots, optomId: context.optomId });
        }
    } catch (slotError) {
        logger.warn(`Failed to get Optomate slots`, { error: slotError instanceof Error ? slotError.message : String(slotError) });
    }

    return undefined;
}

async function finalizeOptomAdjust(
    context: OptomContext,
    optomData: optomData,
    db: Client,
    OptomateApiUrl: string,
    key: string,
    appAdjust: AppAdjustData,
    options?: { sendAdjust?: boolean; skipSlotMismatch?: boolean; appAdjustSuccessOverride?: boolean; }
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

    const effectiveAdjustSuccess = options?.appAdjustSuccessOverride ?? appAdjustSuccess;

    let slotMismatch: SlotMismatch | undefined = undefined;
    if (key === "new" && !options?.skipSlotMismatch) {
        slotMismatch = await computeSlotMismatchForNew(context, optomData, OptomateApiUrl, effectiveAdjustSuccess);
    }

    // 실패해도 요약/후속 처리는 계속 진행

    // 삭제된 경우 이메일 전송하지 않음
    let emailData = null;
    if (key !== "deleted" && optomData.isLocum) {
        // 스토어 템플릿 조회
        const template = await dbGet<{ info: string }>(
            db,
            'SELECT info FROM STORE_INFO WHERE OptCode = ?',
            [context.branchInfo.OptCode]
        );

        // 이메일 데이터 준비 (Locum인 경우만, 삭제가 아닌 경우만)
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

    // 요약 정보 생성
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
        slotMismatch,
        appointmentConflict: undefined
    };
}

function handleProcessResult(
    result: ProcessOptomResult,
    context: string,
    summaries: ProcessedSummary[],
    mismatches: SlotMismatch[],
    conflicts: AppointmentConflict[],
    locumResults: {emailData?: PostEmailData | null, isFirst?: boolean, optomId?: number, workHistory?: string}[]
) {
    if (result.summary) {
        summaries.push(result.summary);
        if (result.slotMismatch) {
            mismatches.push(result.slotMismatch);
        }
        if (result.isLocum && result.emailData && result.workFirst) {
            locumResults.push({
                emailData: result.emailData,
                isFirst: result.isFirst,
                optomId: result.optomId,
                workHistory: result.workHistory
            });
        } else {
            logLocumEmailSkip(result, context);
        }
    }
    if (result.appointmentConflict) {
        conflicts.push(result.appointmentConflict);
    }
}

function isSwapOptomChange(diffSummary: { old?: optomData; new?: optomData }): boolean {
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

async function processOptomSwap(
    oldData: optomData,
    newData: optomData,
    db: Client,
    OptomateApiUrl: string
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
        OptomateApiUrl,
        "old",
        oldSwapAdjust,
        { sendAdjust: false, skipSlotMismatch: true }
    );

    const newResult = await finalizeOptomAdjust(
        newContext,
        newData,
        db,
        OptomateApiUrl,
        "new",
        newSwapAdjust,
        { sendAdjust: false, appAdjustSuccessOverride: swapSuccess }
    );

    return [oldResult, newResult];
}

async function processSwapWithoutNew(
    oldData: optomData,
    db: Client,
    OptomateApiUrl: string
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
        OptomateApiUrl,
        "new",
        adjust,
        { sendAdjust: false, appAdjustSuccessOverride: swapSuccess }
    );
}

// processOptomData 함수 추가
async function processOptomData(
    optomData: optomData,
    db: Client,
    OptomateApiUrl: string,
    key: string
): Promise<ProcessOptomResult> {
    try {
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
            OptomateApiUrl,
            key,
            appAdjust,
            { sendAdjust: true }
        );
    } catch (error) {
        throw error;
    }
}

// 최적화된 callOptomateAPI 함수
async function callOptomateAPI(changeLog: ChangeLog, diffSummary: {old?: optomData, new?: optomData}): Promise<{summaries: ProcessedSummary[], mismatches: SlotMismatch[], conflicts: AppointmentConflict[]}> {
    logger.info(`Processing change log`, { changeType: changeLog.changeType, rosterId: changeLog.rosterId });

    if(!diffSummary) {
        return { summaries: [], mismatches: [], conflicts: [] };
    }

    const db = await getDB();
    const OptomateApiUrl = process.env.OPTOMATE_API_URL;

    if (!OptomateApiUrl) {
        throw new Error("OPTOMATE_API_URL environment variable is not set");
    }

    const summaries: ProcessedSummary[] = [];
    const mismatches: SlotMismatch[] = [];
    const conflicts: AppointmentConflict[] = [];
    const locumResults: {emailData?: PostEmailData | null, isFirst?: boolean, optomId?: number, workHistory?: string}[] = [];

    // changeType에 따라 처리 분기
    if (changeLog.changeType === 'roster_deleted') {
        // 삭제된 경우: old 데이터로 INACTIVE=true 전송
        if (diffSummary.old && diffSummary.old.firstName && diffSummary.old.lastName && diffSummary.old.employeeId) {
            logger.info(`Processing deleted roster`, { name: `${maskName(diffSummary.old.firstName)} ${maskName(diffSummary.old.lastName)}` });
            try {
                const result = await processOptomData(diffSummary.old, db, OptomateApiUrl, "deleted");
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
                const swapResults = await processOptomSwap(diffSummary.old, diffSummary.new, db, OptomateApiUrl);
                swapResults.forEach((result, index) => {
                    const label = index === 0 ? "old" : "new";
                    handleProcessResult(result, `swap:${label}`, summaries, mismatches, conflicts, locumResults);
                });
            } catch (error) {
                logger.error(`Failed to process swap roster`, { error: String(error) });
            }
        } else {
            // 변경된 경우: old/new 조합에 따라 처리
            const dataToProcess: Array<{data: optomData, key: string}> = [];
            const hasOldValid = !!(diffSummary.old && diffSummary.old.firstName && diffSummary.old.lastName && diffSummary.old.employeeId);
            const hasNewValid = !!(diffSummary.new && diffSummary.new.firstName && diffSummary.new.lastName && diffSummary.new.employeeId);

            if (hasOldValid && !hasNewValid && diffSummary.old) {
                try {
                    const result = await processSwapWithoutNew(diffSummary.old, db, OptomateApiUrl);
                    handleProcessResult(result, "change:old-only", summaries, mismatches, conflicts, locumResults);
                } catch (error) {
                    logger.error(`Failed to process old-only roster change`, { error: String(error) });
                }
                return { summaries, mismatches, conflicts };
            }

            // old 데이터 처리 (INACTIVE=true)
            if (hasOldValid && diffSummary.old) {
                dataToProcess.push({ data: diffSummary.old, key: "old" });
            }

            // new 데이터 처리 (INACTIVE=false)
            if (hasNewValid && diffSummary.new) {
                dataToProcess.push({ data: diffSummary.new, key: "new" });
            }

            // 순차 처리
            for (let i = 0; i < dataToProcess.length; i++) {
                const {data, key} = dataToProcess[i];

                try {
                    const result = await processOptomData(data, db, OptomateApiUrl, key);
                    handleProcessResult(result, `change:${key}`, summaries, mismatches, conflicts, locumResults);

                    // 마지막 요청이 아니면 1초 대기
                    if (i < dataToProcess.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                } catch (error) {
                    logger.error(`Failed to process ${key} roster data`, { error: String(error) });
                    // 에러 발생 시에도 마지막 요청이 아니면 1초 대기
                    if (i < dataToProcess.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }
            }
        }
    } else if (changeLog.changeType === 'roster_inserted') {
        // 신규 삽입된 경우: new 데이터만 처리
        if (diffSummary.new && diffSummary.new.firstName && diffSummary.new.lastName && diffSummary.new.employeeId) {
            try {
                const result = await processOptomData(diffSummary.new, db, OptomateApiUrl, "new");
                handleProcessResult(result, "insert:new", summaries, mismatches, conflicts, locumResults);
            } catch (error) {
                logger.error(`Failed to process inserted roster`, { error: String(error) });
            }
        }
    }

    if (locumResults.length > 0) {
        const promises = locumResults.map(async (result) => {
            const tasks: Promise<unknown>[] = [];

            if (result.optomId && result.workHistory) {
                tasks.push(addWorkHistory(result.optomId, result.workHistory));
            }

            if (result.emailData) {
                tasks.push(queueEmail(result.emailData, result.isFirst ?? false));
            }

            await Promise.allSettled(tasks);
        });

        await Promise.allSettled(promises);
    }

    return { summaries, mismatches, conflicts };
}

/**
 * Employment Hero에서 브랜치 전체의 타임슬롯 총 개수 계산
 * 로컬 DB의 ROSTER 테이블에서 해당 날짜/브랜치의 모든 로스터 합산
 */
async function getEHBranchTotalSlots(
    db: Client,
    branchCode: string,
    date: string
): Promise<number> {
    try {
        const branchInfo = OptomMap.find(v => v.OptCode === branchCode);
        if (!branchInfo) {
            logger.warn(`Unknown branch code`, { branchCode });
            return 0;
        }

        // 날짜 범위 계산 (해당 날짜 00:00:00 ~ 다음 날 00:00:00)
        const startDateTime = `${date}T00:00:00Z`;
        const [year, month, day] = date.split('-').map(Number);
        const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
        const endDateTime = nextDay.toISOString().split('.')[0] + 'Z';

        // 해당 브랜치의 해당 날짜 로스터 조회
        const rosters = await dbAll<{
            startTime: string;
            endTime: string;
        }>(
            db,
            `
            SELECT startTime, endTime
            FROM ROSTER
            WHERE locationId = ?
              AND startTime >= ?
              AND startTime < ?
        `,
            [branchInfo.LocationId, startDateTime, endDateTime]
        );

        let totalSlots = 0;
        for (const roster of rosters) {
            if (!roster.startTime || !roster.endTime) continue;

            const startDate = new Date(roster.startTime);
            const endDate = new Date(roster.endTime);
            const workMinutes = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60));

            if (workMinutes > 0) {
                totalSlots += calculateSlots(workMinutes);
            }
        }

        logger.debug(`EH branch total slots`, { branch: branchCode, date, totalSlots });
        return totalSlots;
    } catch (error) {
        logger.warn(`Error calculating EH branch slots`, { error: error instanceof Error ? error.message : String(error) });
        return 0;
    }
}

/**
 * Optomate에서 브랜치 전체의 타임슬롯 총 개수 가져오기
 * OptometristsAvailability API 사용
 */
async function getBranchTotalSlots(
    OptomateApiUrl: string,
    branchCode: string,
    date: string
): Promise<number> {
    try {
        // 날짜를 STARTDATETIME과 ENDDATETIME 형식으로 변환
        // 예: "2026-01-11" -> STARTDATETIME: "2026-01-11T00:00", ENDDATETIME: "2026-01-12T00:00"
        const startDateTime = `${date}T00:00`;
        const [year, month, day] = date.split('-').map(Number);
        const nextDay = new Date(year, month - 1, day + 1);
        const endDateStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`;
        const endDateTime = `${endDateStr}T00:00`;

        // API 요청
        const url = `${OptomateApiUrl}/Appointments/OptometristsAvailability`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "authorization": createSecret("1001_HO_JH", "10011001"),
            },
            body: JSON.stringify({
                SEARCH: {
                    BRANCH_IDENTIFIER: branchCode,
                    STARTDATETIME: startDateTime,
                    ENDDATETIME: endDateTime
                }
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.warn(`Branch slots API request failed`, { status: response.status, statusText: response.statusText });
            return 0;
        }

        const result = await response.json();

        // OPTOMETRISTS 배열에서 모든 타임슬롯 계산
        let totalSlots = 0;

        if (result.OPTOMETRISTS && Array.isArray(result.OPTOMETRISTS)) {
            for (const optometrist of result.OPTOMETRISTS) {
                if (optometrist.AVAILABLE_TIMEBLOCKS && Array.isArray(optometrist.AVAILABLE_TIMEBLOCKS)) {
                    for (const timeblock of optometrist.AVAILABLE_TIMEBLOCKS) {
                        if (timeblock.STARTDATETIME && timeblock.ENDDATETIME) {
                            // ISO 8601 형식의 날짜 문자열을 Date 객체로 변환
                            const startDate = new Date(timeblock.STARTDATETIME);
                            const endDate = new Date(timeblock.ENDDATETIME);

                            // 유효한 날짜인지 확인
                            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                                logger.warn(`Invalid timeblock date format`, { start: timeblock.STARTDATETIME, end: timeblock.ENDDATETIME });
                                continue;
                            }

                            // 시간 차이를 분 단위로 계산
                            const workMinutes = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60));

                            if (workMinutes > 0) {
                                // 타임슬롯 개수 계산
                                const slots = calculateSlots(workMinutes);
                                totalSlots += slots;
                            }
                        }
                    }
                }
            }
        }

        logger.debug(`Branch total slots from Optomate`, { branch: branchCode, date, totalSlots });
        return totalSlots;
    } catch (error) {
        logger.warn(`Error getting branch total slots`, { error: error instanceof Error ? error.message : String(error) });
        return 0;
    }
}

/**
 * Optomate에서 특정 날짜/브랜치/optomId의 로스터 타임슬롯 가져오기
 */
async function getOptomateRosterSlots(
    OptomateApiUrl: string,
    optomId: number,
    branchCode: string,
    date: string
): Promise<number> {
    try {
        // Optomate API에서 해당 날짜의 로스터 정보 가져오기
        // 날짜 범위를 브랜치 시간대로 변환
        const { fromZonedTime } = await import("date-fns-tz");

        // 브랜치 시간대 가져오기
        const store = OptomMap.find((s) => s.OptCode === branchCode);
        let timezone = "Australia/Sydney";
        if (store) {
            switch (store.State) {
                case "NSW":
                    timezone = "Australia/Sydney";
                    break;
                case "VIC":
                    timezone = "Australia/Melbourne";
                    break;
                case "QLD":
                    timezone = "Australia/Brisbane";
                    break;
            }
        }

        // 날짜 범위를 브랜치 시간대로 변환
        const [year, month, day] = date.split('-').map(Number);
        const startLocalDate = new Date(year, month - 1, day, 0, 0, 0);
        const startUtc = fromZonedTime(startLocalDate, timezone);
        const endLocalDate = new Date(year, month - 1, day + 1, 0, 0, 0);
        const endUtc = fromZonedTime(endLocalDate, timezone);

        const startDateTime = startUtc.toISOString().replace(/\.\d{3}Z$/, "Z");
        const endDateTime = endUtc.toISOString().replace(/\.\d{3}Z$/, "Z");

        // Optomate API에서 해당 optomId의 AppAdjust 정보 조회
        // AppAdjust는 로스터 조정 정보이므로, 이를 통해 타임슬롯 계산
        // OData $expand와 $filter 사용
        const response = await fetch(
            `${OptomateApiUrl}/Optometrist(${optomId})?$expand=AppAdjust&$filter=AppAdjust/ADJUST_DATE ge ${startDateTime} and AppAdjust/ADJUST_DATE lt ${endDateTime} and AppAdjust/BRANCH_IDENTIFIER eq '${branchCode}' and AppAdjust/INACTIVE eq false`,
            {
                headers: {
                    "Content-Type": "application/json",
                    "authorization": createSecret("1001_HO_JH", "10011001"),
                },
            }
        );

        if (!response.ok) {
            // API 호출 실패 시 0 반환 (비교 불가)
            return 0;
        }

        const result = await response.json();

        // AppAdjust 배열에서 타임슬롯 계산
        if (result.AppAdjust && Array.isArray(result.AppAdjust)) {
            let totalSlots = 0;
            for (const adjust of result.AppAdjust) {
                if (adjust.ADJUST_START && adjust.ADJUST_FINISH && !adjust.INACTIVE) {
                    // 시간 문자열을 분으로 변환 (예: "09:00 AM" -> 분)
                    const startTime = parseTimeToMinutes(adjust.ADJUST_START);
                    const endTime = parseTimeToMinutes(adjust.ADJUST_FINISH);
                    if (startTime !== null && endTime !== null && endTime > startTime) {
                        const workMinutes = endTime - startTime;
                        totalSlots += calculateSlots(workMinutes);
                    }
                }
            }
            return totalSlots;
        }

        return 0;
    } catch (error) {
        logger.warn(`Error getting Optomate slots`, { error: error instanceof Error ? error.message : String(error) });
        return 0;
    }
}

/**
 * 시간 문자열을 분으로 변환 (예: "09:00 AM" -> 540분)
 */
function parseTimeToMinutes(timeStr: string): number | null {
    try {
        // "09:00 AM" 형식 파싱
        const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (!match) {
            return null;
        }

        let hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const period = match[3].toUpperCase();

        if (period === "PM" && hours !== 12) {
            hours += 12;
        } else if (period === "AM" && hours === 12) {
            hours = 0;
        }

        return hours * 60 + minutes;
    } catch {
        return null;
    }
}

// ---- Export ----
// sendChangeToOptomateAPI는 이미 함수 선언부에서 export됨
export {
    callOptomateAPI,
    getBranchTotalSlots,
};
