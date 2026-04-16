import {createSecret} from "@/utils/crypto";
import { createLogger } from "@/lib/logger";

const logger = createLogger('EmployeeInfo');
const secret = process.env.EMPLOYMENTHERO_SECRET

export interface EmployeeInfo {
    firstName: string;
    surname: string;
    emailAddress: string;
    name?: string;
}

export const getEmployeeInfo = async (id: number, retryCount = 0): Promise<EmployeeInfo> => {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000 * (retryCount + 1);

    if (retryCount === 0) {
        logger.debug(`Fetching info`, { employeeId: id });
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

        const response = await fetch(url, {
            headers: {
                "Authorization": createSecret(secret)
            }
        });

        if (response.status === 429 && retryCount < MAX_RETRIES) {
            logger.warn(`Rate limit hit, retrying`, { employeeId: id, delay: RETRY_DELAY, attempt: retryCount + 1, maxRetries: MAX_RETRIES });
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            return getEmployeeInfo(id, retryCount + 1);
        }

        if (!response.ok) {
            logger.error(`Request failed`, { employeeId: id, status: response.status, statusText: response.statusText });
            throw new Error(`Employee info API request failed: ${response.status} ${response.statusText}`);
        }

        const employeeInfo = await response.json();
        logger.debug(`Retrieved`, { employeeId: id, hasEmail: !!employeeInfo?.emailAddress, hasName: !!employeeInfo?.name });

        return employeeInfo;
    } catch (error) {
        if (retryCount >= MAX_RETRIES) {
            logger.error(`Failed after retries`, { employeeId: id, retries: MAX_RETRIES, error: String(error) });
            throw error;
        }
        if (error instanceof Error && !error.message.includes('Invalid') && !error.message.includes('not set')) {
            logger.warn(`Retrying`, { employeeId: id, attempt: retryCount + 1, maxRetries: MAX_RETRIES });
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            return getEmployeeInfo(id, retryCount + 1);
        }
        throw error;
    }
}
