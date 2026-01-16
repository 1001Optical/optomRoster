const apiFetch = async (path: string, init?: RequestInit) => {
    console.log(`=== API Fetch ===`);
    console.log(`Path: ${path}`);
    console.log(`Method: ${init?.method ?? "GET"}`);
    
    try {
        if (!path) {
            throw new Error("API path is required");
        }

        const response = await fetch(path, init);
        
        if (!response.ok) {
            const bodyText = await safeReadText(response);
            console.error(`API request failed: ${response.status} ${response.statusText} (${path})`);
            if (bodyText) {
                console.error(`Response body: ${bodyText}`);
            }
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
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