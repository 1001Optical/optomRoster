import { NextResponse } from "next/server";
import {I1001Response, I1001RosterData} from "@/types/api_response";
import {checkIdentifierCount} from "@/lib/checkIdentifierCount";

export async function GET(): Promise<NextResponse<I1001Response<I1001RosterData[]>>>  {
    console.log("=== Roster Counter API Called ===");
    
    try {
        console.log("Checking identifier count for 'Junhee Cho'...");
        const result = await checkIdentifierCount("Junhee", "Cho");
        console.log(`Identifier count result: ${result}`);

        return NextResponse.json(
            {
                message: "success",
                data: { count: result }
            },
            {
                status: 200
            }
        );
    } catch (error) {
        console.error("Error in roster counter API:", error);
        return NextResponse.json(
            {
                message: "Internal server error",
                error: error instanceof Error ? error.message : "Unknown error"
            },
            {
                status: 500
            }
        );
    }
}