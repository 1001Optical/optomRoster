import {apiFetch} from "@/services/apiFetch";

type SearchOptomIdType = (fullName: string) => Promise<number | undefined>;

export const searchOptomId: SearchOptomIdType = async (fullName) => {
    console.log(`=== Searching Optomate ID ===`);
    console.log(`Full name: ${fullName}`);
    
    try {
        if (!fullName || fullName.trim().length === 0) {
            throw new Error("Full name is required");
        }

        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        if (!apiUrl) {
            throw new Error("NEXT_PUBLIC_API_BASE_URL environment variable is not set");
        }

        const url = `${apiUrl}/api/optometrists/search`;
        console.log(`Fetching optometrists from: ${url}`);

        const response = await apiFetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                firstName: fullName.split(" ")[0],
                lastName: fullName.split(" ")[1]
            })
        });
        if(response.success){
            const {data} = response
            return data ? data.optomId : undefined;
        }
    } catch (error) {
        console.error(`Error searching for optometrist ID for ${fullName}:`, error);
        throw error;
    }
}