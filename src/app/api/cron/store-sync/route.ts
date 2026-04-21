import { NextResponse } from "next/server";
import { addDays, format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { getEmploymentHeroList } from "@/lib/getEmploymentHeroList";
import { OptomMap } from "@/data/stores";
import { withAxiomFlush } from "@/lib/axiom/withFlush";
import { createLogger } from "@/lib/logger";
import { I1001Response } from "@/types/api_response";

const logger = createLogger("StoreSync");

/** Vercel/Next serverless default is too short for 56-day EH + Optomate sync. */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const SYDNEY_TZ = "Australia/Sydney";

export interface StoreSyncData {
  store: string;
  fromDate: string;
  toDate: string;
  recordCount: number;
  slotMismatchesCount: number;
  appointmentConflictsCount: number;
}

/**
 * Vercel Cron: one store per schedule (see vercel.json).
 * GET /api/cron/store-sync?store=EMP
 */
export async function GET(
  request: Request,
): Promise<NextResponse<I1001Response<StoreSyncData>>> {
  return withAxiomFlush(async () => {
    try {
      const { searchParams } = new URL(request.url);
      const raw = searchParams.get("store");
      if (!raw?.trim()) {
        return NextResponse.json(
          { message: "Missing store query parameter" },
          { status: 400 },
        );
      }
      const store = raw.trim().toUpperCase();
      if (!OptomMap.some((v) => v.OptCode === store)) {
        return NextResponse.json(
          { message: `Unknown store: ${raw}` },
          { status: 400 },
        );
      }

      const zonedNow = toZonedTime(new Date(), SYDNEY_TZ);
      const fromDate = format(zonedNow, "yyyy-MM-dd");
      const toDate = format(addDays(zonedNow, 56), "yyyy-MM-dd");

      logger.info(`Cron store sync starting`, { store, fromDate, toDate });

      const result = await getEmploymentHeroList(
        fromDate,
        toDate,
        store,
        true,
        true,
        null,
      );

      logger.info(`Cron store sync finished`, {
        store,
        recordCount: result.data.length,
        slotMismatches: result.slotMismatches.length,
        appointmentConflicts: result.appointmentConflicts.length,
      });

      return NextResponse.json({
        message: "success",
        data: {
          store,
          fromDate,
          toDate,
          recordCount: result.data.length,
          slotMismatchesCount: result.slotMismatches.length,
          appointmentConflictsCount: result.appointmentConflicts.length,
        },
      });
    } catch (error) {
      logger.error(`Store sync cron failed`, {
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
