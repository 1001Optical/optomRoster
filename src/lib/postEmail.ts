import { createLogger, maskEmail } from "@/lib/logger";
import { getDB, dbExecute } from "@/utils/db/db";

const logger = createLogger('PostEmail');

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

/**
 * EMAIL_QUEUE 테이블에 이메일 발송 요청을 큐잉합니다.
 * 실제 발송은 /api/cron/email-retry 크론에서 처리됩니다.
 */
export const queueEmail = async (data: PostEmailData, isFirst: boolean): Promise<void> => {
    const db = await getDB();
    await dbExecute(
        db,
        `INSERT INTO EMAIL_QUEUE (webhookType, payload, status, retryCount, nextRetryAt)
         VALUES (?, ?, 'pending', 0, datetime('now'))`,
        [isFirst ? 'first' : 'existing', JSON.stringify(data)]
    );
    logger.info(`Email queued`, {
        email: maskEmail(data.email),
        store: data.storeName,
        date: data.rosterDate,
        type: isFirst ? 'first' : 'existing',
    });
};

export const postEmail = async (data: PostEmailData | undefined, isFirst: boolean) => {
    if(!data) return;

    logger.info(`Sending email`, { type: isFirst ? 'first-time' : 'existing', email: maskEmail(data.email), store: data.storeName, date: data.rosterDate });

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

        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: {
                "content-type": "application/json"
            },
            body: JSON.stringify(data),
        });

        logger.debug(`Webhook response`, { status: response.status, statusText: response.statusText });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`Webhook request failed`, { status: response.status, statusText: response.statusText });
            throw new Error(`Email webhook request failed: ${response.status} ${response.statusText}`);
        }

        const responseText = await response.text();
        if (responseText) {
            try {
                JSON.parse(responseText); // validate JSON
                logger.debug(`Webhook response received`);
            } catch {
                logger.debug(`Webhook response received (non-JSON)`);
            }
        }

        logger.info(`Email sent successfully`, { email: maskEmail(data.email), store: data.storeName, date: data.rosterDate, isFirst, status: response.status });

        return response;
    } catch (error) {
        logger.error(`Email send failed`, { email: maskEmail(data?.email ?? ''), store: data?.storeName, date: data?.rosterDate, isFirst, error: error instanceof Error ? error.message : String(error) });
        throw error;
    }
}
