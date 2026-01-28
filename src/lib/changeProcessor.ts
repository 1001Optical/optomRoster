import {getDB} from "@/utils/db/db";
import {ChangeLog, optomData} from "@/types/types";
import {formatHm, setTimeZone} from "@/utils/time";
import {addWorkHistory, searchOptomId} from "@/lib/optometrists";
import {postEmail, PostEmailData} from "@/lib/postEmail";
import {OptomMap} from "@/data/stores";
import {createOptomAccount} from "@/lib/createOptomAccount";
import {chunk} from "@/lib/utils";
import {createSecret} from "@/utils/crypto";
import {calculateSlots} from "@/utils/slots";
import type Database from "better-sqlite3";

// 처리된 데이터 요약 타입
interface ProcessedSummary {
    name: string;
    optomId: number;
    date: string;
    start: string;
    end: string;
}

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
    console.log(
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
}

// ---- 외부 API 전송 함수 ----
// locationFilter: 처리할 locationId 제한 (없으면 전체)
// skipEmail: 메일 발송을 건너뛸지 여부 (스토어별 처리 시 true로 설정하여 나중에 한 번에 보낼 수 있음)
export async function sendChangeToOptomateAPI(
    isScheduler: boolean = false,
    locationFilter?: number[],
    skipEmail: boolean = false,
    skipAlerts: boolean = false
): Promise<{slotMismatches: SlotMismatch[], appointmentConflicts: AppointmentConflict[]}> {
    const db = getDB();
    const raw: ChangeLog[] = db.prepare(`SELECT * FROM CHANGE_LOG`).all() as ChangeLog[];

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
                const { summaries, mismatches, conflicts } = await callOptomateAPI(changeLog, diffSummary, skipAlerts);
                // Appointment 충돌이 있으면 success=false로 처리하여 CHANGE_LOG를 유지 (재시도 가능하도록)
                const hasConflicts = conflicts && conflicts.length > 0;
                return { id: changeLog.id, success: !hasConflicts, summaries, mismatches, conflicts, hasConflicts };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error(`❌ [CHANGE_LOG] Failed to process change log ${changeLog.id} (rosterId: ${changeLog.rosterId}):`, errorMessage);
                return { id: changeLog.id, success: false, summaries: [], mismatches: [], conflicts: [], hasConflicts: false };
            }
        });

        // 배치 내부의 모든 change log가 병렬로 처리됨 (각 change log 내부는 순차 처리)
        const batchResults = await Promise.allSettled(batchPromises);

        // 성공한 change log ID 수집 및 요약 수집
        batchResults.forEach(result => {
            if (result.status === 'fulfilled') {
                const value = result.value;
                // 성공했고 충돌이 없는 경우에만 CHANGE_LOG 삭제
                if (value?.success && !value.hasConflicts) {
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
        db.prepare(`DELETE FROM CHANGE_LOG WHERE id IN (${placeholders})`).run(...successIds);
        console.log(`[CHANGE_LOG] Deleted ${successIds.length} processed change log(s)`);
    }
    
    // Appointment 충돌이 있는 경우 CHANGE_LOG를 유지하여 재시도 가능하도록 함
    if (appointmentConflicts.length > 0) {
        console.log(`[CHANGE_LOG] Keeping ${appointmentConflicts.length} change log(s) with appointment conflicts for retry`);
    }

    // 모든 처리가 끝난 후 요약 출력
    if (processedSummaries.length > 0) {
        console.log("\n" + "=".repeat(80));
        console.log("📋 Processed Summary");
        console.log("=".repeat(80));
        processedSummaries.forEach((summary, index) => {
            console.log(`${index + 1}. ${summary.name} | ${summary.optomId} | ${summary.date} | ${summary.start} | ${summary.end}`);
        });
        console.log("=".repeat(80) + "\n");
    }

    // 브랜치 전체 타임슬롯 비교 추가
    if (!skipAlerts) {
        const branchMismatches = await compareBranchTotalSlots(db);
        slotMismatches.push(...branchMismatches);
    }

    // Appointment 충돌이 있고 스케줄러인 경우 메일 전송 (skipEmail이 false인 경우에만)
    if (appointmentConflicts.length > 0 && isScheduler && !skipEmail) {
        await sendAppointmentConflictEmail(appointmentConflicts);
    }

    return { slotMismatches, appointmentConflicts };
}

/**
 * Appointment 충돌 메일 전송 (스케줄러용) - Gmail API 사용
 * 외부에서도 호출 가능하도록 export
 */
export async function sendAppointmentConflictEmail(conflicts: AppointmentConflict[]): Promise<void> {
    try {
        // Gmail API 설정 확인
        if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_SENDER) {
            console.warn(`[APPOINTMENT CONFLICT] Gmail API credentials not set, skipping email`);
            return;
        }

        // gmail_token.json 파일 읽기
        const fs = await import("fs");
        const path = await import("path");
        const tokenPath = path.join(process.cwd(), "gmail_token.json");
        
        if (!fs.existsSync(tokenPath)) {
            console.warn(`[APPOINTMENT CONFLICT] gmail_token.json not found, skipping email`);
            return;
        }

        const tokens = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
        const { google } = await import("googleapis");

        // OAuth2 인증 설정
        const auth = new google.auth.OAuth2(
            process.env.GMAIL_CLIENT_ID,
            process.env.GMAIL_CLIENT_SECRET
        );
        auth.setCredentials(tokens);

        const gmail = google.gmail({ version: "v1", auth });

        // toBase64Url 함수 (autoAlertScript.js와 동일)
        function toBase64Url(str: string): string {
            return Buffer.from(str)
                .toString("base64")
                .replace(/\+/g, "-")
                .replace(/\//g, "_")
                .replace(/=+$/, "");
        }

        // HTML 메일 생성
        const html = buildAppointmentConflictHtml(conflicts);
        const subject = `[Warning] Appointment Conflict Alert - ${conflicts.length} conflict(s) detected`;

        // Gmail 메일 전송
        const raw = [
            `From: ${process.env.GMAIL_SENDER}`,
            `To: ${process.env.GMAIL_TO_EMAILS || process.env.GMAIL_SENDER}`,
            `Subject: ${subject}`,
            "MIME-Version: 1.0",
            'Content-Type: text/html; charset="UTF-8"',
            "",
            html,
        ].join("\n");

        await gmail.users.messages.send({
            userId: "me",
            requestBody: { raw: toBase64Url(raw) },
        });

        console.log(`[APPOINTMENT CONFLICT] Email sent successfully for ${conflicts.length} conflict(s)`);
    } catch (error) {
        console.error(`[APPOINTMENT CONFLICT] Error sending email:`, error);
    }
}

/**
 * Appointment 충돌 정보를 HTML 형식으로 변환
 */
function buildAppointmentConflictHtml(conflicts: AppointmentConflict[]): string {
    const tr = conflicts
        .map(
            (c) => `<tr>
                <td style="padding:8px;border:1px solid #ddd;">${c.branchName} (${c.branch})</td>
                <td style="padding:8px;border:1px solid #ddd;">${c.date}</td>
                <td style="padding:8px;border:1px solid #ddd;">${c.name}</td>
                <td style="padding:8px;border:1px solid #ddd;">${c.optomId}</td>
                <td style="padding:8px;border:1px solid #ddd;">${c.startTime.split('T')[1].substring(0, 5)} - ${c.endTime.split('T')[1].substring(0, 5)}</td>
                <td style="padding:8px;border:1px solid #ddd;">${c.changeType === 'roster_deleted' ? 'Deleted' : 'Changed'}</td>
                <td style="padding:8px;border:1px solid #ddd;">${c.email}</td>
            </tr>`
        )
        .join("");

    return `
    <div style="font-family:Arial,sans-serif;">
      <p>Hi Team</p>
      <p>AppAdjust transmission was skipped due to existing appointments when roster was changed/deleted.</p>
      <p>Total ${conflicts.length} conflict(s) detected.</p>
      <table style="border-collapse:collapse;margin-top:16px;">
        <thead>
          <tr>
            <th style="padding:8px;border:1px solid #ddd;background:#f5f5f5;">Branch</th>
            <th style="padding:8px;border:1px solid #ddd;background:#f5f5f5;">Date</th>
            <th style="padding:8px;border:1px solid #ddd;background:#f5f5f5;">Name</th>
            <th style="padding:8px;border:1px solid #ddd;background:#f5f5f5;">OptomId</th>
            <th style="padding:8px;border:1px solid #ddd;background:#f5f5f5;">Time</th>
            <th style="padding:8px;border:1px solid #ddd;background:#f5f5f5;">Change Type</th>
            <th style="padding:8px;border:1px solid #ddd;background:#f5f5f5;">Email</th>
          </tr>
        </thead>
        <tbody>${tr}</tbody>
      </table>
      <p style="margin-top:16px;">best regards,<br/>Roster Automation System</p>
    </div>
  `;
}

/**
 * 브랜치 전체 타임슬롯 비교 (EH vs Optomate)
 */
async function compareBranchTotalSlots(db: Database.Database): Promise<SlotMismatch[]> {
    const mismatches: SlotMismatch[] = [];
    
    try {
        const OptomateApiUrl = process.env.OPTOMATE_API_URL;
        if (!OptomateApiUrl) {
            console.warn(`[BRANCH COMPARE] OPTOMATE_API_URL not set, skipping branch comparison`);
            return [];
        }

        // CHANGE_LOG에서 처리된 모든 날짜와 브랜치 추출
        // windowStart와 windowEnd를 사용하여 날짜 범위 파악
        const changeLogs = db.prepare(`
            SELECT DISTINCT 
                windowStart,
                windowEnd,
                json_extract(diffSummary, '$.new.locationId') as locationId,
                json_extract(diffSummary, '$.old.locationId') as oldLocationId
            FROM CHANGE_LOG
            WHERE diffSummary IS NOT NULL
        `).all() as Array<{
            windowStart: string;
            windowEnd: string;
            locationId: number | null;
            oldLocationId: number | null;
        }>;

        // 날짜별, 브랜치별로 그룹화
        const branchDateMap = new Map<string, Set<string>>(); // branchCode -> Set<date>
        
        for (const log of changeLogs) {
            const locationId = log.locationId || log.oldLocationId;
            if (!locationId) continue;

            const branchInfo = OptomMap.find(v => v.LocationId === locationId);
            if (!branchInfo) continue;

            const branchCode = branchInfo.OptCode;
            
            // windowStart와 windowEnd 사이의 모든 날짜 추출
            const startDate = log.windowStart.split('T')[0];
            const endDate = log.windowEnd.split('T')[0];
            
            // 날짜 범위의 모든 날짜 추가
            const start = new Date(startDate);
            const end = new Date(endDate);
            const current = new Date(start);
            
            while (current <= end) {
                const dateStr = current.toISOString().split('T')[0];
                if (!branchDateMap.has(branchCode)) {
                    branchDateMap.set(branchCode, new Set());
                }
                branchDateMap.get(branchCode)!.add(dateStr);
                current.setDate(current.getDate() + 1);
            }
        }

        // 각 브랜치/날짜별로 비교
        for (const [branchCode, dates] of branchDateMap.entries()) {
            for (const date of dates) {
                try {
                    // EH 브랜치 전체 타임슬롯 계산
                    const ehSlots = getEHBranchTotalSlots(db, branchCode, date);
                    
                    // Optomate 브랜치 전체 타임슬롯 가져오기
                    const optomateSlots = await getBranchTotalSlots(OptomateApiUrl, branchCode, date);
                    
                    // 비교 (둘 다 0이 아닌 경우에만 비교)
                    if (ehSlots > 0 || optomateSlots > 0) {
                        if (ehSlots !== optomateSlots) {
                            const branchInfo = OptomMap.find(v => v.OptCode === branchCode);
                            console.warn(
                                `⚠️  [BRANCH SLOT MISMATCH] Branch ${branchCode} (${branchInfo?.StoreName}) on ${date} - ` +
                                `Employment Hero: ${ehSlots} slots, Optomate: ${optomateSlots} slots`
                            );
                            
                            mismatches.push({
                                branch: branchCode,
                                branchName: branchInfo?.StoreName || branchCode,
                                date: date,
                                optomId: 0, // 브랜치 전체는 optomId 없음
                                name: "Branch Total",
                                employmentHeroSlots: ehSlots,
                                optomateSlots: optomateSlots
                            });
                        } else if (ehSlots > 0 && optomateSlots > 0) {
                            console.log(
                                `✅ [BRANCH SLOT MATCH] Branch ${branchCode} on ${date} - ` +
                                `Both have ${ehSlots} slots`
                            );
                        }
                    }
                    
                    // API 부하 방지를 위해 약간 대기
                    await new Promise(resolve => setTimeout(resolve, 200));
                } catch (error) {
                    console.error(`[BRANCH COMPARE] Error comparing branch ${branchCode} on ${date}:`, error);
                }
            }
        }
    } catch (error) {
        console.error(`[BRANCH COMPARE] Error in branch comparison:`, error);
    }

    return mismatches;
}

// processOptomData 함수 추가
async function processOptomData(
    optomData: optomData,
    db: Database.Database,
    OptomateApiUrl: string,
    key: string,
    skipSlotMismatch: boolean
): Promise<{isLocum: boolean, emailData?: PostEmailData | null, isFirst?: boolean, workHistory?: string, optomId?: number, summary?: ProcessedSummary, workFirst?: boolean, slotMismatch?: SlotMismatch, appointmentConflict?: AppointmentConflict}> {
    try {
        let isFirst = false;
        let username = undefined;
        const email = optomData.email;
        const externalId = optomData.employeeId.toString();
        
        // 이름으로 먼저 검색, 실패 시 email로 재검색
        // 검색 실패 시에도 계정 생성을 시도하도록 에러를 catch
        let optomInfo: { id: number; workHistory: string[] } | undefined = undefined;
        try {
            optomInfo = await searchOptomId(optomData.firstName, optomData.lastName, email, externalId);
        } catch (searchError) {
            console.warn(`[PROCESS OPTOM] Search failed for ${optomData.firstName} ${optomData.lastName}, will attempt to create account:`, searchError);
            // 검색 실패해도 계속 진행 (계정 생성 시도)
        }

        let id = optomInfo?.id;

        console.log(`optomId: ${id}`)

        // 검색 후 아이디가 없을 시 생성로직 (검색 실패 또는 결과 없음)
        if(!id) {
            try {
                // id가 없으면 employeeId를 사용 (둘 다 Employment Hero 식별자)
                // id는 roster ID, employeeId는 employee ID
                const externalId = optomData.id ?? optomData.employeeId;
                if (!externalId) {
                    throw new Error(`Cannot create account: both id and employeeId are missing for ${optomData.firstName} ${optomData.lastName}`);
                }
                
                console.log(`[PROCESS OPTOM] Creating new account for ${optomData.firstName} ${optomData.lastName} (externalId: ${externalId})`);
                const info = await createOptomAccount(externalId.toString(), optomData.firstName, optomData.lastName, email);
                id = info.id;
                username = info.username;
                isFirst = true;
                console.log(`[PROCESS OPTOM] Account created successfully: optomId=${id}, username=${username}`);
            } catch (accountError) {
                console.error(`[PROCESS OPTOM] Failed to create account for ${optomData.firstName} ${optomData.lastName}:`, accountError);
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

        const APP_ADJUST = {
            ADJUST_DATE: setTimeZone(`${date}T00:00:00`),
            BRANCH_IDENTIFIER: branchInfo.OptCode,
            ADJUST_START: formatHm(start),
            ADJUST_FINISH: formatHm(optomData.endTime.split("T")[1]),
            INACTIVE: key !== "new"  // "new"가 아니면 INACTIVE=true (old, deleted 모두)
        }
        
        // INACTIVE로 설정하기 전에 appointment 확인 (deleted 또는 old인 경우)
        let appointmentConflict: AppointmentConflict | undefined = undefined;
        if (key !== "new") {
            const hasAppointments = await checkOptometristAppointments(
                OptomateApiUrl,
                id!,
                branchInfo.OptCode,
                date,
                optomData.startTime,
                optomData.endTime
            );
            
            if (hasAppointments) {
                console.error(
                    `❌ [APPOINTMENT CONFLICT] Cannot set AppAdjust to INACTIVE: ` +
                    `Optometrist ${optomData.firstName} ${optomData.lastName} (OptomId: ${id}) ` +
                    `has appointments on ${date} at ${branchInfo.StoreName}. ` +
                    `Skipping AppAdjust update.`
                );
                
                // Appointment 충돌 정보 저장
                appointmentConflict = {
                    branch: branchInfo.OptCode,
                    branchName: branchInfo.StoreName,
                    date: date,
                    optomId: id!,
                    name: `${optomData.firstName} ${optomData.lastName}`,
                    email: optomData.email,
                    startTime: optomData.startTime,
                    endTime: optomData.endTime,
                    changeType: key === "deleted" ? "roster_deleted" : "roster_changed"
                };
                
                // Appointment가 있으면 AppAdjust 전송하지 않고 에러만 반환
                // (slotMismatch는 "new"인 경우에만 체크하므로 여기서는 undefined)
                return {
                    isLocum: optomData.isLocum === 1,
                    emailData: null,
                    isFirst,
                    workHistory: branchInfo.OptCode,
                    optomId: id,
                    summary: undefined,
                    workFirst,
                    slotMismatch: undefined,
                    appointmentConflict
                };
            }
        }
        
        if (key === "deleted") {
            console.log(`[DELETE] Setting AppAdjust to INACTIVE for deleted roster: ${optomData.firstName} ${optomData.lastName} at ${branchInfo.StoreName} on ${date}`);
        } else if (key === "old") {
            console.log(`[CHANGE] Setting AppAdjust to INACTIVE for old roster: ${optomData.firstName} ${optomData.lastName} at ${branchInfo.StoreName} on ${date}`);
        }

        // 로스터를 옵토메이트에 보내기
        const response = await fetch(`${OptomateApiUrl}/Optometrist(${id})/AppAdjust`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "authorization": createSecret("1001_HO_JH", "10011001"),
            },
            body: JSON.stringify({APP_ADJUST}),
        });

        // 응답 상태 확인 (전송 실패해도 슬롯 미스매치는 체크해야 함)
        let appAdjustSuccess = true;
        let responseText = "";
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[APP_ADJUST] API request failed with status: ${response.status} ${response.statusText}`, errorText);
            appAdjustSuccess = false;
            // 에러가 발생해도 슬롯 미스매치는 체크해야 하므로 throw하지 않음
        } else {
            // 응답 텍스트 확인
            responseText = await response.text();
        }

        // APP_ADJUST 전송 후 타임슬롯 비교 (key가 "new"인 경우만, 전송 성공 여부와 관계없이 항상 체크)
        let slotMismatch: SlotMismatch | undefined = undefined;
        if (key === "new" && !skipSlotMismatch) {
            // Optomate에 데이터가 반영될 시간을 주기 위해 약간 대기 (전송 성공한 경우만)
            if (appAdjustSuccess) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            let optomateSlots = 0;
            try {
                optomateSlots = await getOptomateRosterSlots(OptomateApiUrl, id??0, branchInfo.OptCode, date);
                
                // 타임슬롯 비교 (APP_ADJUST 전송 성공 여부와 관계없이 항상 체크)
                if (employmentHeroSlots !== optomateSlots && optomateSlots > 0) {
                    console.warn(
                        `⚠️  [SLOT MISMATCH] Branch ${branchInfo.OptCode} (${branchInfo.StoreName}) on ${date} - ` +
                        `Employment Hero: ${employmentHeroSlots} slots, Optomate: ${optomateSlots} slots ` +
                        `(OptomId: ${id}, Name: ${optomData.firstName} ${optomData.lastName})`
                    );
                    
                    slotMismatch = {
                        branch: branchInfo.OptCode,
                        branchName: branchInfo.StoreName,
                        date: date,
                        optomId: id!,
                        name: `${optomData.firstName} ${optomData.lastName}`,
                        employmentHeroSlots: employmentHeroSlots,
                        optomateSlots: optomateSlots
                    };
                } else if (employmentHeroSlots === optomateSlots && optomateSlots > 0) {
                    console.log(
                        `✅ [SLOT MATCH] Branch ${branchInfo.OptCode} (${branchInfo.StoreName}) on ${date} - ` +
                        `Both have ${employmentHeroSlots} slots (OptomId: ${id})`
                    );
                }
            } catch (slotError) {
                console.warn(`⚠️  [SLOT CHECK] Failed to get Optomate slots: ${slotError instanceof Error ? slotError.message : String(slotError)}`);
            }
        }

        // 전송 실패한 경우 에러 반환 (하지만 slotMismatch는 포함)
        if (!appAdjustSuccess) {
            return {
                isLocum: optomData.isLocum === 1,
                emailData: null,
                isFirst,
                workHistory: branchInfo.OptCode,
                optomId: id,
                summary: undefined,
                workFirst,
                slotMismatch,
                appointmentConflict: undefined
            };
        }

        // 빈 응답인 경우 처리
        if (!responseText.trim()) {
            return { 
                isLocum: optomData.isLocum === 1, 
                emailData: null, 
                isFirst,
                workHistory: branchInfo.OptCode,
                optomId: id,
                summary: undefined,
                workFirst,
                slotMismatch,
                appointmentConflict: undefined
            };
        }

        // 삭제된 경우 이메일 전송하지 않음
        let emailData = null;
        if (key !== "deleted" && optomData.isLocum) {
        // 스토어 템플릿 조회
        const template = db.prepare('SELECT info FROM STORE_INFO WHERE OptCode = ?').get(APP_ADJUST.BRANCH_IDENTIFIER) as {
            info: string
        } | undefined;

            // 이메일 데이터 준비 (Locum인 경우만, 삭제가 아닌 경우만)
            if(workFirst) {
                emailData = {
                    email,
                    lastName: optomData.firstName,
                    storeName: branchInfo.StoreName,
                    rosterDate: date,
                    rosterStart: APP_ADJUST.ADJUST_START,
                    rosterEnd: APP_ADJUST.ADJUST_FINISH,
                    storeTemplet: template?.info ?? "",
                    optomateId: username,
                    optomatePw: username ? '1001' : undefined,
                };
            }
        }

        // 요약 정보 생성
        const summary: ProcessedSummary = {
            name: `${optomData.firstName} ${optomData.lastName}`,
            optomId: id!,
            date: date,
            start: APP_ADJUST.ADJUST_START,
            end: APP_ADJUST.ADJUST_FINISH
        };

        return {
            isLocum: optomData.isLocum === 1,
            emailData,
            isFirst,
            workHistory: APP_ADJUST.BRANCH_IDENTIFIER,
            optomId: id,
            summary,
            workFirst,
            slotMismatch,
            appointmentConflict: undefined
        };
    } catch (error) {
        throw error;
    }
}

// 최적화된 callOptomateAPI 함수
async function callOptomateAPI(
    changeLog: ChangeLog,
    diffSummary: {old?: optomData, new?: optomData},
    skipAlerts: boolean
): Promise<{summaries: ProcessedSummary[], mismatches: SlotMismatch[], conflicts: AppointmentConflict[]}> {
    console.log(`[CHANGE_LOG] Processing ${changeLog.changeType} for rosterId: ${changeLog.rosterId}`);
    console.log(`diffSummary: `, diffSummary)
    
    if(!diffSummary) {
        return { summaries: [], mismatches: [], conflicts: [] };
    }

    const db = getDB();
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
            console.log(`[DELETE] Processing deleted roster for ${diffSummary.old.firstName} ${diffSummary.old.lastName}`);
            try {
                const result = await processOptomData(diffSummary.old, db, OptomateApiUrl, "deleted", skipAlerts);
                if (result.summary) {
                    summaries.push(result.summary);
                }
                if (result.appointmentConflict) {
                    conflicts.push(result.appointmentConflict);
                }
            } catch (error) {
                console.error(`[DELETE] Failed to process deleted roster:`, error);
            }
        }
    } else if (changeLog.changeType === 'roster_changed') {
        // 변경된 경우: old와 new 모두 처리
        const dataToProcess: Array<{data: optomData, key: string}> = [];
        
        // old 데이터 처리 (INACTIVE=true)
        if (diffSummary.old && diffSummary.old.firstName && diffSummary.old.lastName && diffSummary.old.employeeId) {
            dataToProcess.push({ data: diffSummary.old, key: "old" });
        }
        
        // new 데이터 처리 (INACTIVE=false)
        if (diffSummary.new && diffSummary.new.firstName && diffSummary.new.lastName && diffSummary.new.employeeId) {
            dataToProcess.push({ data: diffSummary.new, key: "new" });
        }

        // 순차 처리
    for (let i = 0; i < dataToProcess.length; i++) {
        const {data, key} = dataToProcess[i];

        try {
            const result = await processOptomData(data, db, OptomateApiUrl, key, skipAlerts);
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
                    logLocumEmailSkip(result, `change:${key}`);
                }
            }
                if (result.appointmentConflict) {
                    conflicts.push(result.appointmentConflict);
            }

            // 마지막 요청이 아니면 1초 대기
            if (i < dataToProcess.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
                console.error(`[CHANGE] Failed to process ${key} data:`, error);
            // 에러 발생 시에도 마지막 요청이 아니면 1초 대기
            if (i < dataToProcess.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
    } else if (changeLog.changeType === 'roster_inserted') {
        // 신규 삽입된 경우: new 데이터만 처리
        if (diffSummary.new && diffSummary.new.firstName && diffSummary.new.lastName && diffSummary.new.employeeId) {
            try {
                const result = await processOptomData(diffSummary.new, db, OptomateApiUrl, "new", skipAlerts);
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
                        logLocumEmailSkip(result, "insert:new");
                    }
                }
                if (result.appointmentConflict) {
                    conflicts.push(result.appointmentConflict);
                }
            } catch (error) {
                console.error(`[INSERT] Failed to process new roster:`, error);
            }
        }
    }

    // 이메일 전송 (Locum만)
    if (locumResults.length > 0) {
        const emailPromises = locumResults.map(async (result) => {
            if (result.emailData) {
                await postEmail(result.emailData, result.isFirst ?? false);
                if(result.optomId && result.workHistory) {
                    await addWorkHistory(result.optomId, result.workHistory);
                }
            }
        });

        await Promise.allSettled(emailPromises);
    }

    return { summaries, mismatches, conflicts };
}

/**
 * Employment Hero에서 브랜치 전체의 타임슬롯 총 개수 계산
 * 로컬 DB의 ROSTER 테이블에서 해당 날짜/브랜치의 모든 로스터 합산
 */
function getEHBranchTotalSlots(
    db: Database.Database,
    branchCode: string,
    date: string
): number {
    try {
        const branchInfo = OptomMap.find(v => v.OptCode === branchCode);
        if (!branchInfo) {
            console.warn(`[EH BRANCH SLOTS] Unknown branch code: ${branchCode}`);
            return 0;
        }

        // 날짜 범위 계산 (해당 날짜 00:00:00 ~ 다음 날 00:00:00)
        const startDateTime = `${date}T00:00:00Z`;
        const [year, month, day] = date.split('-').map(Number);
        const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
        const endDateTime = nextDay.toISOString().split('.')[0] + 'Z';

        // 해당 브랜치의 해당 날짜 로스터 조회
        const rosters = db.prepare(`
            SELECT startTime, endTime
            FROM ROSTER
            WHERE locationId = ?
              AND startTime >= ?
              AND startTime < ?
        `).all(branchInfo.LocationId, startDateTime, endDateTime) as Array<{
            startTime: string;
            endTime: string;
        }>;

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

        console.log(`[EH BRANCH SLOTS] Branch ${branchCode} on ${date}: ${totalSlots} total slots`);
        return totalSlots;
    } catch (error) {
        console.warn(`[EH BRANCH SLOTS] Error calculating EH branch total slots: ${error instanceof Error ? error.message : String(error)}`);
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
            console.warn(`[BRANCH SLOTS] API request failed: ${response.status} ${response.statusText}`, errorText);
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
                                console.warn(`[BRANCH SLOTS] Invalid date format: ${timeblock.STARTDATETIME} - ${timeblock.ENDDATETIME}`);
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

        console.log(`[BRANCH SLOTS] Branch ${branchCode} on ${date}: ${totalSlots} total slots`);
        return totalSlots;
    } catch (error) {
        console.warn(`[BRANCH SLOTS] Error getting branch total slots: ${error instanceof Error ? error.message : String(error)}`);
        return 0;
    }
}

/**
 * 특정 optometrist의 특정 날짜/시간대에 appointment가 있는지 확인
 */
async function checkOptometristAppointments(
    OptomateApiUrl: string,
    optomId: number,
    branchCode: string,
    date: string,
    startTime: string,
    endTime: string
): Promise<boolean> {
    try {
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

        // startTime과 endTime을 브랜치 시간대로 변환
        const startDate = new Date(startTime);
        const endDate = new Date(endTime);
        
        // UTC를 브랜치 로컬 시간으로 변환
        const startUtc = startDate.toISOString().replace(/\.\d{3}Z$/, "Z");
        const endUtc = endDate.toISOString().replace(/\.\d{3}Z$/, "Z");

        // Optomate API에서 해당 optomId의 appointment 조회
        const filter = [
            `OPTOMETRIST_ID eq ${optomId}`,
            `BRANCH_IDENTIFIER eq '${branchCode}'`,
            `STARTDATETIME ge ${startUtc}`,
            `STARTDATETIME lt ${endUtc}`,
            `APPOINTMENT_TYPE ne 'NA'`,
            `STATUS ne 6`,  // 취소되지 않은 예약만
            `STATUS ne 7`,
            `STATUS ne 9`,
        ].join(" and ");

        const params = new URLSearchParams({
            $filter: filter,
            $top: "1", // 하나만 있으면 충분
        });

        const url = `${OptomateApiUrl}/Appointments?${params.toString()}`;
        
        const response = await fetch(url, {
            headers: {
                "Content-Type": "application/json",
                "authorization": createSecret("1001_HO_JH", "10011001"),
            },
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            console.error(`[APPOINTMENT CHECK] Failed to check appointments: ${response.status} ${response.statusText}`, errorText);
            // API 호출 실패 시 false 반환 (에러가 발생했으므로 conflict로 처리하지 않음)
            // 실제 appointment가 있는지 확인할 수 없으므로 AppAdjust 전송을 진행
            return false;
        }

        const result = await response.json();
        const appointments = result.value || [];
        
        const hasAppointments = appointments.length > 0;
        
        if (hasAppointments) {
            console.log(`[APPOINTMENT CHECK] Found ${appointments.length} appointment(s) for OptomId ${optomId} on ${date} at ${branchCode}`);
        } else {
            console.log(`[APPOINTMENT CHECK] No appointments found for OptomId ${optomId} on ${date} at ${branchCode}`);
        }
        
        return hasAppointments;
    } catch (error) {
        console.error(`[APPOINTMENT CHECK] Error checking appointments: ${error instanceof Error ? error.message : String(error)}`, error);
        // 에러 발생 시 false 반환 (에러가 발생했으므로 conflict로 처리하지 않음)
        // 실제 appointment가 있는지 확인할 수 없으므로 AppAdjust 전송을 진행
        return false;
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
        console.warn(`[SLOT CHECK] Error getting Optomate slots: ${error instanceof Error ? error.message : String(error)}`);
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
