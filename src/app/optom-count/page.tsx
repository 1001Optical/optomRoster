"use client"

import React, { useEffect, useState, useCallback } from "react";
import { getOptomCountByRange, OptomCountResult } from "@/utils/fetch_utils";
import { toDateOnly } from "@/utils/time";

type ViewMode = "weekly" | "monthly";

interface WeeklyOptomCountResult extends OptomCountResult {
  dateOccupancyRates?: Record<string, { slotCount: number; appointmentCount: number; occupancyRate: number }>;
}

const DARK_GREEN = 'bg-emerald-200 text-emerald-900';
const LIGHT_GREEN = 'bg-teal-100 text-teal-800';
const YELLOW = 'bg-amber-100 text-amber-800';
const PINK = 'bg-rose-100 text-rose-800';

// State 순서 정의
const STATE_ORDER = ['NSW', 'VIC', 'QLD'];

// 주별 토탈 계산 함수 (오늘 미만 데이터만)
function calculateStateTotal(
  stores: WeeklyOptomCountResult[], 
  weeklyDates: string[]
): { 
  totalOccupancyRate: number;
  dateTotals: Record<string, { slotCount: number; appointmentCount: number; occupancyRate: number }>;
} {
  const today = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
  
  let totalSlotCount = 0;
  let totalAppointmentCount = 0;
  const dateTotals: Record<string, { slotCount: number; appointmentCount: number }> = {};
  
  // 각 날짜별로 주 내 모든 스토어 합산
  weeklyDates.forEach(date => {
    if (date < today) { // 오늘 미만만 계산
      let dateSlotCount = 0;
      let dateAppointmentCount = 0;
      
      stores.forEach(store => {
        const dateData = store.dateOccupancyRates?.[date];
        if (dateData && typeof dateData === 'object' && 'slotCount' in dateData && 'appointmentCount' in dateData) {
          dateSlotCount += dateData.slotCount;
          dateAppointmentCount += dateData.appointmentCount;
        }
      });
      
      dateTotals[date] = {
        slotCount: dateSlotCount,
        appointmentCount: dateAppointmentCount
      };
      
      totalSlotCount += dateSlotCount;
      totalAppointmentCount += dateAppointmentCount;
    }
  });
  
  const totalOccupancyRate = totalSlotCount > 0
    ? Math.round((totalAppointmentCount / totalSlotCount) * 100 * 100) / 100
    : 0;
  
  // dateTotals에 occupancyRate 추가
  const dateTotalsWithRate: Record<string, { slotCount: number; appointmentCount: number; occupancyRate: number }> = {};
  Object.keys(dateTotals).forEach(date => {
    const { slotCount, appointmentCount } = dateTotals[date];
    dateTotalsWithRate[date] = {
      slotCount,
      appointmentCount,
      occupancyRate: slotCount > 0 
        ? Math.round((appointmentCount / slotCount) * 100 * 100) / 100 
        : 0
    };
  });
  
  return { totalOccupancyRate, dateTotals: dateTotalsWithRate };
}

