import { NextResponse } from "next/server";
import { I1001Response } from "@/types/api_response";
import { dbGet, getDB } from "@/utils/db/db";
import { withAxiomFlush } from "@/lib/axiom/withFlush";

/**
 * CHANGE_LOG 미처리 건수 (Optomate 반영 대기).
 * GET /api/roster/change-log-pending-count
 */
export async function GET(): Promise<NextResponse<I1001Response<{ count: number }>>> {
  return withAxiomFlush(async () => {
    try {
      const db = await getDB();
      const row = await dbGet<{ c: number }>(
        db,
        `SELECT COUNT(*) AS c FROM CHANGE_LOG`,
      );
      const count = row?.c ?? 0;
      return NextResponse.json({
        message: "success",
        data: { count },
      });
    } catch {
      return NextResponse.json(
        { message: "error", data: { count: 0 } },
        { status: 500 },
      );
    }
  });
}
