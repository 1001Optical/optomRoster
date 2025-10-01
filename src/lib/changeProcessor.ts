import Database from 'better-sqlite3';
import path from 'node:path';
import {ChangeLog, optomData} from "@/types/types";
import {formatHm, setTimeZone} from "@/utils/time";
import {searchOptomId} from "@/lib/optometrists";
import {createSecret} from "@/utils/crypto";
import {getEmployeeInfo} from "@/lib/getEmployeeInfo";
import {postEmail} from "@/lib/postEmail";
import {StoreMap} from "@/data/stores";
import {createOptomAccount} from "@/lib/createOptomAccount";

// ---- DB ----
const db = new Database(path.join(process.cwd(), 'roster.sqlite'));
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// ---- 외부 API 전송 함수 ----
async function sendChangeToOptomateAPI(): Promise<void> {
    console.log("=== Starting change processing ===");
    
    try {
        const result: ChangeLog[] = db.prepare(`SELECT * FROM CHANGE_LOG`).all() as ChangeLog[];
        console.log(`Found ${result.length} change log entries to process`);
        
        if (result.length > 0) {
            let successCount = 0;
            let errorCount = 0;
            
            for (const changeLog of result) {
                console.log(`Processing change log ID: ${changeLog.id}, Type: ${changeLog.changeType}`);
                
                try {
                    // diffSummary 파싱
                    let diffSummary = null;
                    if (changeLog.diffSummary) {
                        try {
                            diffSummary = JSON.parse(changeLog.diffSummary);
                            console.log(`Parsed diffSummary for ID ${changeLog.id}:`, Object.keys(diffSummary || {}));
                        } catch (parseError) {
                            console.error(`Failed to parse diffSummary for ID ${changeLog.id}:`, parseError);
                            throw new Error(`Invalid diffSummary JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
                        }
                    } else {
                        console.warn(`No diffSummary found for change log ID ${changeLog.id}`);
                    }
                    
                    await callOptomateAPI(changeLog, diffSummary);
                    
                    // 처리 완료 후 삭제
                    const deleteResult = db.prepare(`DELETE FROM CHANGE_LOG WHERE id = ?`).run(changeLog.id);
                    console.log(`Successfully processed and deleted change log ID: ${changeLog.id} (${deleteResult.changes} rows affected)`);
                    successCount++;
                    
                } catch (error) {
                    console.error(`Error processing change log ID ${changeLog.id}:`, error);
                    errorCount++;
                    // 개별 실패는 전체 프로세스를 중단시키지 않음
                }
            }
            
            console.log(`=== Change processing completed ===`);
            console.log(`Success: ${successCount}, Errors: ${errorCount}, Total: ${result.length}`);
        } else {
            console.log("No changes found to process");
        }
    } catch (error) {
        console.error("Fatal error in sendChangeToOptomateAPI:", error);
        throw error;
    }
}

async function callOptomateAPI(changeLog: ChangeLog, diffSummary: {old: optomData, new: optomData}): Promise<void> {
    console.log(`=== Processing change log ${changeLog.id} ===`);
    
    const OptomateApiUrl = process.env.OPTOMATE_API_URL;

    if (!OptomateApiUrl) {
        console.error("OPTOMATE_API_URL environment variable is not set");
        throw new Error("OPTOMATE_API_URL environment variable is not set");
    }

    if (!diffSummary) {
        console.warn(`No diffSummary provided for change log ${changeLog.id}, skipping API call`);
        return;
    }

    console.log(`Processing ${Object.keys(diffSummary).length} diff entries for change log ${changeLog.id}`);

    for (const key of Object.keys(diffSummary)) {
        const optomData = diffSummary[key as "new" | "old"]
        console.log(`Processing ${key} data for employee: ${optomData?.employeeName} (ID: ${optomData?.employeeId})`);
        
        if(optomData?.employeeName && optomData?.employeeId) {
            try {
                let isFirst = false;
                let username = undefined;
                let id =  await searchOptomId(optomData.employeeName).then(id => id)
                
                console.log(`Fetching employment info for employee ID: ${optomData.employeeId}`);
                const employmentInfo = await getEmployeeInfo(optomData.employeeId);
                const email = employmentInfo?.emailAddress;
                
                if (!email) {
                    console.warn(`No email found for employee ID: ${optomData.employeeId}`);
                }

                if(!id) {
                    console.log(`Creating new Optomate account for: ${optomData.employeeName} (${email})`);
                    try {
                        const info = await createOptomAccount(optomData.employeeName, email);
                        id = info.id;
                        username = info.username;
                        isFirst = true;
                        console.log(`Account created - ID: ${id}, Username: ${username}, isFirst: ${isFirst}`);
                    } catch (accountError) {
                        console.error(`Failed to create Optomate account for ${optomData.employeeName}:`, accountError);
                        throw accountError;
                    }
                } else {
                    console.log(`Using existing Optomate account - ID: ${id}`);
                }

                // 시간 파싱 및 검증
                if (!optomData.startTime || !optomData.endTime) {
                    console.error(`Invalid time data for employee ${optomData.employeeName}:`, {
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

                const branchInfo = StoreMap.find(v => v.LocationId === optomData.locationId);
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

                console.log(`Sending API request to Optomate for employee ${optomData.employeeName}:`);
                console.log(`- API URL: ${OptomateApiUrl}/Optometrists(${id})/AppAdjust`);
                console.log(`- Branch: ${branchInfo.StoreName} (${APP_ADJUST.BRANCH_IDENTIFIER})`);
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
                    return;
                }

                // JSON 파싱 시도
                let result;
                try {
                    result = JSON.parse(responseText);
                    console.log("Successfully parsed JSON response from Optomate API");
                } catch (parseError) {
                    console.error("Failed to parse JSON response:", responseText);
                    const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
                    throw new Error(`Invalid JSON response: ${errorMessage}`);
                }

                // 스토어 템플릿 조회
                const template = db.prepare('SELECT info FROM STORE_INFO WHERE OptCode = ?').get(APP_ADJUST.BRANCH_IDENTIFIER) as {
                    info: string
                } | undefined;

                if (!template) {
                    console.warn(`No store template found for OptCode: ${APP_ADJUST.BRANCH_IDENTIFIER}`);
                }

                // 이메일 전송 (Locum인 경우만)
                if(optomData.isLocum){
                    console.log(`Sending email to locum: ${email} for ${optomData.employeeName}`);
                    try {
                        const emailData = {
                            email,
                            lastName: optomData.employeeName.split(" ")[1] || optomData.employeeName,
                            storeName: branchInfo.StoreName,
                            rosterDate: date,
                            rosterStart: APP_ADJUST.ADJUST_START,
                            rosterEnd: APP_ADJUST.ADJUST_FINISH,
                            storeTemplate: template?.info ?? "",
                            optomateId: username,
                            optomatePw: username ? '1001' : undefined,
                        };
                        
                        console.log(`Email data prepared:`, {
                            email: emailData.email,
                            lastName: emailData.lastName,
                            storeName: emailData.storeName,
                            rosterDate: emailData.rosterDate,
                            isFirst
                        });
                        
                        await postEmail(emailData, isFirst);
                        console.log(`Email sent successfully to ${email}`);
                    } catch (emailError) {
                        console.error(`Failed to send email to ${email}:`, emailError);
                        // 이메일 전송 실패는 전체 프로세스를 중단시키지 않음
                    }
                } else {
                    console.log(`Employee ${optomData.employeeName} is not a locum, skipping email`);
                }
                
                console.log(`Successfully processed ${key} data for employee ${optomData.employeeName}`);
                
            } catch (error) {
                console.error(`Error processing ${key} data for employee ${optomData.employeeName}:`, error);
                throw error; // 에러를 다시 던져서 상위에서 처리하도록 함
            }
        } else {
            console.warn(`Skipping ${key} data - missing employeeName or employeeId:`, {
                employeeName: optomData?.employeeName,
                employeeId: optomData?.employeeId
            });
        }
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
