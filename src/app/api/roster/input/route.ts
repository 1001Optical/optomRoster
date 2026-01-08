import { NextResponse } from "next/server";
import { I1001Response } from "@/types/api_response";

interface RosterEntry {
  date: string;
  store: string;
  name: string;
  startTime: string;
  endTime: string;
}

/**
 * CSV 라인을 파싱하여 컬럼 배열로 반환
 */
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let currentValue = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(currentValue.trim());
      currentValue = '';
    } else {
      currentValue += char;
    }
  }
  values.push(currentValue.trim()); // 마지막 값 추가
  
  return values;
}

/**
 * 날짜 형식을 정규화 (04/01/26 -> 2026-01-04)
 */
function normalizeDate(dateStr: string): string {
  if (!dateStr || dateStr.trim() === '') return '';
  
  // 이미 YYYY-MM-DD 형식인 경우
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  
  // DD/MM/YY 형식 파싱
  const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    let year = match[3];
    
    // 2자리 연도를 4자리로 변환 (2000년대 가정)
    if (year.length === 2) {
      year = '20' + year;
    }
    
    return `${year}-${month}-${day}`;
  }
  
  return dateStr;
}

/**
 * 로스터 CSV를 파싱하여 구조화된 JSON으로 변환
 * @param csvText - CSV 형식의 텍스트
 * @returns 로스터 엔트리 배열
 */
function parseRosterCSV(csvText: string): RosterEntry[] {
  const lines = csvText.trim().split(/\r?\n/);
  const result: RosterEntry[] = [];
  
  if (lines.length < 2) {
    return result;
  }

  // 첫 번째 줄: 요일 헤더 (Week 1,,Sunday,,Monday,,...)
  const headerLine = parseCSVLine(lines[0]);
  
  // 두 번째 줄: 날짜 정보 (Date,1/4/2026,04/01/26,,05/01/26,,...)
  const dateLine = parseCSVLine(lines[1]);
  
  // 요일별 날짜 매핑 생성
  const dayDates: { [key: number]: string } = {};
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  // 헤더에서 요일 위치 찾기 및 날짜 매핑
  // 헤더: Week 1,,Sunday,,Monday,,...
  // 날짜: Date,1/4/2026,04/01/26,,05/01/26,,...
  // 요일이 헤더의 인덱스 i에 있으면, 날짜는 dateLine의 인덱스 i에 있음
  let dayIndex = 0;
  for (let i = 0; i < headerLine.length; i++) {
    const header = headerLine[i].trim();
    if (days.includes(header)) {
      // 같은 인덱스의 날짜 라인에서 날짜 가져오기
      const dateStr = dateLine[i]?.trim() || '';
      if (dateStr && dateStr !== 'Date') {
        dayDates[dayIndex] = normalizeDate(dateStr);
      }
      dayIndex++;
    }
  }
  
  // 디버깅: 날짜 매핑 확인
  console.log('Day dates mapping:', dayDates);
  console.log('Header line:', headerLine);
  console.log('Date line:', dateLine);

  // 스토어별 데이터 파싱
  let currentStore = '';
  let nameLine: string[] | null = null;
  let hoursLine: string[] | null = null;
  
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('Annual leave') || line.startsWith('Optometrist Name') || line.startsWith('Store Name') || line.includes('#REF!')) {
      continue;
    }
    
    const values = parseCSVLine(line);
    
    // 첫 번째 컬럼이 스토어 이름인 경우
    if (values[0] && values[0].trim() !== '' && values[0] !== 'Name' && values[0] !== 'Hours' && !values[0].startsWith('Week') && values[0] !== 'Date') {
      currentStore = values[0].trim();
      console.log('Found store:', currentStore);
      nameLine = null;
      hoursLine = null;
      continue;
    }
    
    // Name 라인인 경우
    if (values[1] === 'Name') {
      nameLine = values;
      console.log('Found Name line for store:', currentStore, 'Values:', values.slice(0, 10));
      continue;
    }
    
    // Hours 라인인 경우
    if (values[1] === 'Hours') {
      hoursLine = values;
      console.log('Found Hours line for store:', currentStore, 'Values:', values.slice(0, 10));
      
      // nameLine과 hoursLine이 모두 있으면 데이터 추출
      if (nameLine && hoursLine && currentStore) {
        // 각 요일별로 데이터 추출
        // 헤더 구조: Week 1,,Sunday,,Monday,,Tuesday,,...
        // Name 라인: Store,Name,Name1,,Name2,,Name3,,...
        // Hours 라인: ,Hours,Start1,End1,,Start2,End2,,...
        // 헤더에서 요일 위치를 찾아서 해당 위치의 Name과 Hours를 매핑
        
        let dayIndex = 0;
        for (let colIdx = 0; colIdx < headerLine.length; colIdx++) {
          const header = headerLine[colIdx].trim();
          if (days.includes(header)) {
            // 같은 인덱스에서 이름 가져오기
            const name = nameLine[colIdx]?.trim() || '';
            // Hours 라인에서는 시작시간과 종료시간이 연속으로 있음
            const startTime = hoursLine[colIdx]?.trim() || '';
            const endTime = hoursLine[colIdx + 1]?.trim() || '';
            const date = dayDates[dayIndex] || '';
            
            // 디버깅: 첫 번째 스토어만 상세 로그 출력
            if (result.length < 1) {
              console.log(`Processing ${header} (colIdx ${colIdx}):`, {
                name,
                startTime,
                endTime,
                date,
                store: currentStore,
                nameLineLength: nameLine.length,
                hoursLineLength: hoursLine.length,
              });
            }
            
            if (name && name !== '' && date && startTime && endTime) {
              result.push({
                date,
                store: currentStore,
                name,
                startTime,
                endTime,
              });
            }
            dayIndex++;
          }
        }
        
        console.log(`Extracted ${result.length} entries for store ${currentStore}`);
        nameLine = null;
        hoursLine = null;
      }
      continue;
    }
  }
  
  return result;
}

