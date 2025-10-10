import { NextResponse } from "next/server";
import {I1001Response} from "@/types/api_response";
import {optomData} from "@/types/types";
import {getEmploymentHeroList} from "@/lib/getEmploymentHeroList";


export async function GET(request: Request): Promise<NextResponse<I1001Response<optomData[]>>>  {
    try {
        // 쿼리 파라미터 읽기
        const { searchParams } = new URL(request.url);
        const fromDate = searchParams.get("from");
        const toDate = searchParams.get("to");

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

        const result = await getEmploymentHeroList(fromDate, toDate);

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