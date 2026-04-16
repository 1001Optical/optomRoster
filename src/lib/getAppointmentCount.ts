import { createSecret } from "@/utils/crypto";
import { OptomMap } from "@/data/stores";
import { fromZonedTime } from "date-fns-tz";
import { dbExecute, dbGet, getDB } from "@/utils/db/db";
import { toDateOnly } from "@/utils/time";
import { createLogger } from "@/lib/logger";

const logger = createLogger('AppointmentCount');

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
  const [year, month, day] = start.split('-').map(Number);
  const startLocalDate = new Date(year, month - 1, day, 0, 0, 0);
  const startUtc = fromZonedTime(startLocalDate, timezone);

  // 브랜치 시간대로 종료일 다음날 00:00:00 설정 (로컬 시간)
  const [endYear, endMonth, endDay] = end.split('-').map(Number);
  const endLocalDate = new Date(endYear, endMonth - 1, endDay + 1, 0, 0, 0);
  const endUtc = fromZonedTime(endLocalDate, timezone);

  logger.debug(`Date range converted`, { branch, timezone, start: startUtc.toISOString(), end: endUtc.toISOString() });

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
  await dbExecute(db, `
    CREATE TABLE IF NOT EXISTS appointment_count_cache (
      branch TEXT NOT NULL,
      date TEXT NOT NULL,
      count INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (branch, date)
    )
  `);

  // 오늘 날짜 확인 (YYYY-MM-DD 형식)
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const isPastDate = date < today;
  const isToday = date === today;

  logger.debug(`Date check`, { date, today, isPastDate, isToday });

  // 오늘 또는 미래 날짜는 무조건 0 반환 (아직 누적되지 않았으므로)
  if (!isPastDate) {
    logger.debug(`Returning 0 for today/future date`, { date });
    return 0;
  }

  // 과거 날짜만 DB에서 조회 (배치 작업으로 미리 저장된 데이터)
  if (!forceRefresh) {
    const cached = await dbGet<{ count: number }>(
      db,
      `
      SELECT count FROM appointment_count_cache
      WHERE branch = ? AND date = ?
    `,
      [branch, date]
    );

    if (cached) {
      logger.debug(`Using cached count`, { branch, date, count: cached.count });
      return cached.count;
    }

    // DB에 없으면 0 반환
    logger.debug(`No cached data for past date`, { branch, date });
    return 0;
  }

  // 과거 날짜인데 DB에 없으면 0 반환
  if (!forceRefresh) {
    logger.debug(`No stored data for past date`, { branch, date });
    return 0;
  }

  // forceRefresh가 true인 경우에만 API 호출 (배치 작업에서 사용)
  if (!forceRefresh || !isPastDate) {
    return 0;
  }

  const optomateApiUrl = process.env.OPTOMATE_API_URL;
  if (!optomateApiUrl) {
    throw new Error("OPTOMATE_API_URL environment variable is not set");
  }

  // 날짜 범위를 브랜치 시간대로 변환
  const { start, end } = getBranchDateRange(date, date, branch);

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

  const params = new URLSearchParams({
    $filter: filter,
    $select: "DURATION",
    $top: "10000",
  });

  const url = `${optomateApiUrl}/Appointments?${params.toString()}`;
  logger.info(`Fetching appointment count`, { branch, date });

  try {
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        authorization: createSecret(process.env.OPTOMATE_USERNAME!, process.env.OPTOMATE_PASSWORD!),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`API request failed`, { branch, date, status: response.status, statusText: response.statusText });
      throw new Error(
        `Appointment count API request failed: ${response.status} ${response.statusText}`
      );
    }

    const result = await response.json();

    const appointments = result.value || [];

    const { totalSlots, totalDuration } = appointments.reduce(
      (
        acc: { totalSlots: number; totalDuration: number },
        appointment: { DURATION?: number }
      ) => {
        const duration = appointment.DURATION || 0;
        if (duration <= 0) {
          return acc;
        }
        const slots = Math.ceil(duration / 30);
        return {
          totalSlots: acc.totalSlots + slots,
          totalDuration: acc.totalDuration + duration,
        };
      },
      { totalSlots: 0, totalDuration: 0 }
    );

    logger.info(`Appointment count fetched`, { branch, date, appointments: appointments.length, slots: totalSlots, totalDuration });

    // DB에 저장
    await dbExecute(
      db,
      `
      INSERT OR REPLACE INTO appointment_count_cache (branch, date, count, updated_at)
      VALUES (?, ?, ?, ?)
    `,
      [branch, date, totalSlots, Date.now()]
    );

    return totalSlots;
  } catch (error) {
    logger.error(`Error fetching appointment count`, { branch, date, error: String(error) });
    throw error;
  }
}

/**
 * 여러 브랜치의 예약 슬롯 개수를 동시에 가져오되, concurrency 제어
 */
export async function getAppointmentCounts(
  branches: string[],
  date: string,
  concurrency: number = 3,
  forceRefresh: boolean = false
): Promise<Map<string, number>> {
  const results = new Map<string, number>();

  for (let i = 0; i < branches.length; i += concurrency) {
    const batch = branches.slice(i, i + concurrency);

    logger.debug(`Processing appointment count batch`, {
      batch: Math.floor(i / concurrency) + 1,
      of: Math.ceil(branches.length / concurrency),
      branches: batch
    });

    const batchPromises = batch.map(async (branch) => {
      try {
        const count = await getAppointmentCount(branch, date, forceRefresh);
        return { branch, count, success: true };
      } catch (error) {
        logger.error(`Failed to get count for branch`, { branch, error: String(error) });
        return { branch, count: 0, success: false };
      }
    });

    const batchResults = await Promise.allSettled(batchPromises);

    batchResults.forEach((result) => {
      if (result.status === "fulfilled" && result.value.success) {
        results.set(result.value.branch, result.value.count);
      } else if (result.status === "fulfilled") {
        results.set(result.value.branch, 0);
      } else {
        logger.error(`Promise rejected in appointment count batch`, { reason: String(result.reason) });
      }
    });

    if (i + concurrency < branches.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return results;
}

/**
 * 배치 작업: 특정 날짜의 모든 브랜치 예약 슬롯 개수를 API에서 가져와서 DB에 저장
 */
export async function syncAppointmentCounts(
  date: string,
  concurrency: number = 3
): Promise<void> {
  const today = toDateOnly(new Date());
  const isPastDate = date < today;

  if (!isPastDate) {
    logger.info(`Skipping sync — not a past date`, { date, today });
    return;
  }

  const branches = OptomMap.map((store) => store.OptCode);
  logger.info(`Syncing appointment slot counts`, { branches: branches.length, date });

  await getAppointmentCounts(branches, date, concurrency, true);

  logger.info(`Completed syncing appointment slot counts`, { date });
}
