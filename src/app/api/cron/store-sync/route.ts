import { NextResponse } from "next/server";
import { I1001Response } from "@/types/api_response";
import { getEmploymentHeroList } from "@/lib/getEmploymentHeroList";
import { addDays } from "date-fns";
import { toDateOnly } from "@/utils/time";

interface CronStoreSyncResponse {
    store: string;
    from: string;
    to: string;
    shifts: number;
    slotMismatches: number;
    appointmentConflicts: number;
}

export async function GET(request: Request): Promise<NextResponse<I1001Response<CronStoreSyncResponse>>> {
    try {
        const { searchParams } = new URL(request.url);
        const store = searchParams.get("store");

        if (!store) {
            return NextResponse.json(
                { message: "Missing required parameter: store" },
                { status: 400 }
            );
        }

        const today = new Date();
        const fromDate = toDateOnly(today);
        const toDate = toDateOnly(addDays(today, 56));

        const result = await getEmploymentHeroList(
            fromDate,
            toDate,
            store,
            true,  // isScheduler
            true   // skipEmail
        );

        return NextResponse.json(
            {
                message: "success",
                data: {
                    store,
                    from: fromDate,
                    to: toDate,
                    shifts: result.data.length,
                    slotMismatches: result.slotMismatches.length,
                    appointmentConflicts: result.appointmentConflicts.length,
                },
            },
            { status: 200 }
        );
    } catch (error) {
        console.error("Error in cron store sync API:", error);
        return NextResponse.json(
            {
                message: "Internal server error",
                error: error instanceof Error ? error.message : "Unknown error",
            },
            { status: 500 }
        );
    }
}
