import {createSecret} from "@/utils/crypto";
import {createLogger} from "@/lib/logger";

const logger = createLogger('IdentifierCount');

const createIdentifier = (g: string, s: string) => g[0]+s[0]

const identifierCountCache = new Map<string, number>();

export const checkIdentifierCount = async (givenName: string, surname: string) => {
    const cacheKey = `${givenName}_${surname}`;

    if (identifierCountCache.has(cacheKey)) {
        logger.debug("Using cached identifier count", { givenName, surname });
        return identifierCountCache.get(cacheKey);
    }

    logger.debug("Checking identifier count", { givenName, surname });
    
    try {
        if (!givenName || !surname) {
            throw new Error("Both givenName and surname are required");
        }

        const identifier = createIdentifier(givenName, surname);

        const apiUrl = process.env.OPTOMATE_API_URL;
        if (!apiUrl) {
            throw new Error("OPTOMATE_API_URL environment variable is not set");
        }

        const url = `${apiUrl}/Optometrists?$filter=contains(IDENTIFIER, '${identifier}')`;

        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                "authorization": createSecret(process.env.OPTOMATE_USERNAME!, process.env.OPTOMATE_PASSWORD!),
            }
        });

        if (!response.ok) {
            throw new Error(`Identifier count API request failed: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        const count = result?.value?.length ?? 0;
        
        logger.debug("Identifier count result", { identifier, count });
        identifierCountCache.set(cacheKey, count);
        return count;
    } catch (error) {
        logger.error("Error checking identifier count", { givenName, surname, error });
        throw error;
    }
}