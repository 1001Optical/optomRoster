import { NextResponse } from "next/server";
import { I1001Response } from "@/types/api_response";
import { dbGet, getDB } from "@/utils/db/db";
import { sendChangeToOptomateAPI } from "@/lib/changeProcessor";
import { createLogger } from "@/lib/logger";
import { withAxiomFlush } from "@/lib/axiom/withFlush";

const logger = createLogger("ReplayChangeLog");

export interface ReplayChangeLogData {
  processed: boolean;
  pendingCount: number;
  slotMismatchesCount: number;
  appointmentConflictsCount: number;
}

/**
 * EH 없이 CHANGE_LOG만 Optomate(1001 API)로 재전송합니다.
 * Vercel Cron: 매시 정각 (vercel.json).
 *
 * GET /api/cron/replay-change-log
 */
export async function GET(): Promise<NextResponse<I1001Response<ReplayChangeLogData>>> {
  return withAxiomFlush(async () => {
    try {
      const db = await getDB();

      const row = await dbGet<{ c: number }>(
        db,
        `SELECT COUNT(*) AS c FROM CHANGE_LOG`,
      );
      const pendingCount = row?.c ?? 0;

      if (pendingCount === 0) {
        logger.info(`CHANGE_LOG replay skipped — queue empty`);
        return NextResponse.json({
          message: "success",
          data: {
            processed: false,
            pendingCount: 0,
            slotMismatchesCount: 0,
            appointmentConflictsCount: 0,
          },
        });
      }

      logger.info(`CHANGE_LOG replay starting`, { pendingCount });

      const { slotMismatches, appointmentConflicts } =
        await sendChangeToOptomateAPI();

      logger.info(`CHANGE_LOG replay finished`, {
        pendingCountBefore: pendingCount,
        slotMismatches: slotMismatches.length,
        appointmentConflicts: appointmentConflicts.length,
      });

      return NextResponse.json({
        message: "success",
        data: {
          processed: true,
          pendingCount,
          slotMismatchesCount: slotMismatches.length,
          appointmentConflictsCount: appointmentConflicts.length,
        },
      });
    } catch (error) {
      logger.error(`CHANGE_LOG replay failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        {
          message: "Internal server error",
          error: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 },
      );
    }
  });
}