export default function OptomCountPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("weekly");
  const [optomCountData, setOptomCountData] = useState<OptomCountResult[]>([]);
  const [weeklyDates, setWeeklyDates] = useState<string[]>([]);
  const [optomCountLoading, setOptomCountLoading] = useState<boolean>(false);
  const [optomCountError, setOptomCountError] = useState<string | null>(null);
  
  // 주별 모드: 현재 월의 주차 (1, 2, 3, 4, 5)
  const [selectedWeek, setSelectedWeek] = useState<number>(1);
  
  // 월 선택 (YYYY-MM 형식)
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // 데이터 로드
  const loadData = useCallback(async () => {
    setOptomCountLoading(true);
    setOptomCountError(null);

    try {
      let data: OptomCountResult[] = [];

      if (viewMode === "weekly") {
        // 선택된 월의 주차로 필터링
        const [year, month] = selectedMonth.split("-").map(Number);
        const currentYear = year;
        const currentMonth = month;
        
        // 현재 월의 첫 번째 일요일 찾기
        const firstDay = new Date(currentYear, currentMonth - 1, 1);
        const firstDayOfWeek = firstDay.getDay(); // 0=일요일, 6=토요일
        
        // 첫 번째 일요일 계산
        const firstSunday = new Date(firstDay);
        firstSunday.setDate(firstDay.getDate() - firstDayOfWeek);
        
        // 선택된 주차의 시작일 계산 (0주차부터 시작)
        const weekStart = new Date(firstSunday);
        weekStart.setDate(firstSunday.getDate() + (selectedWeek - 1) * 7);
        
        // 선택된 주차의 종료일 계산 (토요일)
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        
        const weekRange = {
          start: toDateOnly(weekStart),
          end: toDateOnly(weekEnd),
        };
        
        console.log(`[OPTOM COUNT] Loading weekly data for ${currentYear}-${String(currentMonth).padStart(2, '0')} week ${selectedWeek} (${weekRange.start} to ${weekRange.end})`);
        const result = await getOptomCountByRange(weekRange.start, weekRange.end, true);
        if (Array.isArray(result)) {
          data = result;
          setWeeklyDates([]);
        } else {
          data = result.data;
          setWeeklyDates(result.dates || []);
        }
      } else if (viewMode === "monthly") {
        // 선택된 월 사용
        const [year, month] = selectedMonth.split("-").map(Number);
        const currentYear = year;
        const currentMonth = month;
        
        // 해당 월의 첫 번째 일요일부터 마지막 토요일까지 (5주, 35일)
        const firstDay = new Date(currentYear, currentMonth - 1, 1);
        const firstDayOfWeek = firstDay.getDay(); // 0=일요일, 6=토요일
        
        // 첫 번째 일요일 계산 (해당 월의 첫 날이 일요일이 아니면 이전 주 일요일)
        const startDate = new Date(firstDay);
        startDate.setDate(firstDay.getDate() - firstDayOfWeek);
        
        // 마지막 토요일 계산 (5주 후)
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 34); // 35일 (0일부터 34일 = 35일)
        
        const monthRange = {
          start: toDateOnly(startDate),
          end: toDateOnly(endDate),
        };
        console.log(`[OPTOM COUNT] Loading monthly data for ${currentYear}-${String(currentMonth).padStart(2, '0')} (${monthRange.start} to ${monthRange.end})`);
        const result = await getOptomCountByRange(monthRange.start, monthRange.end, true); // weekly=true
        if (Array.isArray(result)) {
          data = result;
          setWeeklyDates([]);
        } else {
          data = result.data;
          setWeeklyDates(result.dates || []);
        }
      }

        setOptomCountData(data);
        setOptomCountError(null);
    } catch (err) {
        console.error("Error loading optom count data:", err);
        setOptomCountError(
          err instanceof Error
            ? err.message
            : "Failed to load optom count data"
        );
        setOptomCountData([]);
    } finally {
        setOptomCountLoading(false);
    }
  }, [viewMode, selectedWeek, selectedMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleWeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const week = parseInt(e.target.value, 10);
    if (week >= 1) {
      setSelectedWeek(week);
    }
  };

  const handleMonthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedMonth(e.target.value);
  };


  const handleRefresh = () => {
    loadData();
  };

  // 현재 선택된 기간 표시 텍스트
  const getPeriodText = () => {
    if (viewMode === "weekly") {
      const [year, month] = selectedMonth.split("-").map(Number);
      
      // 선택된 월의 첫 번째 일요일 찾기
      const firstDay = new Date(year, month - 1, 1);
      const firstDayOfWeek = firstDay.getDay();
      const firstSunday = new Date(firstDay);
      firstSunday.setDate(firstDay.getDate() - firstDayOfWeek);
      
      // 선택된 주차의 날짜 범위 계산
      const weekStart = new Date(firstSunday);
      weekStart.setDate(firstSunday.getDate() + (selectedWeek - 1) * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      
      return `${toDateOnly(weekStart)} ~ ${toDateOnly(weekEnd)} (${selectedMonth} Week ${selectedWeek})`;
    } else if (viewMode === "monthly") {
      const [year, month] = selectedMonth.split("-").map(Number);
      
      // 해당 월의 첫 번째 일요일부터 마지막 토요일까지
      const firstDay = new Date(year, month - 1, 1);
      const firstDayOfWeek = firstDay.getDay();
      const startDate = new Date(firstDay);
      startDate.setDate(firstDay.getDate() - firstDayOfWeek);
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 34);
      
      return `${toDateOnly(startDate)} ~ ${toDateOnly(endDate)} (${selectedMonth})`;
    }
    return "";
  };

  return (
    <div className="mx-auto py-8 px-4 w-screen h-screen flex flex-col justify-center items-center">
      <div className="w-[1240px] h-full overflow-scroll flex flex-col gap-4">
        {/* 헤더 및 컨트롤 */}
        <div className="w-full flex flex-col gap-4">
          <div className="flex justify-between items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Appointment Rate</h1>
          
          <div className="flex items-center gap-3">
            {/* 월 선택 */}
            <div className="flex items-center gap-2">
            
              <input
                id="month-select"
                type="month"
                value={selectedMonth}
                onChange={handleMonthChange}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {/* 새로고침 버튼 */}
            <button
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              onClick={handleRefresh}
              disabled={optomCountLoading}
            >
              <svg
                className={`w-4 h-4 ${optomCountLoading ? "animate-spin" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
            </div>
          </div>

          {/* 탭 선택 */}
          <div className="flex gap-2 border-b border-gray-300">
            <button
              onClick={() => setViewMode("weekly")}
              className={`px-4 py-2 font-medium ${
                viewMode === "weekly"
                  ? "border-b-2 border-blue-500 text-blue-600"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Weekly
            </button>
            <button
              onClick={() => setViewMode("monthly")}
              className={`px-4 py-2 font-medium ${
                viewMode === "monthly"
                  ? "border-b-2 border-blue-500 text-blue-600"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Monthly
            </button>
          </div>

          {/* Date selection control */}
          <div className="flex items-center gap-3">
            {viewMode === "weekly" && (
              <div className="flex items-center gap-2">
                <label htmlFor="week-select" className="text-sm font-medium text-gray-700">
                  Week:
                </label>
                <input
                  id="week-select"
                  type="number"
                  min="1"
                  value={selectedWeek}
                  onChange={handleWeekChange}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 w-20"
                />
              </div>
            )}

          </div>
        </div>

        {/* 에러 메시지 */}
        {optomCountError && (
          <div className="w-full p-4 bg-red-50 border border-red-200 rounded-md">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg
                  className="h-5 w-5 text-red-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Error</h3>
                <div className="mt-2 text-sm text-red-700">{optomCountError}</div>
              </div>
            </div>
          </div>
        )}

        {/* Optom Count 표 */}
        <div className="w-full flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-gray-900">
            {getPeriodText()}
          </h2>

          <div className="w-full border border-gray-300 rounded-md overflow-x-auto bg-white">
            <table className="min-w-full border-collapse">
              <thead className="bg-gray-100 sticky top-0">
                <tr>
                  <th className="font-semibold text-center py-3 px-4 border-b border-gray-300 text-gray-900 bg-gray-100" style={{ width: '200px', minWidth: '200px', position: 'sticky', left: 0, zIndex: 10 }}>
                    Store
                  </th>
                  <th className="font-semibold text-center py-3 px-4 border-b border-gray-300 text-gray-900 bg-gray-100" style={{ width: '120px', minWidth: '120px', position: 'sticky', left: '200px', zIndex: 10 }}>
                    Total (%)
                  </th>
                  {weeklyDates.map((date) => {
                    const dateObj = new Date(date + 'T00:00:00Z');
                    const month = dateObj.getMonth() + 1;
                    const day = dateObj.getDate();
                    return (
                      <th
                        key={date}
                        className="font-semibold text-center py-3 px-4 border-b border-gray-300 text-gray-900"
                      >
                        {month}/{day}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {optomCountLoading ? (
                  <tr>
                    <td colSpan={(viewMode === "weekly" || viewMode === "monthly") && weeklyDates.length > 0 ? weeklyDates.length + 2 : 5} className="py-8 text-center bg-white">
                      <div
                        role="status"
                        className="flex justify-center items-center"
                      >
                        <svg
                          aria-hidden="true"
                          className="w-8 h-8 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600"
                          viewBox="0 0 100 101"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                            fill="currentColor"
                          />
                          <path
                            d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                            fill="currentFill"
                          />
                        </svg>
                        <span className="sr-only">Loading...</span>
                      </div>
                    </td>
                  </tr>
                ) : optomCountData.length > 0 ? (
                  (() => {
                    // 점유율에 따라 색상 결정
                    const getOccupancyColor = (rate: number) => {
                      if (rate >= 75) return DARK_GREEN+" font-bold";
                      if (rate >= 50) return LIGHT_GREEN+" font-semibold";
                      if (rate >= 25) return YELLOW+" font-semibold";
                      return PINK;
                    };

                    // State별로 그룹화
                    const groupedByState = optomCountData.reduce((acc, item) => {
                      const state = item.state || 'UNKNOWN';
                      if (!acc[state]) {
                        acc[state] = [];
                      }
                      acc[state].push(item as WeeklyOptomCountResult);
                      return acc;
                    }, {} as Record<string, WeeklyOptomCountResult[]>);

                    // State별로 렌더링
                    return STATE_ORDER.map(state => {
                      const stateStores = groupedByState[state] || [];
                      if (stateStores.length === 0) return null;

                      // 주별 토탈 계산
                      const stateTotal = (viewMode === "weekly" || viewMode === "monthly") && weeklyDates.length > 0
                        ? calculateStateTotal(stateStores, weeklyDates)
                        : null;

                      const today = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');

                      return (
                        <React.Fragment key={state}>
                          {/* 주 헤더 행 */}
                          <tr className="bg-gray-200">
                            <td 
                              colSpan={weeklyDates.length + 2}
                              className="py-2 px-4 font-bold text-gray-900 border-b border-gray-300"
                            >
                              {state}
                            </td>
                          </tr>
                          
                          {/* 해당 주의 스토어들 */}
                          {stateStores.map((item, storeIndex) => {
                            const weeklyItem = item as WeeklyOptomCountResult;

                            if ((viewMode === "weekly" || viewMode === "monthly") && weeklyDates.length > 0 && weeklyItem.dateOccupancyRates) {
                              // 오늘 미만 데이터만으로 Total 계산
                              let totalSlotCount = 0;
                              let totalAppointmentCount = 0;
                              
                              Object.entries(weeklyItem.dateOccupancyRates).forEach(([date, dateData]) => {
                                if (date < today) {
                                  if (typeof dateData === 'object' && dateData !== null && 'slotCount' in dateData && 'appointmentCount' in dateData) {
                                    totalSlotCount += dateData.slotCount;
                                    totalAppointmentCount += dateData.appointmentCount;
                                  }
                                }
                              });
                              
                              const totalOccupancyRate = totalSlotCount > 0
                                ? Math.round((totalAppointmentCount / totalSlotCount) * 100 * 100) / 100
                                : 0;
                              
                              return (
                                <tr
                                  key={item.locationId}
                                  className={storeIndex % 2 === 0 ? "bg-white" : "bg-gray-50"}
                                >
                                  <td className={`py-2 px-4 border-b border-gray-200 text-center text-gray-900 font-semibold ${storeIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`} style={{ width: '200px', minWidth: '200px', position: 'sticky', left: 0, zIndex: 5 }}>
                                    {item.storeName}
                                  </td>
                                  <td className={`py-2 px-4 border-b border-gray-200 text-center font-semibold ${getOccupancyColor(totalOccupancyRate)} ${storeIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`} style={{ width: '120px', minWidth: '120px', position: 'sticky', left: '200px', zIndex: 5 }}>
                                    {totalOccupancyRate.toFixed(2)}%
                                  </td>
                                  {weeklyDates.map((date) => {
                                    const isFutureDate = date >= today;
                                    
                                    // 오늘 이후 날짜는 "-" 표시
                                    if (isFutureDate) {
                                      return (
                                        <td
                                          key={date}
                                          className="w-[120px] py-2 px-4 border-b border-gray-200 text-center font-semibold text-gray-400"
                                        >
                                          -
                                        </td>
                                      );
                                    }
                                    
                                    const dateData = weeklyItem.dateOccupancyRates?.[date];
                                    if (!dateData) {
                                      const rate = 0;
                                      return (
                                        <td
                                          key={date}
                                          className={`py-2 px-4 border-b border-gray-200 text-center font-semibold ${getOccupancyColor(rate)}`}
                                        >
                                          {rate.toFixed(2)}%
                                        </td>
                                      );
                                    }
                                    
                                    return (
                                      <td
                                        key={date}
                                        className={`py-2 px-4 w-[120px] border-b border-gray-200 text-center font-semibold ${getOccupancyColor(dateData.occupancyRate)}`}
                                      >
                                        <div className="flex flex-col">
                                          <span className="text-sm">{dateData.appointmentCount}/{dateData.slotCount}</span>
                                          <span>{dateData.occupancyRate.toFixed(2)}%</span>
                                        </div>
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            }

                            // 일반 모드 (weeklyDates가 없는 경우)
                            return (
                              <tr
                                key={item.locationId}
                                className={storeIndex % 2 === 0 ? "bg-white" : "bg-gray-50"}
                              >
                                <td className="py-2 px-4 border-b border-gray-200 text-center text-gray-900">
                                  {item.storeName}
                                </td>
                                <td className="py-2 px-4 border-b border-gray-200 text-center text-gray-900">
                                  {item.locationId}
                                </td>
                                <td className="py-2 px-4 border-b border-gray-200 text-center font-semibold text-gray-900">
                                  {item.slotCount}
                                </td>
                                <td className="py-2 px-4 border-b border-gray-200 text-center font-semibold text-gray-900">
                                  {item.appointmentCount}
                                </td>
                                <td className={`py-2 px-4 border-b border-gray-200 text-center font-semibold ${getOccupancyColor(item.occupancyRate)}`}>
                                  {item.occupancyRate.toFixed(2)}%
                                </td>
                              </tr>
                            );
                          })}
                          
                          {/* 주별 토탈 행 */}
                          {(viewMode === "weekly" || viewMode === "monthly") && weeklyDates.length > 0 && stateTotal && (
                            <tr className="bg-white font-bold border-t-2 border-gray-300">
                              <td className="py-2 px-4 border-b border-gray-300 text-center text-gray-900 font-bold" 
                                  style={{ width: '200px', minWidth: '200px', position: 'sticky', left: 0, zIndex: 5, backgroundColor: '#dbeafe' }}>
                                {state} Total
                              </td>
                              <td className={`py-2 px-4 border-b border-gray-300 text-center font-bold ${getOccupancyColor(stateTotal.totalOccupancyRate)}`}
                                  style={{ width: '120px', minWidth: '120px', position: 'sticky', left: '200px', zIndex: 5, backgroundColor: '#dbeafe' }}>
                                {stateTotal.totalOccupancyRate.toFixed(2)}%
                              </td>
                              {weeklyDates.map((date) => {
                                const isFutureDate = date >= today;
                                
                                if (isFutureDate) {
                                  return (
                                    <td key={date} className="w-[120px] py-2 px-4 border-b border-gray-300 text-center font-bold text-gray-400" style={{ backgroundColor: '#dbeafe' }}>
                                      -
                                    </td>
                                  );
                                }
                                
                                const dateTotal = stateTotal.dateTotals[date];
                                if (!dateTotal) {
                                  return (
                                    <td key={date} className="w-[120px] py-2 px-4 border-b border-gray-300 text-center font-bold" style={{ backgroundColor: '#dbeafe' }}>
                                      -
                                    </td>
                                  );
                                }
                                
                                return (
                                  <td key={date} className={`py-2 px-4 w-[120px] border-b border-gray-300 text-center font-bold ${getOccupancyColor(dateTotal.occupancyRate)}`}>
                                    <div className="flex flex-col">
                                      <span className="text-sm">{dateTotal.appointmentCount}/{dateTotal.slotCount}</span>
                                      <span>{dateTotal.occupancyRate.toFixed(2)}%</span>
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    });
                  })()
                ) : (
                  <tr>
                    <td colSpan={(viewMode === "weekly" || viewMode === "monthly") && weeklyDates.length > 0 ? weeklyDates.length + 2 : 5} className="py-8 text-center text-gray-500 bg-white">
                      데이터가 없습니다
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
