import { NextResponse } from "next/server";
import { I1001Response } from "@/types/api_response";
import { deletePastDataForAllBranches } from "@/lib/syncRoster";

/**
 * 오늘 이전의 모든 데이터를 모든 브랜치에서 삭제하는 API
 * 오늘 데이터는 보존
 * 매일 5시에 실행되는 store-by-store-sync 스크립트에서 사용
 * GET /api/roster/cleanup-past-data
 */
export async function GET(
    request: Request
): Promise<NextResponse<I1001Response<{ deleted: number }>>> {
    try {
        const deletedCount = await deletePastDataForAllBranches();
        
        return NextResponse.json({
            message: "success",
            data: {
                deleted: deletedCount
            }
        });
    } catch (error) {
        console.error("Error in cleanup past data API:", error);
        return NextResponse.json(
            {
                message: "Internal server error",
                error: error instanceof Error ? error.message : "Unknown error"
            },
            { status: 500 }
        );
    }
}
