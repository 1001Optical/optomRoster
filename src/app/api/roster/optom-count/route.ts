import { NextResponse } from "next/server";
import { I1001Response } from "@/types/api_response";
import { OptomMap } from "@/data/stores";
import { createSecret } from "@/utils/crypto";
import { Shift } from "@/types/employment_hero_response";
import { getAppointmentCounts } from "@/lib/getAppointmentCount";


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
 * GET /api/roster/optom-count?date=2025-12-04
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
    const secret = process.env.EMPLOYMENTHERO_SECRET;
    const server_url = process.env.EMPLOYMENTHERO_API_URL;

    if (!secret || !server_url) {
      throw new Error(
        "Missing required environment variables: EMPLOYMENTHERO_SECRET or EMPLOYMENTHERO_API_URL"
      );
    }

    // 쿼리 파라미터 읽기
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");

    if (!date) {
      console.error("Missing required parameter: date");
      return NextResponse.json(
        {
          message: "Missing required parameter: date (format: YYYY-MM-DD)",
        },
        { status: 400 }
      );
    }

    // 날짜 형식 검증 및 ISO 형식으로 변환
    const dateMatch = date.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) {
      return NextResponse.json(
        {
          message: "Invalid date format. Expected: YYYY-MM-DD",
        },
        { status: 400 }
      );
    }

    // OptomMap의 LocationId 목록
    const optomLocationIds = new Set(OptomMap.map((store) => store.LocationId));
    
    // OptomMap의 LocationId로 필터링 파라미터 생성
    const selectedLocations = OptomMap.map(v => `filter.selectedLocations=${v.LocationId}`).join("&");

    // API 호출
    const fromDate = `${date}T00:00:00Z`;
    const api = `${server_url}/rostershift?filter.fromDate=${fromDate}&filter.toDate=${fromDate}&${selectedLocations}&filter.SelectAllRoles=true`;
    
    console.log(`[OPTOM COUNT] Fetching roster shifts from ${api}`);
    console.log(`[OPTOM COUNT] Looking for Optom locations: ${Array.from(optomLocationIds).join(', ')}`);
    
    const response = await fetch(api, {
      method: "GET",
      headers: {
        Authorization: createSecret(secret),
        "content-type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Employment Hero API request failed: ${response.status} ${response.statusText}`
      );
    }

    const shifts: Shift[] = await response.json();

    // OptomMap의 LocationId와 매칭되는 shift만 필터링
    const optomShifts = shifts.filter((shift) =>
      optomLocationIds.has(shift.locationId)
    );

    console.log(
      `[OPTOM COUNT] Found ${optomShifts.length} optom shifts out of ${shifts.length} total shifts`
    );
    
    // 각 스토어별로 받은 shift 개수 로그
    const shiftCountByLocation = new Map<number, number>();
    optomShifts.forEach((shift) => {
      shiftCountByLocation.set(
        shift.locationId,
        (shiftCountByLocation.get(shift.locationId) || 0) + 1
      );
    });
    
    console.log(`[OPTOM COUNT] Shift count by location:`, 
      Array.from(shiftCountByLocation.entries()).map(([locId, count]) => {
        const store = OptomMap.find(s => s.LocationId === locId);
        return `${store?.StoreName || 'Unknown'} (${locId}): ${count}`;
      }).join(', ')
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

    // 각 shift에 대해 슬롯 개수 계산
    optomShifts.forEach((shift) => {
      // startTime과 endTime만 사용 (description 파싱 제거)
      if (!shift.startTime || !shift.endTime) {
        console.warn(
          `[OPTOM COUNT] Missing startTime or endTime: LocationId=${shift.locationId}, Description="${shift.description}", StartTime=${shift.startTime}, EndTime=${shift.endTime}`
        );
        return; // startTime/endTime이 없으면 스킵
      }

      const startDate = new Date(shift.startTime);
      const endDate = new Date(shift.endTime);
      const workMinutes = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60));
      
      console.log(
        `[OPTOM COUNT] Using startTime/endTime: LocationId=${shift.locationId}, Description="${shift.description}", StartTime=${shift.startTime}, EndTime=${shift.endTime}, WorkMinutes=${workMinutes}`
      );

      if (workMinutes <= 0) {
        console.warn(
          `[OPTOM COUNT] Invalid work time (${workMinutes} minutes): LocationId=${shift.locationId}, Description="${shift.description}"`
        );
        return;
      }

      const slotCount = calculateSlots(workMinutes);

      const storeName = OptomMap.find(s => s.LocationId === shift.locationId)?.StoreName || shift.locationName;
      console.log(
        `[OPTOM COUNT] Shift processed: Store=${storeName} (${shift.locationId}), Description="${shift.description}", WorkMinutes=${workMinutes}, WorkHours=${(workMinutes/60).toFixed(2)}, TotalSlots=${Math.floor(workMinutes/30)}, BreakCount=${workMinutes/60 >= 10 ? 2 : (workMinutes/60 >= 8 ? 1 : 0)}, FinalSlots=${slotCount}`
      );

      // 해당 스토어의 슬롯 카운트에 추가
      const storeData = storeSlotMap.get(shift.locationId);
      if (storeData) {
        storeData.slotCount += slotCount;
      } else {
        // OptomMap에 없지만 locationId가 있는 경우 (예외 처리)
        console.warn(
          `[OPTOM COUNT] LocationId ${shift.locationId} not found in OptomMap`
        );
        storeSlotMap.set(shift.locationId, {
          storeName: shift.locationName,
          locationId: shift.locationId,
          slotCount: slotCount,
        });
      }
    });

    console.log(
      `[OPTOM COUNT] Finished calculating slot counts. Now fetching appointment counts...`
    );

    // 실제 예약 개수 가져오기 (concurrency 제어)
    const branches = OptomMap.map((store) => store.OptCode);
    const appointmentCounts = await getAppointmentCounts(branches, date, 3);

    // 결과를 배열로 변환 (OptomMap 순서 유지)
    // 슬롯 개수와 예약 개수를 합쳐서 점유율 계산
    const result = OptomMap.map((store) => {
      const storeSlotData = storeSlotMap.get(store.LocationId) || {
        storeName: store.StoreName,
        locationId: store.LocationId,
        slotCount: 0,
      };

      const appointmentCount = appointmentCounts.get(store.OptCode) || 0;
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
