export interface PostEmailData {
    email: string
    "lastName": string
    "storeName": string
    "rosterDate": string
    "rosterStart": string
    "rosterEnd": string
    "storeTemplet": string
    "optomateId"?: string
    "optomatePw"?: string
}

export const postEmail = async (data: PostEmailData | undefined, isFirst: boolean) => {
    if(!data) return;
    
    console.log(`  📧 [EMAIL] Sending ${isFirst ? 'first-time' : 'existing'} user email`);
    console.log(`     └─ To: ${data.email}`);
    console.log(`     └─ Store: ${data.storeName}`);
    console.log(`     └─ Date: ${data.rosterDate}`);
    
    try {
        // 데이터 검증
        if (!data.email || !data.email.includes('@')) {
            throw new Error(`Invalid email address: ${data.email}`);
        }

        if (!data.lastName || !data.storeName || !data.rosterDate) {
            throw new Error("Missing required email data: lastName, storeName, or rosterDate");
        }

        const webhookUrl = isFirst ? process.env.MAKE_WEBHOOK_FIRST : process.env.MAKE_WEBHOOK_EXIST;
        
        if (!webhookUrl) {
            throw new Error(`Missing webhook URL for ${isFirst ? 'first' : 'existing'} user`);
        }

        console.log(`     └─ Webhook URL: ${webhookUrl}`);
        console.log(`     └─ Request Body:`, JSON.stringify(data, null, 2));

        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { 
                "content-type": "application/json" 
            },
            body: JSON.stringify(data),
        });

        console.log(`     └─ Response Status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`     └─ Error Response:`, errorText);
            throw new Error(`Email webhook request failed: ${response.status} ${response.statusText}`);
        }

        const responseText = await response.text();
        if (responseText) {
            try {
                const responseJson = JSON.parse(responseText);
                console.log(`     └─ Response Body:`, JSON.stringify(responseJson, null, 2));
            } catch {
                console.log(`     └─ Response Body:`, responseText);
            }
        }

        console.log(`  ✅ [EMAIL] Email sent successfully to ${data.email}\n`);
        return response;
    } catch (error) {
        console.error(`  ❌ [EMAIL] Error sending email to ${data.email}:`, error);
        throw error;
    }
}