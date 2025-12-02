import { NextResponse } from "next/server";
import { I1001Response } from "@/types/api_response";
import { OptomMap } from "@/data/stores";
import { getDB } from "@/utils/db/db";
import { getDateRange } from "@/utils/time";
import { createSecret } from "@/utils/crypto";
import { Shift } from "@/types/employment_hero_response";


/**
 * 근무 시간(분)을 기반으로 30분 슬롯 개수 계산
 * - 30분마다 눈검사 슬롯이 있음
 * - 브레이크는 항상 있음 (10시간 미만: break 1개, 10시간 이상: break 2개)
 */
function calculateSlots(workMinutes: number): number {
  // 30분 단위 슬롯 개수 계산
  const totalSlots = Math.floor(workMinutes / 30);
  
  // break time 개수 결정
  const workHours = workMinutes / 60;
  let breakCount = 1; // 기본적으로 브레이크 1개는 항상 있음
  
  if (workHours >= 10) {
    breakCount = 2; // 10시간 이상이면 break 2개
  }
  // 10시간 미만이면 break 1개 (기본값)
  
  // break time을 제외한 실제 슬롯 개수
  // break는 30분씩이므로 breakCount만큼 빼기
  return Math.max(0, totalSlots - breakCount);
}

/**
 * 스토어별 Optom Roster 카운트와 실제 예약 개수, 점유율을 반환하는 API
 * GET /api/roster/optom-count?date=2025-12-04 (단일 날짜)
 * GET /api/roster/optom-count?from=2025-12-01&to=2025-12-07 (기간)
 */
export async function GET(
  request: Request
): Promise<
  NextResponse<
    I1001Response<
      {
        storeName: string;
        locationId: number;
        branch: string;
        slotCount: number;
        appointmentCount: number;
        occupancyRate: number;
      }[]
    >
  >
