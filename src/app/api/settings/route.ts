import { NextResponse } from "next/server";
import { getDB, dbGet, dbExecute } from "@/utils/db/db";

interface AppSetting {
    key: string;
    value: string;
}

/** DB에서 단일 설정값 조회 */
export async function getSettingValue(key: string): Promise<string | null> {
    try {
        const db = await getDB();
        const row = await dbGet<AppSetting>(db, "SELECT value FROM app_settings WHERE key = ?", [key]);
        return row?.value || null;
    } catch {
        return null;
    }
}

/** Google Sheet URL에서 ID 추출 (URL 또는 ID 그대로 입력 모두 지원) */
function parseSheetId(input: string): string {
    const trimmed = input.trim();
    // URL 형식: https://docs.google.com/spreadsheets/d/{ID}/edit
    const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    // ID만 입력한 경우 그대로 반환
    return trimmed;
}

/** GET /api/settings — 현재 설정 반환 */
export async function GET() {
    const dbValue = await getSettingValue("google_sheet_id");
    const google_sheet_id = dbValue || process.env.GOOGLE_SHEET_ID || "";

    return NextResponse.json({ google_sheet_id });
}

/** PUT /api/settings — 설정 업데이트 */
export async function PUT(request: Request) {
    try {
        const body = await request.json();
        const raw = body.google_sheet_id as string | undefined;

        if (!raw || typeof raw !== "string" || !raw.trim()) {
            return NextResponse.json({ error: "google_sheet_id가 비어있습니다." }, { status: 400 });
        }

        const sheetId = parseSheetId(raw);
        if (!sheetId) {
            return NextResponse.json({ error: "유효한 Sheet ID 또는 URL을 입력해주세요." }, { status: 400 });
        }

        const db = await getDB();
        await dbExecute(
            db,
            "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
            ["google_sheet_id", sheetId]
        );

        console.log(`[SETTINGS] google_sheet_id updated: ${sheetId}`);
        return NextResponse.json({ ok: true, google_sheet_id: sheetId });
    } catch (e) {
        console.error("[SETTINGS] PUT error:", e);
        return NextResponse.json({ error: "저장 실패" }, { status: 500 });
    }
}
