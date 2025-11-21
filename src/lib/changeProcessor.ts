import {getDB} from "@/utils/db/db";
import {ChangeLog, optomData} from "@/types/types";
import {formatHm, setTimeZone} from "@/utils/time";
import {addWorkHistory, searchOptomId} from "@/lib/optometrists";
import {postEmail, PostEmailData} from "@/lib/postEmail";
import {OptomMap} from "@/data/stores";
import {createOptomAccount} from "@/lib/createOptomAccount";
import {chunk} from "@/lib/utils";
import {createSecret} from "@/utils/crypto";
import type Database from "better-sqlite3";

// ---- 외부 API 전송 함수 ----
async function sendChangeToOptomateAPI(): Promise<void> {
    console.log("\n" + "=".repeat(80));
    console.log("🔄 [CHANGE PROCESSOR] Starting change processing");
    console.log("=".repeat(80));

    const db = getDB();
    const result: ChangeLog[] = db.prepare(`SELECT * FROM CHANGE_LOG`).all() as ChangeLog[];

    if(result.length === 0) {
        console.log("ℹ️  [CHANGE PROCESSOR] No change logs to process");
        return;
    }

    console.log(`📊 [CHANGE PROCESSOR] Found ${result.length} change log(s) to process`);

    const BATCH_SIZE = 10;
    const batches = chunk(result, BATCH_SIZE)

    // 모든 change log를 순차 처리 (배치 개념 제거)
    const successIds: number[] = [];
    
    for (let i = 0; i < result.length; i++) {
        const changeLog = result[i];
        console.log(`\n📦 [CHANGE PROCESSOR] Processing change log ${i + 1}/${result.length} (ID: ${changeLog.id})`);
        
        try {
            const diffSummary = changeLog.diffSummary ? JSON.parse(changeLog.diffSummary) : null;
            await callOptomateAPI(changeLog, diffSummary);
            successIds.push(changeLog.id);
            console.log(`✅ [CHANGE PROCESSOR] Successfully processed change log ${changeLog.id}`);
            
            // 마지막 change log가 아니면 1초 대기
            if (i < result.length - 1) {
                console.log(`⏳ Waiting 1 second before next change log...\n`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
            console.error(`❌ [CHANGE PROCESSOR] Error processing change log ID ${changeLog.id}:`, error);
            
            // 에러 발생 시에도 마지막 change log가 아니면 1초 대기
            if (i < result.length - 1) {
                console.log(`⏳ Waiting 1 second before next change log...\n`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    if(successIds.length > 0){
        const placeholders = successIds.map(() => "?").join(',');
        db.prepare(`DELETE FROM CHANGE_LOG WHERE id IN (${placeholders})`).run(...successIds);
        console.log(`\n✅ [CHANGE PROCESSOR] Deleted ${successIds.length} processed change log(s)`);
    }
    
    console.log("\n" + "=".repeat(80));
    console.log("✅ [CHANGE PROCESSOR] Change processing completed");
    console.log("=".repeat(80) + "\n");
}

// processOptomData 함수 추가
async function processOptomData(
    optomData: optomData, 
    db: Database.Database, 
    OptomateApiUrl: string,
    key: string
): Promise<{isLocum: boolean, emailData?: PostEmailData | null, isFirst?: boolean, workHistory?: string, optomId?: number}> {
    try {
        let isFirst = false;
        let username = undefined;
        const optomInfo = await searchOptomId(optomData.firstName, optomData.lastName);

        let id = optomInfo?.id;

        const email = optomData.email;

        // 검색 후 아이디가 없을 시 생성로직
        if(!optomInfo) {
            try {
                console.log(`  🔍 [OPTOMATE] Account not found, creating new account for ${optomData.firstName} ${optomData.lastName}`);
                const info = await createOptomAccount(`${optomData.firstName} ${optomData.lastName}`, email);
                id = info.id;
                username = info.username;
                isFirst = true;
                console.log(`  ✅ [OPTOMATE] Account created - ID: ${id}, Username: ${username}, isFirst: ${isFirst}`);
            } catch (accountError) {
                console.error(`  ❌ [OPTOMATE] Failed to create account for ${optomData.firstName} ${optomData.lastName}:`, accountError);
                throw accountError;
            }
        } else {
            console.log(`  ℹ️  [OPTOMATE] Using existing account - ID: ${id}`);
        }

        // 시간 파싱 및 검증
        if (!optomData.startTime || !optomData.endTime) {
            console.error(`Invalid time data for employee ${optomData.firstName} ${optomData.lastName}:`, {
                startTime: optomData.startTime,
                endTime: optomData.endTime
            });
            throw new Error("Missing startTime or endTime");
        }

        const [date, start] = optomData.startTime.split("T");
        if (!date || !start) {
            console.error(`Failed to parse startTime: ${optomData.startTime}`);
            throw new Error("Invalid startTime format");
        }

        const branchInfo = OptomMap.find(v => v.LocationId === optomData.locationId);
        if (!branchInfo) {
            console.error(`Branch not found for locationId: ${optomData.locationId}`);
            throw new Error(`Unknown locationId: ${optomData.locationId}`);
        }

        const APP_ADJUST = {
            ADJUST_DATE: setTimeZone(`${date}T00:00:00`),
            BRANCH_IDENTIFIER: branchInfo.OptCode,
            ADJUST_START: formatHm(start),
            ADJUST_FINISH: formatHm(optomData.endTime.split("T")[1]),
            INACTIVE: key !== "new"
        }

        // 요청 추적을 위한 고유 ID 생성
        const requestId = `${optomData.firstName}_${optomData.lastName}_${date}_${APP_ADJUST.BRANCH_IDENTIFIER}_${Date.now()}`;

        console.log(`\n  📤 [OPTOMATE API] Sending request [${requestId}]`);
        console.log(`     └─ Employee: ${optomData.firstName} ${optomData.lastName}`);
        console.log(`     └─ URL: ${OptomateApiUrl}/Optometrist(${id})/AppAdjust`);
        console.log(`     └─ Branch: ${branchInfo.StoreName} (${APP_ADJUST.BRANCH_IDENTIFIER})`);
        console.log(`     └─ Date: ${APP_ADJUST.ADJUST_DATE}`);
        console.log(`     └─ Schedule: ${APP_ADJUST.ADJUST_START} - ${APP_ADJUST.ADJUST_FINISH}`);
        console.log(`     └─ Inactive: ${APP_ADJUST.INACTIVE}`);
        console.log(`     └─ Request Body:`, JSON.stringify({APP_ADJUST}, null, 2));

        const requestStartTime = Date.now();
        
        // 로스터를 옵토메이트에 보내기
        const response = await fetch(`${OptomateApiUrl}/Optometrist(${id})/AppAdjust`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "authorization": createSecret("1001_HO_JH", "10011001"),
            },
            body: JSON.stringify({APP_ADJUST}),
        });

        const requestDuration = Date.now() - requestStartTime;
        console.log(`  📥 [OPTOMATE API] Response received [${requestId}] (${requestDuration}ms)`);
        console.log(`     └─ Status: ${response.status} ${response.statusText}`);

        // 응답 헤더 로깅
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
        });
        console.log(`     └─ Response Headers:`, JSON.stringify(responseHeaders, null, 2));

        // 응답 상태 확인
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`  ❌ [OPTOMATE API] Request failed`);
            console.error(`     └─ Status: ${response.status} ${response.statusText}`);
            console.error(`     └─ Response Body:`, errorText);
            try {
                const errorJson = JSON.parse(errorText);
                console.error(`     └─ Parsed Error:`, JSON.stringify(errorJson, null, 2));
            } catch {
                // JSON 파싱 실패 시 원본 텍스트만 사용
            }
            throw new Error(`API request failed with status: ${response.status} ${response.statusText}`);
        }

        // 응답 텍스트 확인
        const responseText = await response.text();
        console.log(`     └─ Response Length: ${responseText.length} characters`);

        // 응답 본문 로깅
        if (responseText.trim()) {
            try {
                const responseJson = JSON.parse(responseText);
                console.log(`     └─ Response Body (JSON):`, JSON.stringify(responseJson, null, 2));
                if (responseJson.ID) {
                    console.log(`     └─ ✅ Successfully created/updated with ID: ${responseJson.ID}`);
                }
            } catch {
                // JSON이 아닌 경우 원본 텍스트 출력
                console.log(`     └─ Response Body (Text):`, responseText);
            }
        } else {
            console.log(`     └─ Response Body: (empty)`);
        }
        
        console.log(`  ✅ [OPTOMATE API] Request completed [${requestId}]\n`);

        // 빈 응답인 경우 처리
        if (!responseText.trim()) {
            console.log(`  ⚠️  [OPTOMATE API] Empty response received - continuing without parsing`);
            return { isLocum: optomData.isLocum === 1, emailData: null, isFirst };
        }

        // 스토어 템플릿 조회
        const template = db.prepare('SELECT info FROM STORE_INFO WHERE OptCode = ?').get(APP_ADJUST.BRANCH_IDENTIFIER) as {
            info: string
        } | undefined;

        // 이메일 데이터 준비 (Locum인 경우만)
        let emailData = null;
        if(optomData.isLocum){
            const workFirst = !optomInfo || !optomInfo.workHistory || !optomInfo.workHistory.find(v => v === APP_ADJUST.BRANCH_IDENTIFIER)

            if(workFirst) {
                console.log(`  📧 [EMAIL] Preparing email for locum: ${email}`);
                emailData = {
                    email,
                    lastName: optomData.lastName || optomData.firstName,
                    storeName: branchInfo.StoreName,
                    rosterDate: date,
                    rosterStart: APP_ADJUST.ADJUST_START,
                    rosterEnd: APP_ADJUST.ADJUST_FINISH,
                    storeTemplet: template?.info ?? "",
                    optomateId: username,
                    optomatePw: username ? '1001' : undefined,
                };
                console.log(`     └─ Email Data:`, JSON.stringify(emailData, null, 2));
            }
        } else {
            console.log(`  ℹ️  [EMAIL] Employee is not a locum, skipping email`);
        }
        
        console.log(`  ✅ [OPTOMATE] Successfully processed ${key} data for ${optomData.firstName} ${optomData.lastName}\n`);
        
        return {
            isLocum: optomData.isLocum === 1,
            emailData,
            isFirst,
            workHistory: APP_ADJUST.BRANCH_IDENTIFIER,
            optomId: id
        };
    } catch (error) {
        console.error(`Error processing ${optomData.firstName} ${optomData.lastName}:`, error);
        throw error;
    }
}

