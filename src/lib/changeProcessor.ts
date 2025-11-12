import {getDB} from "@/utils/db/db";
import {ChangeLog, optomData} from "@/types/types";
import {formatHm, setTimeZone} from "@/utils/time";
import {searchOptomId} from "@/lib/optometrists";
import {postEmail, PostEmailData} from "@/lib/postEmail";
import {OptomMap} from "@/data/stores";
import {createOptomAccount} from "@/lib/createOptomAccount";
import {chunk} from "@/lib/utils";
import {createSecret} from "@/utils/crypto";
import Database from "better-sqlite3";

// ---- 외부 API 전송 함수 ----
async function sendChangeToOptomateAPI(): Promise<void> {
    console.log("=== Starting change processing ===");

    const db = getDB();
    const result: ChangeLog[] = db.prepare(`SELECT * FROM CHANGE_LOG`).all() as ChangeLog[];

    if(result.length === 0) return;

    const BATCH_SIZE = 10;
    const batches = chunk(result, BATCH_SIZE)

    for (const batch of batches) {
        const batchPromises = batch.map(async (changeLog) => {
            try {
                const diffSummary = changeLog.diffSummary ? JSON.parse(changeLog.diffSummary) : null;
                await callOptomateAPI(changeLog, diffSummary);
                return { id: changeLog.id, success: true };
            } catch (error) {
                console.error(`Error processing change log ID ${changeLog.id}:`, error);
                return { id: changeLog.id, success: false };
            }
        })

        const batchResults = await Promise.allSettled(batchPromises);

        const successIds = batchResults
            .filter(result => result.status === 'fulfilled' && result.value?.success)
            .map(result => {
                if(result.status === 'fulfilled') {
                    return result?.value?.id
                }
            })

        if(successIds.length > 0){
            const placeholders = successIds.map(() => "?").join(',');
            db.prepare(`DELETE FROM CHANGE_LOG WHERE id IN (${placeholders})`).run(...successIds);
        }
    }
}

// processOptomData 함수 추가
async function processOptomData(
    optomData: optomData, 
    db: Database.Database, 
    OptomateApiUrl: string,
    key: string
): Promise<{isLocum: boolean, emailData?: PostEmailData | null, isFirst?: boolean}> {
    try {
        let isFirst = false;
        let username = undefined;
        let id = await searchOptomId(optomData.firstName, optomData.lastName);

        const email = optomData.email;

        // 검색 후 아이디가 없을 시 생성로직
        if(!id) {
            try {
                const info = await createOptomAccount(`${optomData.firstName} ${optomData.lastName}`, email);
                id = info.id;
                username = info.username;
                isFirst = true;
                console.log(`Account created - ID: ${id}, Username: ${username}, isFirst: ${isFirst}`);
            } catch (accountError) {
                console.error(`Failed to create Optomate account for ${optomData.firstName} ${optomData.lastName}:`, accountError);
                throw accountError;
            }
        } else {
            console.log(`Using existing Optomate account - ID: ${id}`);
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

        console.log(`Sending API request to Optomate for employee ${optomData.firstName} ${optomData.lastName}:`);
        console.log(`- API URL: ${OptomateApiUrl}/Optometrists(${id})/AppAdjust`);
        console.log(`- Branch: ${branchInfo.StoreName} (${APP_ADJUST.BRANCH_IDENTIFIER})`);
        console.log(`- Date: ${APP_ADJUST.ADJUST_DATE}`);
        console.log(`- Schedule: ${APP_ADJUST.ADJUST_START} - ${APP_ADJUST.ADJUST_FINISH}`);
        console.log(`- Inactive: ${APP_ADJUST.INACTIVE}`);

        // 로스터를 옵토메이트에 보내기
        const response = await fetch(`${OptomateApiUrl}/Optometrist(${id})/AppAdjust`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "authorization": createSecret("1001_HO_JH", "10011001"),
            },
            body: JSON.stringify({APP_ADJUST}),
        });

        console.log(`API response status: ${response.status} ${response.statusText}`);

        // 응답 상태 확인
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`API request failed. Status: ${response.status}, Response: ${errorText}`);
            throw new Error(`API request failed with status: ${response.status} ${response.statusText}`);
        }

        // 응답 텍스트 확인
        const responseText = await response.text();
        console.log(`API response length: ${responseText.length} characters`);

        // 빈 응답인 경우 처리
        if (!responseText.trim()) {
            console.log("Empty response received from API - continuing without parsing");
            return { isLocum: optomData.isLocum === 1, emailData: null, isFirst };
        }

        // 스토어 템플릿 조회
        const template = db.prepare('SELECT info FROM STORE_INFO WHERE OptCode = ?').get(APP_ADJUST.BRANCH_IDENTIFIER) as {
            info: string
        } | undefined;

        // 이메일 데이터 준비 (Locum인 경우만)
        let emailData = null;
        if(optomData.isLocum){
            console.log(`Preparing email for locum: ${email} for ${optomData.firstName} ${optomData.lastName}`);
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
        } else {
            console.log(`Employee ${optomData.firstName} ${optomData.lastName} is not a locum, skipping email`);
        }
        
        console.log(`Successfully processed ${key} data for employee ${optomData.firstName} ${optomData.lastName}`);
        
        return {
            isLocum: optomData.isLocum === 1,
            emailData,
            isFirst
        };
    } catch (error) {
        console.error(`Error processing ${optomData.firstName} ${optomData.lastName}:`, error);
        throw error;
    }
}

