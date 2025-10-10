import { NextResponse } from "next/server";
import { I1001Response } from "@/types/api_response";
import { checkIdentifierCount } from "@/lib/checkIdentifierCount";

interface ICounter {
    count: number
}

export async function GET(): Promise<NextResponse<I1001Response<ICounter>>>  {
    try {
        const result = await checkIdentifierCount("Junhee", "Cho");

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