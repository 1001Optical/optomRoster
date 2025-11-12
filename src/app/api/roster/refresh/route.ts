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

        const result = await getEmploymentHeroList(fromDate, toDate, branch);

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