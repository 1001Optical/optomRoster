import { EmploymentHeroClient } from "@/lib/api-client/EmploymentHeroClient";
import { getDB, dbAll } from "@/utils/db/db";

interface DBMapping {
    sheet_name: string;
    employee_id: number;
}

interface EHEmployee {
    id: number;
    firstName: string;   // "Xibei Charlotte Li", "Jenny_Locum Kim" 등
    lastName?: string;
    name?: string;
    emailAddress?: string;
}

interface EHShift {
    employeeId: number;
    employeeName: string;
}

/**
 * /employee 엔드포인트에서 직원 목록 가져오기 (정규직 ~100명)
 */
async function fetchEmployeeList(): Promise<EHEmployee[]> {
    const res = await EmploymentHeroClient<{ data: EHEmployee[] } | EHEmployee[]>({
        path: "/employee",
    });
    if (!res.ok || !res.data) return [];
    if (Array.isArray(res.data)) return res.data;
    if ("data" in res.data && Array.isArray(res.data.data)) return res.data.data;
    return [];
}

/**
 * 최근 로스터 시프트에서 직원 이름→ID 추출 (Locum 포함)
 * /employee에 나오지 않는 직원들도 여기에 있음
 */
async function fetchEmployeesFromRoster(): Promise<EHEmployee[]> {
    const today = new Date();
    const from = new Date(today);
    from.setDate(today.getDate() - 60); // 2개월치
    const to = new Date(today);
    to.setDate(today.getDate() + 60);

    const fmt = (d: Date) => d.toISOString().split("T")[0];

    const res = await EmploymentHeroClient<EHShift[]>({
        path: `/rostershift?filter.SelectAllRoles=true&filter.ShiftStatuses=published&filter.fromDate=${fmt(from)}&filter.toDate=${fmt(to)}`,
    });

    if (!res.ok || !Array.isArray(res.data)) return [];

    // 고유 직원만 추출 (employeeId 기준 중복 제거)
    const seen = new Map<number, EHEmployee>();
    for (const shift of res.data) {
        if (shift.employeeId && shift.employeeName && !seen.has(shift.employeeId)) {
            seen.set(shift.employeeId, { id: shift.employeeId, firstName: shift.employeeName });
        }
    }
    return [...seen.values()];
}

/**
 * 이름 문자열 정규화
 */
function normalizeName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * EH 직원 이름에서 매칭 후보 추출
 * "Xibei Charlotte Li" → ["xibei charlotte li", "xibei", "charlotte", "li"]
 * "Jenny_Locum Kim"    → ["jenny kim", "jenny", "kim"]
 */
function getEHNameCandidates(emp: EHEmployee): string[] {
    const rawFirst = (emp.firstName ?? "").split("_")[0].trim();
    const rawLast = (emp.lastName ?? "").split("_")[0].trim();

    const candidates = new Set<string>();

    // firstName 전체
    candidates.add(normalizeName(rawFirst));

    // firstName의 모든 단어 개별 추가 ("Xibei Charlotte" → "xibei", "charlotte")
    for (const word of rawFirst.split(" ")) {
        if (word) candidates.add(normalizeName(word));
    }

    // firstName + lastName 조합
    if (rawLast) {
        candidates.add(normalizeName(`${rawFirst} ${rawLast}`));
        candidates.add(normalizeName(rawLast));
    }

    // name 필드
    if (emp.name) {
        candidates.add(normalizeName(emp.name.split("_")[0]));
    }

    return [...candidates].filter(Boolean);
}

/**
 * 시트 이름 목록 → { name: employeeId } 매핑
 * 1) DB 커스텀 매핑 우선
 * 2) EH /employee 목록 (정규직)
 * 3) EH 로스터 시프트 (Locum 포함)
 */
export async function resolveEmployeeNames(
    names: string[]
): Promise<Map<string, number | null>> {
    const uniqueNames = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    const result = new Map<string, number | null>();

    // 1. DB 커스텀 매핑 먼저 적용
    let needsEHLookup = uniqueNames;
    try {
        const db = await getDB();
        const dbMappings = await dbAll<DBMapping>(
            db,
            "SELECT sheet_name, employee_id FROM employee_name_mapping"
        );
        const dbMap = new Map(dbMappings.map((r) => [r.sheet_name.trim().toLowerCase(), r.employee_id]));

        const notInDB: string[] = [];
        for (const name of uniqueNames) {
            const mapped = dbMap.get(name.trim().toLowerCase());
            if (mapped != null) {
                result.set(name, mapped);
                console.log(`[RESOLVE] ✅ "${name}" → employeeId ${mapped} (DB mapping)`);
            } else {
                notInDB.push(name);
            }
        }
        needsEHLookup = notInDB;
    } catch (e) {
        console.warn("[RESOLVE] DB mapping lookup failed:", e);
    }

    if (needsEHLookup.length === 0) return result;

    // 2. EH API로 나머지 이름 조회
    console.log(`[RESOLVE] Looking up ${needsEHLookup.length} employee name(s) from EH...`);

    const [empList, rosterList] = await Promise.all([
        fetchEmployeeList(),
        fetchEmployeesFromRoster(),
    ]);

    // 로스터가 더 정확하므로 뒤에 합쳐서 덮어씌우기 (id 기준 중복 제거)
    const seen = new Map<number, EHEmployee>();
    for (const e of [...empList, ...rosterList]) seen.set(e.id, e);
    const employees = [...seen.values()];

    console.log(`[RESOLVE] Sources: /employee=${empList.length}, roster=${rosterList.length}, total unique=${employees.length}`);

    for (const name of needsEHLookup) {
        const normalized = normalizeName(name);

        const match = employees.find((emp) => {
            const candidates = getEHNameCandidates(emp);
            return candidates.includes(normalized);
        });

        const resolvedId = match ? match.id : null;
        result.set(name, resolvedId);

        if (resolvedId) {
            console.log(`[RESOLVE] ✅ "${name}" → employeeId ${resolvedId} ("${match!.firstName}")`);
        } else {
            console.warn(`[RESOLVE] ❌ "${name}" → not found in EH`);
        }
    }

    return result;
}
