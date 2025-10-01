interface WebhookRequestBody {
    email: string
    "lastName": string
    "storeName": string
    "rosterDate": string
    "rosterStart": string
    "rosterEnd": string
    "storeTemplate": string
    "optomateId"?: string
    "optomatePw"?: string
}

export const postEmail = async (data: WebhookRequestBody, isFirst: boolean) => {
    console.log(`=== Sending Email ===`);
    console.log(`Email: ${data.email}, isFirst: ${isFirst}`);
    console.log(`Store: ${data.storeName}, Date: ${data.rosterDate}`);
    
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

        console.log(`Sending to webhook: ${webhookUrl}`);

        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { 
                "content-type": "application/json" 
            },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            throw new Error(`Email webhook request failed: ${response.status} ${response.statusText}`);
        }

        console.log(`Email sent successfully to ${data.email}`);
        return response;
    } catch (error) {
        console.error(`Error sending email to ${data.email}:`, error);
        throw error;
    }
}