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

// 처리된 데이터 요약 타입
interface ProcessedSummary {
    name: string;
    optomId: number;
    date: string;
    start: string;
    end: string;
}

// ---- 외부 API 전송 함수 ----
async function sendChangeToOptomateAPI(): Promise<void> {
    const db = getDB();
    const result: ChangeLog[] = db.prepare(`SELECT * FROM CHANGE_LOG`).all() as ChangeLog[];

    if(result.length === 0) {
        return;
    }

    const BATCH_SIZE = 8;
    const batches = chunk(result, BATCH_SIZE);
    const successIds: number[] = [];
    const processedSummaries: ProcessedSummary[] = [];
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        
        // 배치 내부의 change log들을 병렬 처리
        const batchPromises = batch.map(async (changeLog) => {
            try {
                const diffSummary = changeLog.diffSummary ? JSON.parse(changeLog.diffSummary) : null;
                const summaries = await callOptomateAPI(changeLog, diffSummary);
                return { id: changeLog.id, success: true, summaries };
            } catch (error) {
                return { id: changeLog.id, success: false, summaries: [] };
            }
        });

        // 배치 내부의 모든 change log가 병렬로 처리됨 (각 change log 내부는 순차 처리)
        const batchResults = await Promise.allSettled(batchPromises);

        // 성공한 change log ID 수집 및 요약 수집
        batchResults.forEach(result => {
            if (result.status === 'fulfilled' && result.value?.success) {
                successIds.push(result.value.id);
                if (result.value.summaries) {
                    processedSummaries.push(...result.value.summaries);
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
}

// processOptomData 함수 추가
async function processOptomData(
    optomData: optomData, 
    db: Database.Database, 
    OptomateApiUrl: string,
    key: string
): Promise<{isLocum: boolean, emailData?: PostEmailData | null, isFirst?: boolean, workHistory?: string, optomId?: number, summary?: ProcessedSummary, workFirst?:boolean}> {
    try {
        let isFirst = false;
        let username = undefined;
        const optomInfo = await searchOptomId(optomData.firstName, optomData.lastName);

        let id = optomInfo?.id;

        const email = optomData.email;

        // 검색 후 아이디가 없을 시 생성로직
        if(!optomInfo?.id) {
            try {
                const info = await createOptomAccount(optomData.firstName, optomData.lastName, email);
                id = info.id;
                username = info.username;
                isFirst = true;
            } catch (accountError) {
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

        const APP_ADJUST = {
            ADJUST_DATE: setTimeZone(`${date}T00:00:00`),
            BRANCH_IDENTIFIER: branchInfo.OptCode,
            ADJUST_START: formatHm(start),
            ADJUST_FINISH: formatHm(optomData.endTime.split("T")[1]),
            INACTIVE: key !== "new"
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

        // 응답 상태 확인
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API request failed with status: ${response.status} ${response.statusText}`);
        }

        // 응답 텍스트 확인
        const responseText = await response.text();

        // 빈 응답인 경우 처리
        if (!responseText.trim()) {
            return { isLocum: optomData.isLocum === 1, emailData: null, isFirst };
        }

        // 스토어 템플릿 조회
        const template = db.prepare('SELECT info FROM STORE_INFO WHERE OptCode = ?').get(APP_ADJUST.BRANCH_IDENTIFIER) as {
            info: string
        } | undefined;

        // 이메일 데이터 준비 (Locum인 경우만)
        let emailData = null;
        if(optomData.isLocum){


            if(workFirst) {
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
            workFirst
        };
    } catch (error) {
        throw error;
    }
}

// 최적화된 callOptomateAPI 함수
async function callOptomateAPI(changeLog: ChangeLog, diffSummary: {old: optomData, new: optomData}): Promise<ProcessedSummary[]> {
    if(!diffSummary) {
        return [];
    }

    const db = getDB();
    const OptomateApiUrl = process.env.OPTOMATE_API_URL;

    if (!OptomateApiUrl) {
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
        return [];
    }

    // 순차 처리: 하나의 요청이 완전히 완료된 후 1초 대기하고 다음 요청 진행
    const summaries: ProcessedSummary[] = [];
    const locumResults: {emailData?: PostEmailData | null, isFirst?: boolean, optomId?: number, workHistory?: string}[] = [];
    
    for (let i = 0; i < dataToProcess.length; i++) {
        const {data, key} = dataToProcess[i];
        
        try {
            const result = await processOptomData(data, db, OptomateApiUrl, key);
            if (result.summary) {
                summaries.push(result.summary);
                if (result.isLocum && result.emailData && !result.workFirst) {
                    locumResults.push({
                        emailData: result.emailData,
                        isFirst: result.isFirst,
                        optomId: result.optomId,
                        workHistory: result.workHistory
                    });
                }
            }
            
            // 마지막 요청이 아니면 1초 대기
            if (i < dataToProcess.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
            // 에러 발생 시에도 마지막 요청이 아니면 1초 대기
            if (i < dataToProcess.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
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
    
    return summaries;
}

// ---- Export ----
export {
    sendChangeToOptomateAPI,
    callOptomateAPI,
};