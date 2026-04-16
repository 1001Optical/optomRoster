import {dbAll} from "@/utils/db/db";
import {OptomMap} from "@/data/stores";
import {createSecret} from "@/utils/crypto";
import {calculateSlots} from "@/utils/slots";
import type { Client } from "@libsql/client";
import { createLogger } from "@/lib/logger";
import type { optomData } from "@/types/types";
import type { SlotMismatch } from "@/lib/changeProcessor";

const logger = createLogger('SlotService');

export type BranchInfo = (typeof OptomMap)[number];

export interface OptomContext {
    optomId: number;
    isFirst: boolean;
    username?: string;
    branchInfo: BranchInfo;
    date: string;
    adjustStart: string;
    adjustFinish: string;
    workFirst: boolean;
    employmentHeroSlots: number;
}

export function parseTimeToMinutes(timeStr: string): number | null {
    try {
        const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (!match) {
            return null;
        }

        let hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const period = match[3].toUpperCase();

        if (period === "PM" && hours !== 12) {
            hours += 12;
        } else if (period === "AM" && hours === 12) {
            hours = 0;
        }

        return hours * 60 + minutes;
    } catch {
        return null;
    }
}

export async function getOptomateRosterSlots(
    OptomateApiUrl: string,
    optomId: number,
    branchCode: string,
    date: string
): Promise<number> {
    try {
        const { fromZonedTime } = await import("date-fns-tz");

        const store = OptomMap.find((s) => s.OptCode === branchCode);
        let timezone = "Australia/Sydney";
        if (store) {
            switch (store.State) {
                case "NSW":
                    timezone = "Australia/Sydney";
                    break;
                case "VIC":
                    timezone = "Australia/Melbourne";
                    break;
                case "QLD":
                    timezone = "Australia/Brisbane";
                    break;
            }
        }

        const [year, month, day] = date.split('-').map(Number);
        const startLocalDate = new Date(year, month - 1, day, 0, 0, 0);
        const startUtc = fromZonedTime(startLocalDate, timezone);
        const endLocalDate = new Date(year, month - 1, day + 1, 0, 0, 0);
        const endUtc = fromZonedTime(endLocalDate, timezone);

        const startDateTime = startUtc.toISOString().replace(/\.\d{3}Z$/, "Z");
        const endDateTime = endUtc.toISOString().replace(/\.\d{3}Z$/, "Z");

        const response = await fetch(
            `${OptomateApiUrl}/Optometrist(${optomId})?$expand=AppAdjust&$filter=AppAdjust/ADJUST_DATE ge ${startDateTime} and AppAdjust/ADJUST_DATE lt ${endDateTime} and AppAdjust/BRANCH_IDENTIFIER eq '${branchCode}' and AppAdjust/INACTIVE eq false`,
            {
                headers: {
                    "Content-Type": "application/json",
                    "authorization": createSecret(process.env.OPTOMATE_USERNAME!, process.env.OPTOMATE_PASSWORD!),
                },
            }
        );

        if (!response.ok) {
            return 0;
        }

        const result = await response.json();

        if (result.AppAdjust && Array.isArray(result.AppAdjust)) {
            let totalSlots = 0;
            for (const adjust of result.AppAdjust) {
                if (adjust.ADJUST_START && adjust.ADJUST_FINISH && !adjust.INACTIVE) {
                    const startTime = parseTimeToMinutes(adjust.ADJUST_START);
                    const endTime = parseTimeToMinutes(adjust.ADJUST_FINISH);
                    if (startTime !== null && endTime !== null && endTime > startTime) {
                        const workMinutes = endTime - startTime;
                        totalSlots += calculateSlots(workMinutes);
                    }
                }
            }
            return totalSlots;
        }

        return 0;
    } catch (error) {
        logger.warn(`Error getting Optomate slots`, { error: error instanceof Error ? error.message : String(error) });
        return 0;
    }
}

