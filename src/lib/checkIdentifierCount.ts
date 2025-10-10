import {createSecret} from "@/utils/crypto";

const createIdentifier = (g: string, s: string) => g[0]+s[0]

const identifierCountCache = new Map<string, number>();

export const checkIdentifierCount = async (givenName: string, surname: string) => {
    const cacheKey = `${givenName}_${surname}`;
    
    if (identifierCountCache.has(cacheKey)) {
        console.log(`Using cached identifier count for ${givenName} ${surname}`);
        return identifierCountCache.get(cacheKey);
    }

    console.log(`=== Checking Identifier Count ===`);
    console.log(`Given name: ${givenName}, Surname: ${surname}`);
    
    try {
        if (!givenName || !surname) {
            throw new Error("Both givenName and surname are required");
        }

        const identifier = createIdentifier(givenName, surname);
        console.log(`Generated identifier: ${identifier}`);

        const apiUrl = process.env.OPTOMATE_API_URL;
        if (!apiUrl) {
            throw new Error("OPTOMATE_API_URL environment variable is not set");
        }

        const url = `${apiUrl}/Optometrists?$filter=contains(IDENTIFIER, '${identifier}')`;
        console.log(`Checking identifier count at: ${url}`);

        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                "authorization": createSecret("1001_HO_JH", "10011001"),
            }
        });

        if (!response.ok) {
            throw new Error(`Identifier count API request failed: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        const count = result?.value?.length ?? 0;
        
        console.log(`Found ${count} existing identifiers starting with '${identifier}'`);
        identifierCountCache.set(cacheKey, count);
        return count;
    } catch (error) {
        console.error(`Error checking identifier count for ${givenName} ${surname}:`, error);
        throw error;
    }
}