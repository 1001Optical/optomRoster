import { NextResponse } from "next/server";
import { EmploymentHeroClient } from "@/lib/api-client/EmploymentHeroClient";

interface EHShift {
    employeeId: number;
    employeeName: string;
}

export interface EHEmployeeOption {
    id: number;
    name: string; // EH에 등록된 이름
}

// GET /api/employee-mapping/eh-employees — EH 직원 목록 (드롭다운용)
// /employee + 로스터 시프트 두 소스 합침
export async function GET() {
    try {
        const today = new Date();
        const from = new Date(today);
        from.setDate(today.getDate() - 60);
        const to = new Date(today);
        to.setDate(today.getDate() + 60);
        const fmt = (d: Date) => d.toISOString().split("T")[0];

        const [empRes, rosterRes] = await Promise.all([
            EmploymentHeroClient<{ firstName: string; id: number }[]>({ path: "/employee" }),
            EmploymentHeroClient<EHShift[]>({
                path: `/rostershift?filter.SelectAllRoles=true&filter.ShiftStatuses=published&filter.fromDate=${fmt(from)}&filter.toDate=${fmt(to)}`,
            }),
        ]);

        const seen = new Map<number, string>();

        // /employee 목록
        if (empRes.ok && Array.isArray(empRes.data)) {
            for (const e of empRes.data) {
                if (e.id && e.firstName) seen.set(e.id, e.firstName);
            }
        }

        // 로스터 시프트 직원
        if (rosterRes.ok && Array.isArray(rosterRes.data)) {
            for (const s of rosterRes.data) {
                if (s.employeeId && s.employeeName && !seen.has(s.employeeId)) {
                    seen.set(s.employeeId, s.employeeName);
                }
            }
        }

        const employees: EHEmployeeOption[] = [...seen.entries()]
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        return NextResponse.json({ data: employees });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}
