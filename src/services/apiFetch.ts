const apiFetch = async (path: string, init?: RequestInit) => {
    console.log(`=== API Fetch ===`);
    console.log(`Path: ${path}`);
    console.log(`Method: ${init?.method ?? "GET"}`);
    
    try {
        if (!path) {
            throw new Error("API path is required");
        }

        const response = await fetch(path, init);
        const contentType = response.headers.get("content-type") ?? "";
        let data: unknown = undefined;

        if (contentType.includes("application/json")) {
            try {
                data = await response.json();
            } catch (parseError) {
                console.error(`Failed to parse JSON response for ${path}:`, parseError);
            }
        } else {
            data = await safeReadText(response);
        }

        if (!response.ok) {
            console.error(`API request failed: ${response.status} ${response.statusText} (${path})`);
            if (data) {
                console.error(`Response body:`, data);
            }
            if (data && typeof data === "object") {
                return data;
            }
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }

        if (!data || typeof data !== "object") {
            throw new Error(`API response was not JSON for ${path}`);
        }
        console.log(`API fetch successful for ${path}`);
        
        return data;
    } catch (error) {
        console.error(`Error in API fetch for ${path}:`, error);
        throw error;
    }
}

async function safeReadText(res: Response): Promise<string | undefined> {
    try {
        return await res.text();
    } catch {
        return undefined;
    }
}

export { apiFetch }