// 최적화된 callOptomateAPI 함수
async function callOptomateAPI(changeLog: ChangeLog, diffSummary: {old: optomData, new: optomData}): Promise<void> {
    console.log(`\n${"-".repeat(80)}`);
    console.log(`📋 [CHANGE LOG ${changeLog.id}] Processing change log`);
    console.log(`   └─ Change Type: ${changeLog.changeType}`);
    console.log(`   └─ Detected: ${changeLog.whenDetected}`);
    console.log(`   └─ Window: ${changeLog.windowStart} to ${changeLog.windowEnd}`);
    console.log("-".repeat(80));
    
    if(!diffSummary) {
        console.log(`⚠️  [CHANGE LOG ${changeLog.id}] No diff summary available, skipping`);
        return;
    }

    const db = getDB();
    const OptomateApiUrl = process.env.OPTOMATE_API_URL;

    if (!OptomateApiUrl) {
        console.error(`❌ [CHANGE LOG ${changeLog.id}] OPTOMATE_API_URL environment variable is not set`);
        throw new Error("OPTOMATE_API_URL environment variable is not set");
    }

    // 처리할 데이터 준비
    const dataToProcess = Object.keys(diffSummary)
        .filter(key => key !== "old")
        .map(key => ({
            data: diffSummary[key as "new" | "old"],
            key
        }))
        .filter(item => item.data?.firstName && item.data?.lastName && item.data?.employeeId);

    if(dataToProcess.length === 0) {
        console.log(`⚠️  [CHANGE LOG ${changeLog.id}] No valid data to process`);
        return;
    }

    console.log(`📊 [CHANGE LOG ${changeLog.id}] Processing ${dataToProcess.length} data item(s)`);
    console.log(`   └─ Processing sequentially with 1 second delay between requests\n`);

    // 순차 처리: 하나의 요청이 완전히 완료된 후 1초 대기하고 다음 요청 진행
    const results: PromiseSettledResult<{isLocum: boolean, emailData?: PostEmailData | null, isFirst?: boolean, workHistory?: string, optomId?: number} | null>[] = [];
    
    for (let i = 0; i < dataToProcess.length; i++) {
        const {data, key} = dataToProcess[i];
        console.log(`   [${i + 1}/${dataToProcess.length}] Processing ${data.firstName} ${data.lastName}...`);
        
        try {
            const result = await processOptomData(data, db, OptomateApiUrl, key);
            results.push({ status: 'fulfilled', value: result });
            console.log(`   ✅ [${i + 1}/${dataToProcess.length}] Completed ${data.firstName} ${data.lastName}`);
            
            // 마지막 요청이 아니면 1초 대기
            if (i < dataToProcess.length - 1) {
                console.log(`   ⏳ Waiting 1 second before next request...\n`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                console.log();
            }
        } catch (error) {
            console.error(`   ❌ [${i + 1}/${dataToProcess.length}] Error processing ${data.firstName} ${data.lastName}:`, error);
            results.push({ status: 'fulfilled', value: null });
            
            // 에러 발생 시에도 마지막 요청이 아니면 1초 대기
            if (i < dataToProcess.length - 1) {
                console.log(`   ⏳ Waiting 1 second before next request...\n`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                console.log();
            }
        }
    }
    
    console.log(`📊 [CHANGE LOG ${changeLog.id}] All ${dataToProcess.length} request(s) completed\n`);

    // 이메일 전송 (Locum만)
    const locumResults = results
        .filter((result): result is PromiseFulfilledResult<{ isLocum: boolean; emailData?: PostEmailData; isFirst?: boolean, optomId?: number, workHistory?: string } | null> =>
            result.status === 'fulfilled' && !!result.value && !!result.value.isLocum
        )
        .map(result => result.value!);

    if (locumResults.length > 0) {
        console.log(`\n📧 [CHANGE LOG ${changeLog.id}] Sending ${locumResults.length} locum email(s)`);
        const emailPromises = locumResults.map(async (result) => {
            await postEmail(result.emailData, result.isFirst ?? false);
            if(result.optomId && result.workHistory) {
                await addWorkHistory(result.optomId, result.workHistory);
            }
        });
        
        await Promise.allSettled(emailPromises);
        console.log(`✅ [CHANGE LOG ${changeLog.id}] All locum emails sent successfully`);
    }

    console.log(`\n✅ [CHANGE LOG ${changeLog.id}] Completed processing`);
    console.log("-".repeat(80) + "\n");
}

// ---- Export ----
export {
    sendChangeToOptomateAPI,
    callOptomateAPI,
};