export async function getBranchTotalSlots(
    OptomateApiUrl: string,
    branchCode: string,
    date: string
): Promise<number> {
    try {
        const startDateTime = `${date}T00:00`;
        const [year, month, day] = date.split('-').map(Number);
        const nextDay = new Date(year, month - 1, day + 1);
        const endDateStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`;
        const endDateTime = `${endDateStr}T00:00`;

        const url = `${OptomateApiUrl}/Appointments/OptometristsAvailability`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "authorization": createSecret(process.env.OPTOMATE_USERNAME!, process.env.OPTOMATE_PASSWORD!),
            },
            body: JSON.stringify({
                SEARCH: {
                    BRANCH_IDENTIFIER: branchCode,
                    STARTDATETIME: startDateTime,
                    ENDDATETIME: endDateTime
                }
            }),
        });

        if (!response.ok) {
            logger.warn(`Branch slots API request failed`, { status: response.status, statusText: response.statusText });
            return 0;
        }

        const result = await response.json();

        let totalSlots = 0;

        if (result.OPTOMETRISTS && Array.isArray(result.OPTOMETRISTS)) {
            for (const optometrist of result.OPTOMETRISTS) {
                if (optometrist.AVAILABLE_TIMEBLOCKS && Array.isArray(optometrist.AVAILABLE_TIMEBLOCKS)) {
                    for (const timeblock of optometrist.AVAILABLE_TIMEBLOCKS) {
                        if (timeblock.STARTDATETIME && timeblock.ENDDATETIME) {
                            const startDate = new Date(timeblock.STARTDATETIME);
                            const endDate = new Date(timeblock.ENDDATETIME);

                            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                                logger.warn(`Invalid timeblock date format`, { start: timeblock.STARTDATETIME, end: timeblock.ENDDATETIME });
                                continue;
                            }

                            const workMinutes = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60));

                            if (workMinutes > 0) {
                                const slots = calculateSlots(workMinutes);
                                totalSlots += slots;
                            }
                        }
                    }
                }
            }
        }

        logger.debug(`Branch total slots from Optomate`, { branch: branchCode, date, totalSlots });
        return totalSlots;
    } catch (error) {
        logger.warn(`Error getting branch total slots`, { error: error instanceof Error ? error.message : String(error) });
        return 0;
    }
}

export async function getEHBranchTotalSlots(
    db: Client,
    branchCode: string,
    date: string
): Promise<number> {
    try {
        const branchInfo = OptomMap.find(v => v.OptCode === branchCode);
        if (!branchInfo) {
            logger.warn(`Unknown branch code`, { branchCode });
            return 0;
        }

        const startDateTime = `${date}T00:00:00Z`;
        const [year, month, day] = date.split('-').map(Number);
        const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
        const endDateTime = nextDay.toISOString().split('.')[0] + 'Z';

        const rosters = await dbAll<{
            startTime: string;
            endTime: string;
        }>(
            db,
            `
            SELECT startTime, endTime
            FROM ROSTER
            WHERE locationId = ?
              AND startTime >= ?
              AND startTime < ?
        `,
            [branchInfo.LocationId, startDateTime, endDateTime]
        );

        let totalSlots = 0;
        for (const roster of rosters) {
            if (!roster.startTime || !roster.endTime) continue;

            const startDate = new Date(roster.startTime);
            const endDate = new Date(roster.endTime);
            const workMinutes = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60));

            if (workMinutes > 0) {
                totalSlots += calculateSlots(workMinutes);
            }
        }

        logger.debug(`EH branch total slots`, { branch: branchCode, date, totalSlots });
        return totalSlots;
    } catch (error) {
        logger.warn(`Error calculating EH branch slots`, { error: error instanceof Error ? error.message : String(error) });
        return 0;
    }
}

export async function computeSlotMismatchForNew(
    context: OptomContext,
    optomData: optomData,
    OptomateApiUrl: string,
    appAdjustSuccess: boolean
): Promise<SlotMismatch | undefined> {
    if (appAdjustSuccess) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    let optomateSlots = 0;
    try {
        optomateSlots = await getOptomateRosterSlots(OptomateApiUrl, context.optomId ?? 0, context.branchInfo.OptCode, context.date);

        if (context.employmentHeroSlots !== optomateSlots && optomateSlots > 0) {
            logger.warn(`Slot mismatch`, {
                branch: context.branchInfo.OptCode,
                branchName: context.branchInfo.StoreName,
                date: context.date,
                optomId: context.optomId,
                ehSlots: context.employmentHeroSlots,
                optomateSlots
            });

            return {
                branch: context.branchInfo.OptCode,
                branchName: context.branchInfo.StoreName,
                date: context.date,
                optomId: context.optomId,
                name: `${optomData.firstName} ${optomData.lastName}`,
                employmentHeroSlots: context.employmentHeroSlots,
                optomateSlots: optomateSlots
            };
        } else if (context.employmentHeroSlots === optomateSlots && optomateSlots > 0) {
            logger.debug(`Slot match`, { branch: context.branchInfo.OptCode, date: context.date, slots: context.employmentHeroSlots, optomId: context.optomId });
        }
    } catch (slotError) {
        logger.warn(`Failed to get Optomate slots`, { error: slotError instanceof Error ? slotError.message : String(slotError) });
    }

    return undefined;
}
