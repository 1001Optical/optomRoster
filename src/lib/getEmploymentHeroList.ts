import {getDB} from "@/utils/db/db";
import {createSecret} from "@/utils/crypto";
import {optomData} from "@/types/types";
import {Shift} from "@/types/employment_hero_response";
import {syncRoster} from "@/lib/syncRoster";
import {sendChangeToOptomateAPI} from "@/lib/changeProcessor";

export const getEmploymentHeroList: (fromDate: string, toDate: string) => Promise<optomData[]> = async (fromDate, toDate) => {
    console.log(`=== Fetching Employment Hero List ===`);
    console.log(`Date range: ${fromDate} to ${toDate}`);
    
    try {
        const db = await getDB();
        console.log("Database connection established");

        const secret = process.env.EMPLOYMENTHERO_SECRET;
        const server_url = process.env.EMPLOYMENTHERO_API_URL;
        
        if (!secret || !server_url) {
            throw new Error("Missing required environment variables: EMPLOYMENTHERO_SECRET or EMPLOYMENTHERO_API_URL");
        }

        console.log(`Fetching from Employment Hero API: ${server_url}/rostershift`);
        const response = await fetch(
            `${server_url}/rostershift?filter.fromDate=${fromDate}&filter.toDate=${toDate}`,
            {
                headers: {
                    "Authorization": createSecret(secret)
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Employment Hero API request failed: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        console.log(`Received ${Array.isArray(result) ? result.length : 'non-array'} records from Employment Hero API`);

        const returnData: optomData[] = [];

        // Shift[] 형태의 API 응답을 OptomData[] 형태로 변환
        const convertedData: optomData[] = Array.isArray(result) ? result.map((shift: Shift, index: number) => {
            try {
                if (!shift.employeeName) {
                    console.warn(`Shift at index ${index} missing employeeName:`, shift);
                    return [];
                }

                const name = shift.employeeName;
                const nameParts = name.split(" ");

                if (nameParts.length < 2) {
                    console.warn(`Invalid employee name format at index ${index}: ${name}`);
                    return [];
                }

                const [firstname, type] = nameParts[0].split("_");

                const convertedShift = {
                    id: shift.id,
                    employeeId: shift.employeeId,
                    employeeName: `${firstname} ${nameParts[1]}`,
                    locationId: shift.locationId,
                    locationName: shift.locationName,
                    startTime: shift.startTime,
                    endTime: shift.endTime,
                    isLocum: type === "Locum" ? 1 : 0,
                    breaks: shift.breaks?.map(breakItem => ({
                        id: breakItem.id,
                        startTime: breakItem.startTime,
                        endTime: breakItem.endTime,
                        isPaidBreak: breakItem.isPaidBreak ? 1 : 0
                    }))
                };

                console.log(`Converted shift ${index + 1}: ${convertedShift.employeeName} (${convertedShift.isLocum ? 'Locum' : 'Regular'})`);
                return convertedShift;
            } catch (conversionError) {
                console.error(`Error converting shift at index ${index}:`, conversionError, shift);
                return [];
            }
        }).filter(Boolean) : [];

        console.log(`Successfully converted ${convertedData.length} shifts`);
        
        console.log("Starting roster sync...");
        await syncRoster(db, convertedData, {start: fromDate, end: toDate});
        console.log("Roster sync completed");
        
        console.log("Starting change processing...");
        await sendChangeToOptomateAPI();
        console.log("Change processing completed");

        console.log(`=== Employment Hero List fetch completed ===`);
        return returnData;
    } catch (error) {
        console.error("Error in getEmploymentHeroList:", error);
        throw error;
    }
}