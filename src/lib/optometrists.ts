import {apiFetch} from "@/services/apiFetch";

interface IResult { id: number, workHistory: string[] }

type SearchOptomIdType = (firstName: string, lastName: string, email?: string) => Promise<IResult | undefined>;

const optomCache = new Map<string, IResult>();

export const searchOptomId: SearchOptomIdType = async (firstName, lastName, email) => {
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

        // 일단 firstName, lastName으로 검색.
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
                optomCache.set(cacheKey, {id: data.optomId, workHistory: data.workHistory});
            }else if(!!email){

                const result = await apiFetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ email })
                });
            }

            return data ? {id: data.optomId, workHistory: data.workHistory} : undefined;
        }
    } catch (error) {
        console.error(`Error searching for optometrist ID for ${firstName} ${lastName}:`, error);
        throw error;
    }
}

type AddWorkHistory = (id: number, branch: string) => Promise<IResult | undefined>;

export const addWorkHistory: AddWorkHistory = async (id, branch) => {
    console.log(`=== Post Work History ===`);
    console.log(`ID: `);

    try {
        if (!id || !branch) {
            throw new Error("id, branch is required");
        }

        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        if (!apiUrl) {
            throw new Error("NEXT_PUBLIC_API_BASE_URL environment variable is not set");
        }

        // search에 값 넣어 달라고 해야됨
        const url = `${apiUrl}/api/optometrists/optomWorkHistory`;
        console.log(`Fetching optometrists from: ${url}`);

        const result = await apiFetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                optomId: id,
                workedHistory: branch
            })
        });
        return result.success
    } catch (error) {
        console.error(`ERROR AddWorkHistory:`, error);
        throw error;
    }
}