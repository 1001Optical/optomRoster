"use client";

import { useCallback, useEffect, useState } from "react";
import { getOptomCountByRange, OptomCountResult } from "@/utils/fetch_utils";
import { toDateOnly } from "@/utils/time";

export type ViewMode = "weekly" | "monthly";

function getWeekRange(year: number, month: number, week: number) {
  const firstDay = new Date(year, month - 1, 1);
  const firstSunday = new Date(firstDay);
  firstSunday.setDate(firstDay.getDate() - firstDay.getDay());

  const weekStart = new Date(firstSunday);
  weekStart.setDate(firstSunday.getDate() + (week - 1) * 7);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  return { start: toDateOnly(weekStart), end: toDateOnly(weekEnd) };
}

function getMonthRange(year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1);
  const startDate = new Date(firstDay);
  startDate.setDate(firstDay.getDate() - firstDay.getDay());

  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 34);

  return { start: toDateOnly(startDate), end: toDateOnly(endDate) };
}

export function useOptomCount() {
  const [viewMode, setViewMode] = useState<ViewMode>("weekly");
  const [optomCountData, setOptomCountData] = useState<OptomCountResult[]>([]);
  const [weeklyDates, setWeeklyDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [year, month] = selectedMonth.split("-").map(Number);
      const range =
        viewMode === "weekly"
          ? getWeekRange(year, month, selectedWeek)
          : getMonthRange(year, month);

      const result = await getOptomCountByRange(range.start, range.end, true);

      if (Array.isArray(result)) {
        setOptomCountData(result);
        setWeeklyDates([]);
      } else {
        setOptomCountData(result.data);
        setWeeklyDates(result.dates || []);
      }
      setError(null);
    } catch (err) {
      console.error("Error loading optom count data:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load optom count data"
      );
      setOptomCountData([]);
    } finally {
      setLoading(false);
    }
  }, [viewMode, selectedWeek, selectedMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleWeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const week = parseInt(e.target.value, 10);
    if (week >= 1) setSelectedWeek(week);
  };

  const handleMonthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedMonth(e.target.value);
  };

  const getPeriodText = () => {
    const [year, month] = selectedMonth.split("-").map(Number);

    if (viewMode === "weekly") {
      const range = getWeekRange(year, month, selectedWeek);
      return `${range.start} ~ ${range.end} (${selectedMonth} Week ${selectedWeek})`;
    }

    const range = getMonthRange(year, month);
    return `${range.start} ~ ${range.end} (${selectedMonth})`;
  };

  return {
    viewMode,
    setViewMode,
    optomCountData,
    weeklyDates,
    loading,
    error,
    selectedWeek,
    selectedMonth,
    handleWeekChange,
    handleMonthChange,
    handleRefresh: loadData,
    getPeriodText,
  };
}
