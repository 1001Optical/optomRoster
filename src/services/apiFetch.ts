const apiFetch = async (path: string, init?: RequestInit) => {
    console.log(`=== API Fetch ===`);
    console.log(`Path: ${path}`);
    
    try {
        if (!path) {
            throw new Error("API path is required");
        }

        const response = await fetch(path, init);
        
        if (!response.ok) {
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

export { apiFetch }