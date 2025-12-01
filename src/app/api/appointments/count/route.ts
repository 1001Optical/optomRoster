import { NextResponse } from "next/server";
import { I1001Response } from "@/types/api_response";
import { OptomMap } from "@/data/stores";
import {
  getAppointmentCount,
  getAppointmentCounts,
} from "@/lib/getAppointmentCount";

/**
 * 실제 예약(눈검사) 개수를 반환하는 API
 * GET /api/appointments/count?date=2025-12-01
 */
export async function GET(
  request: Request
): Promise<
  NextResponse<
    I1001Response<{ storeName: string; branch: string; count: number }[]>
  >
> {
  try {
    // 쿼리 파라미터 읽기
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    const branch = searchParams.get("branch"); // 특정 브랜치만 조회할 경우

    if (!date) {
      console.error("Missing required parameter: date");
      return NextResponse.json(
        {
          message: "Missing required parameter: date (format: YYYY-MM-DD)",
        },
        { status: 400 }
      );
    }

    // 날짜 형식 검증
    const dateMatch = date.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) {
      return NextResponse.json(
        {
          message: "Invalid date format. Expected: YYYY-MM-DD",
        },
        { status: 400 }
      );
    }

    // 브랜치 목록 결정
    let branches: string[] = [];
    if (branch) {
      // 특정 브랜치만 조회
      const foundBranch = OptomMap.find((s) => s.OptCode === branch);
      if (!foundBranch) {
        return NextResponse.json(
          {
            message: `Invalid branch code: ${branch}`,
          },
          { status: 400 }
        );
      }
      branches = [branch];
    } else {
      // 모든 Optom 브랜치 조회
      branches = OptomMap.map((s) => s.OptCode);
    }

    console.log(
      `[APPOINTMENT COUNT API] Fetching appointment counts for ${branches.length} branches on ${date}`
    );

    // concurrency 제어하여 예약 개수 가져오기 (동시에 3개씩)
    const appointmentCounts = await getAppointmentCounts(
      branches,
      date,
      3 // 동시에 3개씩 처리
    );

    // 결과를 배열로 변환 (OptomMap 순서 유지)
    const result = OptomMap.map((store) => {
      const count = appointmentCounts.get(store.OptCode) || 0;
      return {
        storeName: store.StoreName,
        branch: store.OptCode,
        count: count,
      };
    });

    // 특정 브랜치만 조회한 경우 해당 브랜치만 반환
    const finalResult = branch
      ? result.filter((r) => r.branch === branch)
      : result;

    return NextResponse.json({
      message: "Success",
      data: finalResult,
    });
  } catch (error) {
    console.error("[APPOINTMENT COUNT API] Error:", error);
    return NextResponse.json(
      {
        message: "Internal server error",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