// 최적화된 callOptomateAPI 함수
async function callOptomateAPI(changeLog: ChangeLog, diffSummary: {old: optomData, new: optomData}): Promise<void> {
    console.log(`=== Processing change log ${changeLog.id} ===`);
    if(!diffSummary) return;

    const db = getDB();
    const OptomateApiUrl = process.env.OPTOMATE_API_URL;

    if (!OptomateApiUrl) {
        console.error("OPTOMATE_API_URL environment variable is not set");
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

    if(dataToProcess.length === 0) return;

    // 병렬 처리
    const promises = dataToProcess.map(async ({data, key}) => {
        try {
            return await processOptomData(data, db, OptomateApiUrl, key);
        } catch (error) {
            console.error(`Error processing ${data.firstName} ${data.lastName}:`, error);
            return null;
        }
    });

    const results = await Promise.allSettled(promises);

    // 이메일 전송 (Locum만)
    const locumResults = results
        .filter((result): result is PromiseFulfilledResult<{ isLocum: boolean; emailData?: PostEmailData; isFirst?: boolean } | null> =>
            result.status === 'fulfilled' && !!result.value && !!result.value.isLocum
        )
        .map(result => result.value!);

    if (locumResults.length > 0) {
        console.log(`Sending ${locumResults.length} locum emails`);
        const emailPromises = locumResults.map(result => 
            postEmail(result.emailData, result.isFirst ?? false)
        );
        
        await Promise.allSettled(emailPromises);
        console.log(`All locum emails sent successfully`);
    }

    console.log(`=== Completed processing change log ${changeLog.id} ===`);
}

// ---- 통계 조회 함수 ----
function getChangeLogStats(): {
    total: number;
    byType?: { [key: string]: number };
} {
    try {
        console.log("Fetching change log statistics...");
        
        const db = getDB();
        const total = db.prepare(`SELECT COUNT(*) as count FROM CHANGE_LOG`).get() as { count: number };
        
        // 타입별 통계도 추가
        const byType = db.prepare(`
            SELECT changeType, COUNT(*) as count 
            FROM CHANGE_LOG 
            GROUP BY changeType
        `).all() as { changeType: string; count: number }[];
        
        const typeStats = byType.reduce((acc, row) => {
            acc[row.changeType] = row.count;
            return acc;
        }, {} as { [key: string]: number });
        
        console.log(`Change log stats - Total: ${total.count}, By type:`, typeStats);
        
        return {
            total: total.count,
            byType: typeStats
        };
    } catch (error) {
        console.error("Error fetching change log statistics:", error);
        return {
            total: 0
        };
    }
}

// ---- Export ----
export {
    sendChangeToOptomateAPI,
    callOptomateAPI,
    getChangeLogStats
};