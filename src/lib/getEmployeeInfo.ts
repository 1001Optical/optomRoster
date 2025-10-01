import {createSecret} from "@/utils/crypto";

const secret = process.env.EMPLOYMENTHERO_SECRET

export const getEmployeeInfo = async (id: number) => {
    console.log(`=== Fetching Employee Info ===`);
    console.log(`Employee ID: ${id}`);
    
    try {
        if (!id || id <= 0) {
            throw new Error(`Invalid employee ID: ${id}`);
        }

        const apiUrl = process.env.EMPLOYMENTHERO_API_URL;
        if (!apiUrl) {
            throw new Error("EMPLOYMENTHERO_API_URL environment variable is not set");
        }

        if (!secret) {
            throw new Error("EMPLOYMENTHERO_SECRET environment variable is not set");
        }

        const url = `${apiUrl}/employee/unstructured/${id}`;
        console.log(`Fetching from: ${url}`);

        const response = await fetch(url, {
            headers: {
                "Authorization": createSecret(secret)
            }
        });

        if (!response.ok) {
            throw new Error(`Employee info API request failed: ${response.status} ${response.statusText}`);
        }

        const employeeInfo = await response.json();
        console.log(`Employee info retrieved for ID ${id}:`, {
            hasEmail: !!employeeInfo?.emailAddress,
            hasName: !!employeeInfo?.name
        });

        return employeeInfo;
    } catch (error) {
        console.error(`Error fetching employee info for ID ${id}:`, error);
        throw error;
    }
}