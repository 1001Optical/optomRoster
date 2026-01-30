import { createSecret } from "@/utils/crypto";
import { OptomMap } from "@/data/stores";
import { fromZonedTime } from "date-fns-tz";
import { getDB } from "@/utils/db/db";
import { toDateOnly } from "@/utils/time";

/**
 * 브랜치별 timezone 반환
 */
function getBranchTimezone(branch: string): string {
  const store = OptomMap.find((s) => s.OptCode === branch);
  if (!store) {
    // 기본값: Sydney
    return "Australia/Sydney";
  }

  // State에 따라 timezone 반환
  switch (store.State) {
    case "NSW":
      return "Australia/Sydney";
    case "VIC":
      return "Australia/Melbourne";
    case "QLD":
      return "Australia/Brisbane";
    default:
      return "Australia/Sydney";
  }
}

/**
 * 브랜치 시간대로 날짜 범위를 UTC로 변환
 * 로컬 시간 문자열(예: "2025-12-01T00:00:00")을 해당 timezone의 로컬 시간으로 해석하고 UTC로 변환
 */
function getBranchDateRange(start: string, end: string, branch: string) {
  const timezone = getBranchTimezone(branch);

  // 브랜치 시간대로 시작일 00:00:00 설정 (로컬 시간)
  // 로컬 시간 문자열을 Date 객체로 생성 (이 Date는 해당 timezone의 로컬 시간을 나타냄)
  const [year, month, day] = start.split('-').map(Number);
  const startLocalDate = new Date(year, month - 1, day, 0, 0, 0);
  const startUtc = fromZonedTime(startLocalDate, timezone);

  // 브랜치 시간대로 종료일 다음날 00:00:00 설정 (로컬 시간)
  const [endYear, endMonth, endDay] = end.split('-').map(Number);
  const endLocalDate = new Date(endYear, endMonth - 1, endDay + 1, 0, 0, 0);
  const endUtc = fromZonedTime(endLocalDate, timezone);

  console.log(
    `🕐 [${branch}] ${timezone} - Local: ${start}T00:00:00 -> UTC: ${startUtc.toISOString()}`
  );
  console.log(
    `🕐 [${branch}] ${timezone} - Local: ${end}T00:00:00 (next day) -> UTC: ${endUtc.toISOString()}`
  );

  return {
    start: startUtc.toISOString(),
    end: endUtc.toISOString(),
  };
}

/**
 * DURATION을 기반으로 예약 슬롯 개수를 계산하는 함수
 * - DURATION 30 = 슬롯 1개
 * - 과거 날짜: DB에서 조회 (배치 작업으로 미리 저장된 데이터)
 * - 오늘/미래 날짜: 0 반환 (아직 누적되지 않았으므로)
 * @param branch OptCode (예: "BKT", "BON")
 * @param date YYYY-MM-DD 형식의 날짜
 * @param forceRefresh 강제 갱신 여부 (배치 작업에서 사용, 기본값: false)
 * @returns 슬롯 개수 (DURATION / 30의 합계)
 */
