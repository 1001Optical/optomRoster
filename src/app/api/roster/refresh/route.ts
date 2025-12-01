import { NextResponse } from "next/server";
import {I1001Response} from "@/types/api_response";
import {optomData} from "@/types/types";
import {getEmploymentHeroList} from "@/lib/getEmploymentHeroList";
import {toLocalIsoNoOffset} from "@/utils/time";
import {startOfDay, endOfDay, endOfMonth, addMonths, addWeeks, endOfWeek} from "date-fns";


export async function GET(request: Request): Promise<NextResponse<I1001Response<optomData[]>>>  {
    try {
        // 쿼리 파라미터 읽기
        const { searchParams } = new URL(request.url);
        let fromDate = searchParams.get("from") ?? "";
        let toDate = searchParams.get("to") ?? "";
        const range = searchParams.get("range");
        const branch = searchParams.get("branch");

        if(range){
            const todayDate = new Date();
            switch(range){
                case "today":
                    fromDate = toLocalIsoNoOffset(startOfDay(todayDate));
                    toDate = toLocalIsoNoOffset(endOfDay(todayDate));
                    break;
                case "weekly":
                    fromDate = toLocalIsoNoOffset(startOfDay(todayDate));
                    toDate = toLocalIsoNoOffset(endOfWeek(addWeeks(todayDate, 1)));
                    break;
                case "monthly":
                    fromDate = toLocalIsoNoOffset(startOfDay(todayDate));
                    toDate = toLocalIsoNoOffset(endOfMonth(addMonths(todayDate, 1)));
                    break;
                default:
                    console.error("[Error] Invalid range format. Supported values are: today, weekly, monthly");
                    return NextResponse.json(
                        {
                            message: "Invalid range format. Supported values are: today, weekly, monthly",
                        },
                        { status: 400 }
                    );
            }
        }else{
            if(!fromDate || !toDate){
                console.error("Missing required parameters: from and to dates OR range");
                return NextResponse.json(
                    {
                        message: "Missing required parameters: from and to dates OR range",
                    },
                    { status: 400 }
                );
            }
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

        // 날짜 형식 검증 및 정규화
        let normalizedFromDate: string;
        let normalizedToDate: string;

        try {
            normalizedFromDate = extractDateOnly(fromDate);
            normalizedToDate = extractDateOnly(toDate);
        } catch (error) {
            console.error("Invalid date format provided:", error);
            return NextResponse.json(
                {
                    message: "Invalid date format provided",
                },
                { status: 400 }
            );
        }

        const fromDateObj = new Date(normalizedFromDate);
        const toDateObj = new Date(normalizedToDate);
        
        if (isNaN(fromDateObj.getTime()) || isNaN(toDateObj.getTime())) {
            console.error("Invalid date format provided");
            return NextResponse.json(
                {
                    message: "Invalid date format provided",
                },
                { status: 400 }
            );
        }

        const result = await getEmploymentHeroList(normalizedFromDate, normalizedToDate, branch);

        return NextResponse.json(
            {
                message: "success",
                data: result
            },
            { status: 200 }
        );
    } catch (error) {
        console.error("Error in roster refresh API:", error);
        return NextResponse.json(
            {
                message: "Internal server error",
                error: error instanceof Error ? error.message : "Unknown error"
            },
            { status: 500 }
        );
    }
}