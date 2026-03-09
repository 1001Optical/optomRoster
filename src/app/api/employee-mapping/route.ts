import { NextResponse } from "next/server";
import { getDB, dbAll, dbExecute } from "@/utils/db/db";

export interface EmployeeMapping {
    sheet_name: string;
    employee_id: number;
    employee_name: string;
    updated_at: string;
}

// GET /api/employee-mapping — 전체 매핑 목록
export async function GET() {
    try {
        const db = await getDB();
        const rows = await dbAll<EmployeeMapping>(
            db,
            "SELECT sheet_name, employee_id, employee_name, updated_at FROM employee_name_mapping ORDER BY sheet_name"
        );
        return NextResponse.json({ data: rows });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}

// POST /api/employee-mapping — 매핑 저장 (upsert)
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { sheet_name, employee_id, employee_name } = body;

        if (!sheet_name || !employee_id || !employee_name) {
            return NextResponse.json(
                { error: "sheet_name, employee_id, employee_name are required" },
                { status: 400 }
            );
        }

        const db = await getDB();
        await dbExecute(
            db,
            `INSERT INTO employee_name_mapping (sheet_name, employee_id, employee_name, updated_at)
             VALUES (?, ?, ?, datetime('now'))
             ON CONFLICT(sheet_name) DO UPDATE SET
                 employee_id   = excluded.employee_id,
                 employee_name = excluded.employee_name,
                 updated_at    = excluded.updated_at`,
            [sheet_name, employee_id, employee_name]
        );

        return NextResponse.json({ ok: true });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}

// DELETE /api/employee-mapping — 매핑 삭제
export async function DELETE(request: Request) {
    try {
        const { sheet_name } = await request.json();
        if (!sheet_name) {
            return NextResponse.json({ error: "sheet_name is required" }, { status: 400 });
        }

        const db = await getDB();
        await dbExecute(db, "DELETE FROM employee_name_mapping WHERE sheet_name = ?", [sheet_name]);
        return NextResponse.json({ ok: true });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}