export async function getAppointmentCount(
  branch: string,
  date: string,
  forceRefresh: boolean = false
): Promise<number> {
  const db = await getDB();
  
  // DB 테이블 생성 (한 번만)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS appointment_count_cache (
      branch TEXT NOT NULL,
      date TEXT NOT NULL,
      count INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (branch, date)
    )
  `);

  // 오늘 날짜 확인 (YYYY-MM-DD 형식)
  // 로컬 시간 기준으로 오늘 날짜 계산 (UTC가 아닌)
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const isPastDate = date < today;
  const isToday = date === today;
  
  console.log(
    `[APPOINTMENT COUNT] Date check: ${date}, today: ${today}, isPastDate: ${isPastDate}, isToday: ${isToday}`
  );
  
  // 오늘 또는 미래 날짜는 무조건 0 반환 (아직 누적되지 않았으므로)
  if (!isPastDate) {
    console.log(
      `[APPOINTMENT COUNT] Date ${date} is today or future, returning 0 (not accumulated yet)`
    );
    return 0;
  }

  // 과거 날짜만 DB에서 조회 (배치 작업으로 미리 저장된 데이터)
  if (!forceRefresh) {
    const cached = await db.prepare(`
      SELECT count FROM appointment_count_cache 
      WHERE branch = ? AND date = ?
    `).get(branch, date) as { count: number } | undefined;

    if (cached) {
      console.log(
        `[APPOINTMENT COUNT] Using stored data for past date - branch ${branch} on ${date}: ${cached.count} slots`
      );
      return cached.count; // DB에 저장된 값은 이미 슬롯 개수
    }
    
    // DB에 없으면 0 반환 (아직 배치 작업이 실행되지 않았거나 데이터가 없는 경우)
    console.log(
      `[APPOINTMENT COUNT] No stored data for past date - branch ${branch} on ${date}, returning 0`
    );
    return 0;
  }
  
  // 과거 날짜인데 DB에 없으면 0 반환 (아직 배치 작업이 실행되지 않았거나 데이터가 없는 경우)
  if (!forceRefresh) {
    console.log(
      `[APPOINTMENT COUNT] No stored data for past date - branch ${branch} on ${date}, returning 0`
    );
    return 0;
  }

  // forceRefresh가 true인 경우에만 API 호출 (배치 작업에서 사용)
  // 과거 날짜만 API 호출 가능
  if (!forceRefresh || !isPastDate) {
    return 0;
  }

  const optomateApiUrl = process.env.OPTOMATE_API_URL;
  if (!optomateApiUrl) {
    throw new Error("OPTOMATE_API_URL environment variable is not set");
  }

  // 날짜 범위를 브랜치 시간대로 변환
  const { start, end } = getBranchDateRange(date, date, branch);

  // UTC 시간을 OData 형식으로 변환 (ISO 8601)
  // 예: 2025-12-01T00:00:00.000Z -> 2025-12-01T00:00:00Z
  const startDateTime = start.replace(/\.\d{3}Z$/, "Z");
  const endDateTime = end.replace(/\.\d{3}Z$/, "Z");

  // 필터 조건 생성
  const filter = [
    `BRANCH_IDENTIFIER eq '${branch}'`,
    `STARTDATETIME ge ${startDateTime}`,
    `STARTDATETIME lt ${endDateTime}`,
    `OPTOMETRIST_ID ne 164`,
    `PATIENT_ID ne -1`,
    `APPOINTMENT_TYPE ne 'NA'`,
    `STATUS ne 6`,
    `STATUS ne 7`,
    `STATUS ne 9`,
  ].join(" and ");

  // OData 쿼리 파라미터 - DURATION 필드만 선택하여 최소한의 데이터만 가져오기
  const params = new URLSearchParams({
    $filter: filter,
    $select: "DURATION", // DURATION 필드만 선택
    $top: "10000", // 충분히 큰 값으로 설정 (하루에 10000개 이상의 예약은 거의 없음)
  });

  const url = `${optomateApiUrl}/Appointments?${params.toString()}`;
  console.log(`[APPOINTMENT COUNT] Fetching appointments with DURATION for branch ${branch} on ${date}`);
  console.log(`[APPOINTMENT COUNT] URL: ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        authorization: createSecret("1001_HO_JH", "10011001"),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[APPOINTMENT COUNT] API request failed: ${response.status} ${response.statusText}`,
        errorText
      );
      throw new Error(
        `Appointment count API request failed: ${response.status} ${response.statusText}`
      );
    }

    const result = await response.json();

    // OData 응답 형식: { value: [{ DURATION: 30 }, { DURATION: 60 }, ...] }
    const appointments = result.value || [];
    
    // DURATION을 합산하여 슬롯 개수 계산 (DURATION 30 = 슬롯 1개)
    // ROUNDUP(DURATION/30) = Math.ceil(DURATION/30)의 전체 합
    const { totalSlots, totalDuration } = appointments.reduce(
      (
        acc: { totalSlots: number; totalDuration: number },
        appointment: { DURATION?: number }
      ) => {
        const duration = appointment.DURATION || 0;
        if (duration <= 0) {
          return acc; // 유효하지 않은 DURATION은 건너뛰기
        }
        // DURATION을 30으로 나누어 슬롯 개수 계산 (올림 처리)
        // 예: 30분 = 1슬롯, 31분 = 2슬롯, 60분 = 2슬롯
        const slots = Math.ceil(duration / 30);
        return {
          totalSlots: acc.totalSlots + slots,
          totalDuration: acc.totalDuration + duration,
        };
      },
      { totalSlots: 0, totalDuration: 0 }
    );

    console.log(
      `[APPOINTMENT COUNT] Branch ${branch} on ${date}: ${appointments.length} appointments, ${totalSlots} slots (total DURATION: ${totalDuration})`
    );

    // DB에 저장 (영구 저장) - 슬롯 개수를 저장
    await db.prepare(`
      INSERT OR REPLACE INTO appointment_count_cache (branch, date, count, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(branch, date, totalSlots, Date.now());

    return totalSlots;
  } catch (error) {
    console.error(
      `[APPOINTMENT COUNT] Error fetching appointment count for ${branch} on ${date}:`,
      error
    );
    throw error;
  }
}

