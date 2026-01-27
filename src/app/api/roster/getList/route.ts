import { NextResponse } from "next/server";
import {I1001Response, I1001RosterData} from "@/types/api_response";
import {getDB} from "@/utils/db/db";

export async function GET(request: Request): Promise<NextResponse<I1001Response<I1001RosterData[]>>>  {
    try {
        const db = getDB();

        // 쿼리 파라미터 읽기
        const { searchParams } = new URL(request.url);
        const fromDate = searchParams.get("from");
        const toDate = searchParams.get("to");
        const locationId = searchParams.get("locationId");
        const locationIdsStr = searchParams.get("locationIds"); // 쉼표로 구분된 ID 목록

        if(!fromDate || !toDate) {
            console.error("Missing required parameters: from and to dates");
            return NextResponse.json(
                {
                    message: "Missing required parameters: from and to dates",
                },
                { status: 400 }
            );
        }

        // 날짜 파라미터에서 날짜 부분만 추출 (YYYY-MM-DD 형식으로 정규화)
        const extractDateOnly = (dateStr: string): string => {
            // ISO 형식 (2024-12-06T23:59:59Z) 또는 날짜만 (2024-12-06) 모두 처리
            const dateMatch = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
            if (!dateMatch) {
                throw new Error(`Invalid date format: ${dateStr}`);
            }
            return dateMatch[1];
        };

        const fromDateOnly = extractDateOnly(fromDate);
        const toDateOnly = extractDateOnly(toDate);

        // 날짜 형식 검증
        const fromDateObj = new Date(fromDateOnly);
        const toDateObj = new Date(toDateOnly);

        if (isNaN(fromDateObj.getTime()) || isNaN(toDateObj.getTime())) {
            console.error("Invalid date format provided");
            return NextResponse.json(
                {
                    message: "Invalid date format provided",
                },
                { status: 400 }
            );
        }

        // 토요일까지 포함하기 위해 다음 날 00:00:00을 사용 (exclusive end)
        // 시간대 변환 없이 날짜 문자열을 직접 조작하여 다음 날 계산
        const [year, month, day] = toDateOnly.split('-').map(Number);
        const toDateNextDayObj = new Date(Date.UTC(year, month - 1, day + 1));
        const toDateNextDayStr = toDateNextDayObj.toISOString().split('T')[0];

        // locationId 또는 locationIds 처리
        let locationIds: number[] = [];
        if (locationId) {
            locationIds.push(parseInt(locationId));
        } else if (locationIdsStr) {
            locationIds = locationIdsStr.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        }

        let query = `SELECT id,
                            employeeId,
                            firstName,
                            lastName,
                            locationId,
                            locationName,
                            startTime,
                            endTime,
                            email,
                            date(startTime)                            AS day,
                            CAST(strftime('%w', startTime) AS INTEGER) AS dow,
                            substr(startTime, 12, 5)                   AS hhmmStart,
                            substr(endTime, 12, 5)                     AS hhmmEnd
                     FROM ROSTER
                     WHERE startTime >= $from
                       AND endTime < $to`;

        const params: any = {
            from: `${fromDateOnly}T00:00:00Z`,
            to: `${toDateNextDayStr}T00:00:00Z`
        };

        if (locationIds.length > 0) {
            const placeholders = locationIds.map((_, i) => `$loc${i}`).join(',');
            query += ` AND locationId IN (${placeholders})`;
            locationIds.forEach((id, i) => {
                params[`loc${i}`] = id;
            });
        }

        const result: unknown[] = db.prepare(query).all(params);

        return NextResponse.json({
            message: 'Success',
            data: result as I1001RosterData[]
        });
    } catch (error) {
        console.error("Error in roster getList API:", error);
        return NextResponse.json(
            {
                message: "Internal server error",
                error: error instanceof Error ? error.message : "Unknown error"
            },
            { status: 500 }
        );
    }
}