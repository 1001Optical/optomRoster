import {createSecret} from "@/utils/crypto";

const secret = process.env.EMPLOYMENTHERO_SECRET

export const getEmployeeInfo = async (id: number, retryCount = 0): Promise<any> => {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000 * (retryCount + 1); // Exponential backoff: 1s, 2s, 3s
    
    if (retryCount === 0) {
        console.log(`  🔍 [EMPLOYEE INFO] Fetching info for employee ID: ${id}`);
    }
    
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
        if (retryCount === 0) {
            console.log(`     └─ URL: ${url}`);
        }

        const response = await fetch(url, {
            headers: {
                "Authorization": createSecret(secret)
            }
        });

        // 429 Rate Limit 에러 시 재시도
        if (response.status === 429 && retryCount < MAX_RETRIES) {
            console.warn(`     └─ ⚠️  Rate limit hit, retrying in ${RETRY_DELAY}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            return getEmployeeInfo(id, retryCount + 1);
        }

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`     └─ ❌ Request failed: ${response.status} ${response.statusText}`);
            if (errorText) {
                console.error(`     └─ Error response:`, errorText);
            }
            throw new Error(`Employee info API request failed: ${response.status} ${response.statusText}`);
        }

        const employeeInfo = await response.json();
        console.log(`     └─ ✅ Retrieved - Email: ${employeeInfo?.emailAddress ? 'Yes' : 'No'}, Name: ${employeeInfo?.name ? 'Yes' : 'No'}`);

        return employeeInfo;
    } catch (error) {
        // 최대 재시도 횟수 초과 시 에러 throw
        if (retryCount >= MAX_RETRIES) {
            console.error(`     └─ ❌ Failed after ${MAX_RETRIES} retries:`, error);
            throw error;
        }
        // 네트워크 에러 등은 재시도
        if (error instanceof Error && !error.message.includes('Invalid') && !error.message.includes('not set')) {
            console.warn(`     └─ ⚠️  Retrying (attempt ${retryCount + 1}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            return getEmployeeInfo(id, retryCount + 1);
        }
        throw error;
    }
}