/**
 * 여러 브랜치의 예약 슬롯 개수를 동시에 가져오되, concurrency 제어
 * @param branches 브랜치 OptCode 배열
 * @param date YYYY-MM-DD 형식의 날짜
 * @param concurrency 동시에 실행할 최대 요청 수 (기본값: 3)
 * @param forceRefresh 강제 갱신 여부 (배치 작업에서 사용, 기본값: false)
 * @returns 브랜치별 슬롯 개수 맵
 */
export async function getAppointmentCounts(
  branches: string[],
  date: string,
  concurrency: number = 3,
  forceRefresh: boolean = false
): Promise<Map<string, number>> {
  const results = new Map<string, number>();

  // 브랜치를 배치로 나누기
  for (let i = 0; i < branches.length; i += concurrency) {
    const batch = branches.slice(i, i + concurrency);

    console.log(
      `[APPOINTMENT COUNT] Processing batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(branches.length / concurrency)}: ${batch.join(", ")}`
    );

    // 배치 내에서 병렬 처리 (Promise.allSettled 사용 - 일부 실패해도 계속 진행)
    const batchPromises = batch.map(async (branch) => {
      try {
        const count = await getAppointmentCount(branch, date, forceRefresh);
        return { branch, count, success: true };
      } catch (error) {
        console.error(
          `[APPOINTMENT COUNT] Failed to get count for ${branch}:`,
          error
        );
        return { branch, count: 0, success: false };
      }
    });

    const batchResults = await Promise.allSettled(batchPromises);

    // 결과 저장
    batchResults.forEach((result) => {
      if (result.status === "fulfilled" && result.value.success) {
        results.set(result.value.branch, result.value.count);
      } else if (result.status === "fulfilled") {
        results.set(result.value.branch, 0);
      } else {
        // Promise가 reject된 경우
        console.error(
          `[APPOINTMENT COUNT] Promise rejected:`,
          result.reason
        );
      }
    });

    // 배치 간 약간의 지연 (서버 부담 줄이기)
    if (i + concurrency < branches.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return results;
}

/**
 * 배치 작업: 특정 날짜의 모든 브랜치 예약 슬롯 개수를 API에서 가져와서 DB에 저장
 * 매일 새벽에 전날까지의 데이터를 누적시키는 용도
 * @param date YYYY-MM-DD 형식의 날짜 (과거 날짜만)
 * @param concurrency 동시에 실행할 최대 요청 수 (기본값: 3)
 */
export async function syncAppointmentCounts(
  date: string,
  concurrency: number = 3
): Promise<void> {
  // 로컬 시간 기준으로 오늘 날짜 계산 (getAppointmentCount와 동일한 기준 사용)
  const today = toDateOnly(new Date());
  const isPastDate = date < today;
  
  if (!isPastDate) {
    console.log(
      `[APPOINTMENT COUNT SYNC] Skipping ${date} - not a past date (today: ${today})`
    );
    return;
  }

  const branches = OptomMap.map((store) => store.OptCode);
  console.log(
    `[APPOINTMENT COUNT SYNC] Syncing appointment slot counts for ${branches.length} branches on ${date}`
  );

  // forceRefresh=true로 모든 브랜치의 예약 슬롯 개수를 가져와서 DB에 저장
  await getAppointmentCounts(branches, date, concurrency, true);
  
  console.log(
    `[APPOINTMENT COUNT SYNC] Completed syncing appointment slot counts for ${date}`
  );
}
