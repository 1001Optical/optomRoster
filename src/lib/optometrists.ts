import {apiFetch} from "@/services/apiFetch";

type SearchOptomIdType = (firstName: string, lastName: string) => Promise<number | undefined>;

const optomCache = new Map<string, number>();

export const searchOptomId: SearchOptomIdType = async (firstName, lastName) => {
    const cacheKey = `${firstName}_${lastName}`;
    console.log(`=== Searching Optomate ID ===`);
    console.log(`Full name: ${firstName} ${lastName}`);

    if (optomCache.has(cacheKey)) {
        console.log(`Using cached optom ID for ${firstName} ${lastName}`);
        return optomCache.get(cacheKey);
    }
    
    try {
        if (!firstName || !lastName) {
            throw new Error("Name is required");
        }

        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        if (!apiUrl) {
            throw new Error("NEXT_PUBLIC_API_BASE_URL environment variable is not set");
        }

        const url = `${apiUrl}/api/optometrists/search`;
        console.log(`Fetching optometrists from: ${url}`);

        const result = await apiFetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                firstName: firstName,
                lastName: lastName
            })
        });
        if(result.success){
            const {data} = result

            if (data?.optomId) {
                optomCache.set(cacheKey, data.optomId);
            }

            return data ? data.optomId : undefined;
        }
    } catch (error) {
        console.error(`Error searching for optometrist ID for ${firstName} ${lastName}:`, error);
        throw error;
    }
}