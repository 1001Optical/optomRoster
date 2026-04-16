import { OptomCountResult } from "@/utils/fetch_utils";

export interface WeeklyOptomCountResult extends OptomCountResult {
  dateOccupancyRates?: Record<
    string,
    { slotCount: number; appointmentCount: number; occupancyRate: number }
  >;
}

export interface DateTotal {
  slotCount: number;
  appointmentCount: number;
  occupancyRate: number;
}

export interface StateTotalResult {
  totalOccupancyRate: number;
  totalSlotCount: number;
  totalAppointmentCount: number;
  dateTotals: Record<string, DateTotal>;
}

export const OCCUPANCY_COLORS = {
  darkGreen: "bg-emerald-200 text-emerald-900",
  lightGreen: "bg-teal-100 text-teal-800",
  yellow: "bg-amber-100 text-amber-800",
  pink: "bg-rose-100 text-rose-800",
} as const;

export const STATE_ORDER = ["NSW", "VIC", "QLD"];

export function getOccupancyColor(rate: number): string {
  if (rate >= 75) return OCCUPANCY_COLORS.darkGreen + " font-bold";
  if (rate >= 50) return OCCUPANCY_COLORS.lightGreen + " font-semibold";
  if (rate >= 25) return OCCUPANCY_COLORS.yellow + " font-semibold";
  return OCCUPANCY_COLORS.pink;
}

export function getOccupancyTextColor(rate: number): string {
  if (rate >= 75) return "text-emerald-900 font-bold";
  if (rate >= 50) return "text-teal-800 font-semibold";
  if (rate >= 25) return "text-amber-800 font-semibold";
  return "text-rose-800";
}

export function getTodayString(): string {
  return new Date()
    .toLocaleDateString("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    .replace(/\//g, "-");
}

export function calculateStateTotal(
  stores: WeeklyOptomCountResult[],
  weeklyDates: string[]
): StateTotalResult {
  const today = getTodayString();

  let totalSlotCount = 0;
  let totalAppointmentCount = 0;
  const dateTotals: Record<string, { slotCount: number; appointmentCount: number }> = {};

  weeklyDates.forEach((date) => {
    if (date >= today) return;

    let dateSlotCount = 0;
    let dateAppointmentCount = 0;

    stores.forEach((store) => {
      const dateData = store.dateOccupancyRates?.[date];
      if (
        dateData &&
        typeof dateData === "object" &&
        "slotCount" in dateData &&
        "appointmentCount" in dateData
      ) {
        dateSlotCount += dateData.slotCount;
        dateAppointmentCount += dateData.appointmentCount;
      }
    });

    dateTotals[date] = { slotCount: dateSlotCount, appointmentCount: dateAppointmentCount };
    totalSlotCount += dateSlotCount;
    totalAppointmentCount += dateAppointmentCount;
  });

  const totalOccupancyRate =
    totalSlotCount > 0
      ? Math.round((totalAppointmentCount / totalSlotCount) * 100 * 100) / 100
      : 0;

  const dateTotalsWithRate: Record<string, DateTotal> = {};
  Object.keys(dateTotals).forEach((date) => {
    const { slotCount, appointmentCount } = dateTotals[date];
    dateTotalsWithRate[date] = {
      slotCount,
      appointmentCount,
      occupancyRate:
        slotCount > 0
          ? Math.round((appointmentCount / slotCount) * 100 * 100) / 100
          : 0,
    };
  });

  return {
    totalOccupancyRate,
    totalSlotCount,
    totalAppointmentCount,
    dateTotals: dateTotalsWithRate,
  };
}
