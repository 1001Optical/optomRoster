import { createSecret } from "@/utils/crypto";
import { OptomMap } from "@/data/stores";
import { fromZonedTime } from "date-fns-tz";

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
 * 실제 예약(눈검사) 개수를 가져오는 함수
 * @param branch OptCode (예: "BKT", "BON")
 * @param date YYYY-MM-DD 형식의 날짜
 * @returns 예약 개수
 */
export async function getAppointmentCount(
  branch: string,
  date: string
): Promise<number> {
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

  // OData 쿼리 파라미터
  const params = new URLSearchParams({
    $filter: filter,
    $count: "true",
    $top: "0", // 카운트만 원하므로 데이터는 가져오지 않음
    $select: "BRANCH_IDENTIFIER", // payload 최소화
  });

  const url = `${optomateApiUrl}/Appointments?${params.toString()}`;
  console.log(`[APPOINTMENT COUNT] Fetching for branch ${branch} on ${date}`);
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

    // OData $count 응답 형식에 따라 처리
    // { "@odata.count": 123 } 또는 response header에 있을 수 있음
    const count =
      result["@odata.count"] ??
      parseInt(response.headers.get("x-odata-count") || "0", 10) ??
      0;

    console.log(
      `[APPOINTMENT COUNT] Branch ${branch} on ${date}: ${count} appointments`
    );

    return count;
  } catch (error) {
    console.error(
      `[APPOINTMENT COUNT] Error fetching appointment count for ${branch} on ${date}:`,
      error
    );
    throw error;
  }
}

/**
 * 여러 브랜치의 예약 개수를 동시에 가져오되, concurrency 제어
 * @param branches 브랜치 OptCode 배열
 * @param date YYYY-MM-DD 형식의 날짜
 * @param concurrency 동시에 실행할 최대 요청 수 (기본값: 3)
 * @returns 브랜치별 예약 개수 맵
 */
export async function getAppointmentCounts(
  branches: string[],
  date: string,
  concurrency: number = 3
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
        const count = await getAppointmentCount(branch, date);
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