> {
  try {
    const db = getDB();

    // 쿼리 파라미터 읽기
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");
    const weekly = searchParams.get("weekly") === "true"; // 주별 모드: 날짜별 데이터 반환

    let dates: string[] = [];

    if (date) {
      // 단일 날짜 모드
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
      // 기간 모드
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
          message: "Missing required parameter: date or (from and to)",
        },
        { status: 400 }
      );
    }

    // OptomMap의 LocationId 목록
    const optomLocationIds = OptomMap.map((store) => store.LocationId);

    console.log(`[OPTOM COUNT] Processing ${dates.length} date(s): ${dates[0]} to ${dates[dates.length - 1]}`);
    console.log(`[OPTOM COUNT] Fetching data from Employment Hero API (no DB read/write)`);

    // Employment Hero API에서 직접 데이터 가져오기 (DB 저장 없음)
    const secret = process.env.EMPLOYMENTHERO_SECRET;
    const server_url = process.env.EMPLOYMENTHERO_API_URL;
    
    if (!secret || !server_url) {
      return NextResponse.json(
        {
          message: "Missing required environment variables: EMPLOYMENTHERO_SECRET or EMPLOYMENTHERO_API_URL",
        },
        { status: 500 }
      );
    }

    const selectedLocations = OptomMap.map(v => `filter.selectedLocations=${v.LocationId}`).join("&");
    const api = `${server_url}/rostershift?filter.SelectAllRoles=true&filter.ShiftStatuses=published&filter.fromDate=${dates[0]}&filter.toDate=${dates[dates.length - 1]}&${selectedLocations}`;
    
    const response = await fetch(api, {
      headers: {
        "Authorization": createSecret(secret)
      }
    });

    if (!response.ok) {
      throw new Error(`Employment Hero API request failed: ${response.status} ${response.statusText}`);
    }

    const shifts: Shift[] = await response.json();
    console.log(`[OPTOM COUNT] Received ${shifts.length} shifts from Employment Hero API`);

    // Shift 데이터에서 필요한 정보만 추출 (startTime, endTime, locationId만 필요)
    // Employment Hero API에서 받은 시간을 그대로 사용 (타임존 변환 없음)
    const rosterRows = shifts
      .filter((shift: Shift) => shift.startTime && shift.endTime && shift.locationId)
      .map((shift: Shift) => ({
        id: shift.id,
        locationId: shift.locationId,
        startTime: shift.startTime,
        endTime: shift.endTime,
      }));

    console.log(
      `[OPTOM COUNT] Processed ${rosterRows.length} shifts (only time and location data)`
    );

    // 스토어별로 슬롯 카운트 집계
    const storeSlotMap = new Map<
      number,
      { storeName: string; locationId: number; slotCount: number }
    >();

    // OptomMap을 기반으로 스토어별 초기값 설정
    OptomMap.forEach((store) => {
      storeSlotMap.set(store.LocationId, {
        storeName: store.StoreName,
        locationId: store.LocationId,
        slotCount: 0,
      });
    });

    // 각 roster에 대해 슬롯 개수 계산
    rosterRows.forEach((roster) => {
      if (!roster.startTime || !roster.endTime) {
        return;
      }

      const startDate = new Date(roster.startTime);
      const endDate = new Date(roster.endTime);
      const workMinutes = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60));
    

      if (workMinutes <= 0) {
        return;
      }

      const slotCount = calculateSlots(workMinutes);

      // 해당 스토어의 슬롯 카운트에 추가
      const storeData = storeSlotMap.get(roster.locationId);
      if (storeData) {
        storeData.slotCount += slotCount;
      }
    });

    console.log(
      `[OPTOM COUNT] Finished calculating slot counts. Now fetching appointment counts from DB...`
    );

    // 주별 모드: 날짜별 데이터 반환
    if (weekly) {
      // 날짜별로 슬롯과 예약 개수 계산
      const dateWiseData = new Map<string, Map<string, { slotCount: number; appointmentCount: number }>>();
      
      // 각 날짜별로 처리
      for (const currentDate of dates) {
        // 해당 날짜의 roster만 필터링
        // startTime이 ISO 문자열이므로 직접 파싱 (시간대 문제 방지)
        const dateRosters = rosterRows.filter((roster) => {
          if (!roster.startTime) return false;
          // ISO 문자열에서 날짜 부분만 추출 (YYYY-MM-DD)
          const rosterDate = roster.startTime.split('T')[0];
          return rosterDate === currentDate;
        });

        // 해당 날짜의 슬롯 카운트 계산
        const dateSlotMap = new Map<number, number>();
        dateRosters.forEach((roster) => {
          if (!roster.startTime || !roster.endTime) return;
          const startDate = new Date(roster.startTime);
          const endDate = new Date(roster.endTime);
          const workMinutes = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60));
          if (workMinutes <= 0) return;
          const slotCount = calculateSlots(workMinutes);
          dateSlotMap.set(roster.locationId, (dateSlotMap.get(roster.locationId) || 0) + slotCount);
        });

        // 해당 날짜의 예약 개수 DB에서 조회
        const appointmentCounts = new Map<string, number>();
        OptomMap.forEach((store) => {
          const cached = db.prepare(`
            SELECT count FROM appointment_count_cache 
            WHERE branch = ? AND date = ?
          `).get(store.OptCode, currentDate) as { count: number } | undefined;
          appointmentCounts.set(store.OptCode, cached?.count || 0);
        });
        
        // 날짜별 데이터 저장
        const dateData = new Map<string, { slotCount: number; appointmentCount: number }>();
        OptomMap.forEach((store) => {
          const slotCount = dateSlotMap.get(store.LocationId) || 0;
          const appointmentCount = appointmentCounts.get(store.OptCode) || 0;
          dateData.set(store.OptCode, { slotCount, appointmentCount });
        });
        dateWiseData.set(currentDate, dateData);
      }

      // 결과 생성: 스토어별로 날짜별 점유율 포함
      const result = OptomMap.map((store) => {
        const dateOccupancyRates: Record<string, { slotCount: number; appointmentCount: number; occupancyRate: number }> = {};
        let totalSlotCount = 0;
        let totalAppointmentCount = 0;

        dates.forEach((currentDate) => {
          const dateData = dateWiseData.get(currentDate)?.get(store.OptCode);
          if (dateData) {
            const { slotCount, appointmentCount } = dateData;
            totalSlotCount += slotCount;
            totalAppointmentCount += appointmentCount;
            const occupancyRate = slotCount > 0
              ? Math.round((appointmentCount / slotCount) * 100 * 100) / 100
              : 0;
            dateOccupancyRates[currentDate] = {
              slotCount,
              appointmentCount,
              occupancyRate
            };
          } else {
            dateOccupancyRates[currentDate] = {
              slotCount: 0,
              appointmentCount: 0,
              occupancyRate: 0
            };
          }
        });

        const totalOccupancyRate = totalSlotCount > 0
          ? Math.round((totalAppointmentCount / totalSlotCount) * 100 * 100) / 100
          : 0;

        return {
          storeName: store.StoreName,
          locationId: store.LocationId,
          branch: store.OptCode,
          slotCount: totalSlotCount,
          appointmentCount: totalAppointmentCount,
          occupancyRate: totalOccupancyRate,
          dateOccupancyRates, // 날짜별 점유율
        };
      });

      return NextResponse.json({
        message: "Success",
        data: result,
        dates, // 날짜 목록도 반환
      });
    }

    // 일반 모드: 누적 데이터 반환
    const appointmentCountsMap = new Map<string, number>();
    
    // 각 날짜별로 예약 개수 DB에서 조회하고 누적
    for (const currentDate of dates) {
      OptomMap.forEach((store) => {
        const cached = db.prepare(`
          SELECT count FROM appointment_count_cache 
          WHERE branch = ? AND date = ?
        `).get(store.OptCode, currentDate) as { count: number } | undefined;
        const count = cached?.count || 0;
        appointmentCountsMap.set(store.OptCode, (appointmentCountsMap.get(store.OptCode) || 0) + count);
      });
    }

    // 결과를 배열로 변환 (OptomMap 순서 유지)
    // 슬롯 개수와 예약 개수를 합쳐서 점유율 계산
    const result = OptomMap.map((store) => {
      const storeSlotData = storeSlotMap.get(store.LocationId) || {
        storeName: store.StoreName,
        locationId: store.LocationId,
        slotCount: 0,
      };

      const appointmentCount = appointmentCountsMap.get(store.OptCode) || 0;
      const slotCount = storeSlotData.slotCount;

      // 점유율 계산: (appointment count / slotCount) * 100
      // slotCount가 0이면 점유율은 0으로 처리
      const occupancyRate =
        slotCount > 0
          ? Math.round((appointmentCount / slotCount) * 100 * 100) / 100
          : 0;

      return {
        storeName: store.StoreName,
        locationId: store.LocationId,
        branch: store.OptCode,
        slotCount: slotCount,
        appointmentCount: appointmentCount,
        occupancyRate: occupancyRate,
      };
    });

    return NextResponse.json({
      message: "Success",
      data: result,
    });
  } catch (error) {
    console.error("[OPTOM COUNT] Error in optom-count API:", error);
    return NextResponse.json(
      {
        message: "Internal server error",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
