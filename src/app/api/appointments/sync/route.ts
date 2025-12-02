import { NextResponse } from "next/server";
import { I1001Response } from "@/types/api_response";
import { syncAppointmentCounts } from "@/lib/getAppointmentCount";
import { getDateRange, toDateOnly } from "@/utils/time";

/**
 * 배치 작업: 예약 개수를 API에서 가져와서 DB에 저장
 * GET /api/appointments/sync?date=2025-12-01 (단일 날짜)
 * GET /api/appointments/sync?from=2025-12-01&to=2025-12-02 (기간)
 * GET /api/appointments/sync?yesterday=true (어제 날짜)
 */
export async function GET(
  request: Request
): Promise<NextResponse<I1001Response<{ synced: number }>>> {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");
    const yesterday = searchParams.get("yesterday") === "true";

    let dates: string[] = [];

    if (yesterday) {
      // 어제 날짜
      const yesterdayDate = new Date();
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      dates = [toDateOnly(yesterdayDate)];
      console.log(`[APPOINTMENT SYNC] Syncing yesterday: ${dates[0]}`);
    } else if (date) {
      // 단일 날짜
      const dateMatch = date.match(/^(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) {
        return NextResponse.json(
          {
            message: "Invalid date format. Expected: YYYY-MM-DD",
          },
          { status: 400 }
        );
      }
      dates = [date];
    } else if (fromDate && toDate) {
      // 기간
      const fromMatch = fromDate.match(/^(\d{4}-\d{2}-\d{2})/);
      const toMatch = toDate.match(/^(\d{4}-\d{2}-\d{2})/);
      if (!fromMatch || !toMatch) {
        return NextResponse.json(
          {
            message: "Invalid date format. Expected: YYYY-MM-DD",
          },
          { status: 400 }
        );
      }
      dates = getDateRange(fromDate, toDate);
    } else {
      return NextResponse.json(
        {
          message: "Missing required parameter: date, (from and to), or yesterday=true",
        },
        { status: 400 }
      );
    }

    // 오늘 이후 날짜 필터링 (과거 날짜만 동기화)
    // 로컬 시간 기준으로 오늘 날짜 계산 (yesterday와 동일한 기준 사용)
    const today = toDateOnly(new Date());
    const pastDates = dates.filter(d => d < today);

    if (pastDates.length === 0) {
      return NextResponse.json(
        {
          message: "No past dates to sync. Only past dates can be synced.",
        },
        { status: 400 }
      );
    }

    console.log(
      `[APPOINTMENT SYNC] Syncing ${pastDates.length} date(s): ${pastDates[0]} to ${pastDates[pastDates.length - 1]}`
    );

    // 각 날짜별로 동기화
    for (const currentDate of pastDates) {
      await syncAppointmentCounts(currentDate, 3);
    }

    return NextResponse.json({
      message: "Success",
      data: { synced: pastDates.length },
    });
  } catch (error) {
    console.error("[APPOINTMENT SYNC] Error:", error);
    return NextResponse.json(
      {
        message: "Internal server error",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

