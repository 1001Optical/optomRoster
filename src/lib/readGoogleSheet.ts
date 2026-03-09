import { google } from "googleapis";
import * as fs from "fs";
import * as path from "path";
import { getWeekNumber } from "@/utils/time";
import { OptomMap } from "@/data/stores";
import { getSettingValue } from "@/app/api/settings/route";

export interface SheetShift {
    locationId: number;
    storeName: string;       // OptomMap StoreName (숫자 제거 후)
    employeeName: string;    // 시트에 적힌 이름 (그대로)
    date: string;            // YYYY-MM-DD
    startTime: string;       // HH:MM:SS (로컬 호주 시간)
    endTime: string;         // HH:MM:SS (로컬 호주 시간)
}

// "10:00am" / "5:30pm" → "10:00:00" / "17:30:00"
function parseSheetTime(raw: string): string | null {
    const cleaned = raw.trim().toLowerCase();
    const match = cleaned.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
    if (!match) return null;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const meridiem = match[3];

    if (meridiem === "am") {
        if (hours === 12) hours = 0;
    } else {
        if (hours !== 12) hours += 12;
    }

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
}

// "01/03/26" → "2026-03-01"
function parseSheetDate(raw: string): string | null {
    const cleaned = raw.trim();
    const match = cleaned.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
    if (!match) return null;

    const day = match[1];
    const month = match[2];
    const year = `20${match[3]}`;
    return `${year}-${month}-${day}`;
}

// "Chatswood Chase 1" → "Chatswood Chase"
function stripSlotNumber(raw: string): string {
    return raw.replace(/\s+\d+$/, "").trim();
}

// 스토어 이름으로 locationId 조회
function resolveLocationId(rawName: string): { locationId: number; storeName: string } | null {
    const cleaned = stripSlotNumber(rawName);
    const store = OptomMap.find(
        (s) => s.StoreName.toLowerCase() === cleaned.toLowerCase()
    );
    if (!store) return null;
    return { locationId: store.LocationId, storeName: store.StoreName };
}

// Google OAuth2 클라이언트 생성 (Gmail과 동일한 인증 재사용)
function createGoogleAuth() {
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error("Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET");
    }

    const auth = new google.auth.OAuth2(clientId, clientSecret);

    let tokens;
    if (process.env.GMAIL_TOKEN_JSON) {
        try {
            tokens = JSON.parse(process.env.GMAIL_TOKEN_JSON);
        } catch {
            throw new Error("GMAIL_TOKEN_JSON is not valid JSON");
        }
    } else {
        const tokenPath = path.join(process.cwd(), "gmail_token.json");
        if (!fs.existsSync(tokenPath)) {
            throw new Error("gmail_token.json not found");
        }
        tokens = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
    }

    auth.setCredentials(tokens);
    return auth;
}

/**
 * 구글 시트에서 해당 주차 로스터를 읽어 SheetShift[] 반환
 * @param weekNumber 주차 번호 (생략 시 현재 주차 자동 계산)
 */
export async function readGoogleSheet(weekNumber?: number): Promise<SheetShift[]> {
    // DB 설정 우선, 없으면 env var fallback
    const dbSheetId = await getSettingValue("google_sheet_id");
    const sheetId = dbSheetId || process.env.GOOGLE_SHEET_ID;
    if (!sheetId) throw new Error("Google Sheet ID가 설정되지 않았습니다. /sync 페이지에서 설정해주세요.");

    const week = weekNumber ?? getWeekNumber(new Date());
    const sheetName = `NSW - W${week}`;

    const auth = createGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `'${sheetName}'!A:AZ`, // 충분히 넓은 범위
    });

    const rows = res.data.values;
    if (!rows || rows.length < 2) {
        console.warn(`[SHEET] No data found in tab: ${sheetName}`);
        return [];
    }

    // 날짜 행 찾기 (col[0]이 "Date" 또는 " Date"로 시작하는 행)
    const dateRowIdx = rows.findIndex(
        (row) => typeof row[0] === "string" && row[0].trim().toLowerCase() === "date"
    );

    if (dateRowIdx < 0) {
        console.warn(`[SHEET] Date row not found in tab: ${sheetName}`);
        return [];
    }

    const dateRow = rows[dateRowIdx];

    // 각 요일별 날짜 파싱: 컬럼 2,4,6,8,10,12,14 = Sun~Sat
    // 헤더: col0=blank/store, col1=Name/Hours, col2~col15=날짜쌍
    const dayDates: (string | null)[] = [];
    for (let d = 0; d < 7; d++) {
        const colIdx = 2 + d * 2;
        const raw = dateRow[colIdx] ?? "";
        dayDates.push(parseSheetDate(raw));
    }

    const shifts: SheetShift[] = [];

    // 날짜 행 이후의 행 순회 (Name/Hours 쌍으로 처리)
    let i = dateRowIdx + 1;
    while (i < rows.length) {
        const nameRow = rows[i];
        const hoursRow = rows[i + 1];

        // Name 행 여부 체크
        if (!nameRow || nameRow[1]?.toString().trim() !== "Name") {
            i++;
            continue;
        }
        // Hours 행 여부 체크
        if (!hoursRow || hoursRow[1]?.toString().trim() !== "Hours") {
            i++;
            continue;
        }

        const rawStoreName = nameRow[0]?.toString().trim() ?? "";
        if (!rawStoreName) {
            i += 2;
            continue;
        }

        const locationInfo = resolveLocationId(rawStoreName);
        if (!locationInfo) {
            console.warn(`[SHEET] Unknown store name: "${rawStoreName}" — skipping`);
            i += 2;
            continue;
        }

        // 각 요일별 시프트 추출
        for (let d = 0; d < 7; d++) {
            const nameCol = 2 + d * 2;
            const startCol = 2 + d * 2;
            const endCol = 3 + d * 2;

            const employeeName = nameRow[nameCol]?.toString().trim() ?? "";
            const startRaw = hoursRow[startCol]?.toString().trim() ?? "";
            const endRaw = hoursRow[endCol]?.toString().trim() ?? "";
            const date = dayDates[d];

            // 이름 또는 날짜 또는 시간이 없으면 skip
            if (!employeeName || !date || !startRaw || !endRaw) continue;

            // 구글 시트 수식 오류(#REF!, #N/A 등) skip
            if (employeeName.startsWith("#")) {
                console.warn(`[SHEET] Skipping formula error "${employeeName}" at ${locationInfo.storeName} on ${date}`);
                continue;
            }

            const startTime = parseSheetTime(startRaw);
            const endTime = parseSheetTime(endRaw);

            if (!startTime || !endTime) {
                console.warn(
                    `[SHEET] Invalid time for ${employeeName} at ${rawStoreName} on ${date}: ${startRaw}-${endRaw}`
                );
                continue;
            }

            shifts.push({
                locationId: locationInfo.locationId,
                storeName: locationInfo.storeName,
                employeeName,
                date,
                startTime,
                endTime,
            });
        }

        i += 2;
    }

    console.log(`[SHEET] Parsed ${shifts.length} shifts from tab: ${sheetName}`);
    return shifts;
}
