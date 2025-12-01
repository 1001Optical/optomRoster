import { NextResponse } from "next/server";
import {I1001Response} from "@/types/api_response";
import {RetailMap} from "@/data/stores";
import {createSecret} from "@/utils/crypto";

export async function GET(request: Request): Promise<NextResponse<I1001Response<{ staff: number }>>>  {
    try {
        const secret = process.env.EMPLOYMENTHERO_SECRET;
        const server_url = process.env.EMPLOYMENTHERO_API_URL;

        if (!secret || !server_url) {
            throw new Error("Missing required environment variables: EMPLOYMENTHERO_SECRET or EMPLOYMENTHERO_API_URL");
        }

        // 쿼리 파라미터 읽기
        const { searchParams } = new URL(request.url);
        const date = searchParams.get("date");
        const store = searchParams.get("store");

        if(!date) {
            console.error("Missing required parameters: from and to dates");
            return NextResponse.json(
                {
                    message: "Missing required parameters: from and to dates",
                },
                { status: 400 }
            );
        }

        const locationId = RetailMap.find(v => v.OptCode === store)?.id

        if(!locationId) {
            console.error("Wrong type parameter: store");
            return NextResponse.json(
                {
                    message: "Wrong type parameter: store",
                },
                { status: 400 }
            );
        }

        const api = `${server_url}/rostershift?filter.fromDate=${date}&filter.toDate=${date}&filter.locationId=${locationId}`
        console.log(api)
        const response = await fetch(api, {
            method: "GET",
            headers: {
                "Authorization": createSecret(secret),
                "content-type": "application/json"
            },
        })

        if (!response.ok) {
            throw new Error(`Employment Hero API request failed: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();

        return NextResponse.json({
            message: 'Success',
            data: { staff: result.length }
        });
    } catch (error) {
        console.error("Error in roster getList API:", error);
        return NextResponse.json(
            {
                message: "Internal server error",
                error: error instanceof Error ? error.message : "Unknown error"
            },
            { status: 500 }
        );
    }
}