/**
 * 로스터 CSV 파일을 JSON으로 변환하는 API
 * GET /api/roster/input - 엔드포인트 확인용
 * POST /api/roster/input - CSV 데이터 변환
 * Body: { csv: "CSV 텍스트 내용" }
 * 
 * 반환 형식:
 * [
 *   {
 *     date: "2026-01-04",
 *     store: "Chatswood Chase 1",
 *     name: "Howie Yin",
 *     startTime: "10:00AM",
 *     endTime: "5:00PM"
 *   },
 *   ...
 * ]
 */
export async function GET(
  request: Request
): Promise<NextResponse<I1001Response<{ message: string; usage: string }>>> {
  return NextResponse.json(
    {
      message: "success",
      data: {
        message: "CSV to JSON API is ready",
        usage: "Send POST request with { csv: 'CSV text content' } to convert CSV to JSON",
      },
    },
    { status: 200 }
  );
}

export async function POST(
  request: Request
): Promise<NextResponse<I1001Response<RosterEntry[]>>> {
  try {
    const contentType = request.headers.get("content-type") || "";
    let csvText = "";

    // Content-Type에 따라 다르게 처리
    if (contentType.includes("application/json")) {
      try {
        const body = await request.json();
        csvText = body.csv || "";
      } catch (jsonError) {
        // JSON 파싱 실패 시 텍스트로 시도
        csvText = await request.text();
      }
    } else {
      // 텍스트/CSV 직접 전송
      csvText = await request.text();
    }

    if (!csvText || csvText.trim().length === 0) {
      return NextResponse.json(
        {
          message: "CSV 텍스트가 필요합니다. 요청 본문에 CSV 텍스트를 포함해주세요.",
        },
        { status: 400 }
      );
    }

    const rosterData = parseRosterCSV(csvText);

    return NextResponse.json(
      {
        message: "success",
        data: rosterData,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in CSV to JSON conversion:", error);
    return NextResponse.json(
      {
        message: "Internal server error",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}


