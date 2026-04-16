import { NextResponse } from "next/server";
import { I1001Response } from "@/types/api_response";
import { getDB, dbAll, dbExecute } from "@/utils/db/db";
import { postEmail, PostEmailData } from "@/lib/postEmail";
import { createLogger, maskEmail } from "@/lib/logger";
import { withAxiomFlush } from "@/lib/axiom/withFlush";

const logger = createLogger('EmailRetry');

// 재시도 간격 (분) - 지수 백오프
const RETRY_DELAYS_MINUTES = [5, 15, 45, 120, 360];
const MAX_RETRIES = RETRY_DELAYS_MINUTES.length;

interface EmailQueueRow {
    id: number;
    webhookType: string;
    payload: string;
    status: string;
    retryCount: number;
    nextRetryAt: string;
    lastError: string | null;
    createdAt: string;
}

interface RetryResult {
    processed: number;
    sent: number;
    failed: number;
    abandoned: number;
}

/**
 * EMAIL_QUEUE에서 대기 중인 이메일을 꺼내 Make.com 웹훅으로 발송합니다.
 * 실패 시 지수 백오프로 재시도하며, 최대 5회 실패 시 'abandoned' 처리합니다.
 *
 * GET /api/cron/email-retry
 */
export async function GET(): Promise<NextResponse<I1001Response<RetryResult>>> {
    return withAxiomFlush(async () => {
    const result: RetryResult = { processed: 0, sent: 0, failed: 0, abandoned: 0 };

    try {
        const db = await getDB();

        // 처리 대상: pending 또는 failed 상태이며 다음 재시도 시각이 지난 항목 (최대 20개)
        const pending = await dbAll<EmailQueueRow>(
            db,
            `SELECT * FROM EMAIL_QUEUE
             WHERE status IN ('pending', 'failed')
               AND nextRetryAt <= datetime('now')
             ORDER BY nextRetryAt ASC
             LIMIT 20`
        );

        if (pending.length === 0) {
            logger.debug(`No pending emails`);
            return NextResponse.json({ message: "success", data: result });
        }

        logger.info(`Processing email queue`, { count: pending.length });

        for (const row of pending) {
            result.processed++;

            let data: PostEmailData;
            try {
                data = JSON.parse(row.payload) as PostEmailData;
            } catch (e) {
                logger.error(`Invalid payload in EMAIL_QUEUE`, { id: row.id, error: String(e) });
                await dbExecute(db,
                    `UPDATE EMAIL_QUEUE
                     SET status = 'abandoned', lastError = ?, updatedAt = datetime('now')
                     WHERE id = ?`,
                    [`Invalid JSON payload: ${String(e)}`, row.id]
                );
                result.abandoned++;
                continue;
            }

            const isFirst = row.webhookType === 'first';

            try {
                await postEmail(data, isFirst);

                await dbExecute(db,
                    `UPDATE EMAIL_QUEUE
                     SET status = 'sent', updatedAt = datetime('now')
                     WHERE id = ?`,
                    [row.id]
                );

                logger.info(`Email sent`, {
                    id: row.id,
                    email: maskEmail(data.email),
                    store: data.storeName,
                    date: data.rosterDate,
                    retryCount: row.retryCount,
                });
                result.sent++;

            } catch (error) {
                const newRetryCount = row.retryCount + 1;
                const errorMsg = error instanceof Error ? error.message : String(error);

                if (newRetryCount >= MAX_RETRIES) {
                    // 최대 재시도 초과 → abandoned
                    await dbExecute(db,
                        `UPDATE EMAIL_QUEUE
                         SET status = 'abandoned', retryCount = ?, lastError = ?, updatedAt = datetime('now')
                         WHERE id = ?`,
                        [newRetryCount, errorMsg, row.id]
                    );
                    logger.error(`Email abandoned after max retries`, {
                        id: row.id,
                        email: maskEmail(data.email),
                        store: data.storeName,
                        retryCount: newRetryCount,
                        lastError: errorMsg,
                    });
                    result.abandoned++;
                } else {
                    // 재시도 예약 (지수 백오프)
                    const delayMinutes = RETRY_DELAYS_MINUTES[newRetryCount - 1] ?? 360;
                    await dbExecute(db,
                        `UPDATE EMAIL_QUEUE
                         SET status = 'failed',
                             retryCount = ?,
                             lastError = ?,
                             nextRetryAt = datetime('now', ? || ' minutes'),
                             updatedAt = datetime('now')
                         WHERE id = ?`,
                        [newRetryCount, errorMsg, String(delayMinutes), row.id]
                    );
                    logger.warn(`Email send failed, will retry`, {
                        id: row.id,
                        email: maskEmail(data.email),
                        retryCount: newRetryCount,
                        nextRetryInMinutes: delayMinutes,
                        error: errorMsg,
                    });
                    result.failed++;
                }
            }
        }

        logger.info(`Email retry run complete`, result as unknown as Record<string, unknown>);
        return NextResponse.json({ message: "success", data: result });

    } catch (error) {
        logger.error(`Email retry cron failed`, { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            {
                message: "Internal server error",
                error: error instanceof Error ? error.message : "Unknown error",
            },
            { status: 500 }
        );
    }
    });
}
