import { NextResponse } from "next/server";
import { I1001Response } from "@/types/api_response";
import { sendChangeToOptomateAPI } from "@/lib/changeProcessor";
import { createLogger } from "@/lib/logger";
import { withAxiomFlush } from "@/lib/axiom/withFlush";

const logger = createLogger('ConflictEmail');

/**
 * 모든 Appointment 충돌을 조회하여 한 번에 메일 전송
 * GET /api/roster/send-conflict-email
 * 
 * CHANGE_LOG에 남아있는 모든 항목을 처리하여 충돌 정보를 수집합니다.
 * 메일 전송은 성능 이슈로 비활성화되었습니다.
 */
export async function GET(request: Request): Promise<NextResponse<I1001Response<{ conflictsCount: number }>>> {
    return withAxiomFlush(async () => {
    try {
        // sendChangeToOptomateAPI를 호출하여 모든 충돌 정보를 가져옴
        // skipEmail=true로 설정하여 메일을 보내지 않고 충돌 정보만 수집
        const { appointmentConflicts } = await sendChangeToOptomateAPI();

        if (appointmentConflicts.length === 0) {
            return NextResponse.json(
                {
                    message: "No appointment conflicts found",
                    data: { conflictsCount: 0 }
                },
                { status: 200 }
            );
        }

        return NextResponse.json(
            {
                message: "Email alerts disabled",
                data: { conflictsCount: appointmentConflicts.length }
            },
            { status: 200 }
        );
    } catch (error) {
        logger.error("Error in send-conflict-email API", { error });
        return NextResponse.json(
            {
                message: "Internal server error",
                error: error instanceof Error ? error.message : "Unknown error"
            },
            { status: 500 }
        );
    }
    });
}
