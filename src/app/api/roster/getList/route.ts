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

        if(!fromDate || !toDate) {
            console.error("Missing required parameters: from and to dates");
            return NextResponse.json(
                {
                    message: "Missing required parameters: from and to dates",
                },
                { status: 400 }
            );
        }

        // 날짜 형식 검증
        const fromDateObj = new Date(fromDate);
        const toDateObj = new Date(toDate);
        
        if (isNaN(fromDateObj.getTime()) || isNaN(toDateObj.getTime())) {
            console.error("Invalid date format provided");
            return NextResponse.json(
                {
                    message: "Invalid date format provided",
                },
                { status: 400 }
            );
        }

        const result: unknown[] = db.prepare(
            `SELECT id,
                    employeeId,
                    firstName,
                    lastName,
                    locationId,
                    locationName,
                    startTime,
                    endTime,
                    email,
                    -- 파생값
                    date(startTime)                            AS day,       -- 'YYYY-MM-DD'
                    CAST(strftime('%w', startTime) AS INTEGER) AS dow,       -- 0=Sun..6=Sat
                    substr(startTime, 12, 5)                   AS hhmmStart, -- 'HH:MM'
                    substr(endTime, 12, 5)                     AS hhmmEnd

             FROM ROSTER
             WHERE startTime >= $from -- 예: '2025-09-14T00:00:00'
               AND endTime < $to
               AND ($locationId IS NULL OR locationId = $locationId)
            `
        ).all({
            from: `${fromDate}T00:00:00Z`,
            to: `${toDate}T23:59:59Z`,
            locationId: locationId,
        });

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