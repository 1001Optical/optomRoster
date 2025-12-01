"use client"

import { useEffect, useState } from "react";
import { getOptomCount, OptomCountResult } from "@/utils/fetch_utils";

export default function OptomCountPage() {
  const [optomCountData, setOptomCountData] = useState<OptomCountResult[]>([]);
  const [optomCountLoading, setOptomCountLoading] = useState<boolean>(false);
  const [optomCountError, setOptomCountError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("2025-12-01");

  // Optom Count 데이터 로드
  useEffect(() => {
    console.log("=== Loading Optom Count Data ===");
    console.log(`Date: ${selectedDate}`);
    
    setOptomCountLoading(true);
    setOptomCountError(null);

    getOptomCount(selectedDate)
      .then((data) => {
        console.log(`Optom count data loaded successfully: ${data.length} stores`);
        setOptomCountData(data);
        setOptomCountError(null);
      })
      .catch((err) => {
        console.error("Error loading optom count data:", err);
        setOptomCountError(
          err instanceof Error
            ? err.message
            : "Failed to load optom count data"
        );
        setOptomCountData([]);
      })
      .finally(() => {
        setOptomCountLoading(false);
      });
  }, [selectedDate]);

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedDate(e.target.value);
  };

  const handleRefresh = () => {
    setOptomCountLoading(true);
    setOptomCountError(null);

    getOptomCount(selectedDate)
      .then((data) => {
        setOptomCountData(data);
        setOptomCountError(null);
      })
      .catch((err) => {
        setOptomCountError(
          err instanceof Error
            ? err.message
            : "Failed to load optom count data"
        );
        setOptomCountData([]);
      })
      .finally(() => {
        setOptomCountLoading(false);
      });
  };

  return (
    <div className="mx-auto py-8 px-4 w-screen h-screen flex flex-col justify-center items-center">
      <div className="w-[1240px] h-full overflow-scroll flex flex-col gap-4">
        {/* 헤더 및 컨트롤 */}
        <div className="w-full flex justify-between items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Optom Roster & Appointment Count</h1>
          
          <div className="flex items-center gap-3">
            {/* 날짜 선택 */}
            <div className="flex items-center gap-2">
              <label htmlFor="date-select" className="text-sm font-medium text-gray-700">
                날짜:
              </label>
              <input
                id="date-select"
                type="date"
                value={selectedDate}
                onChange={handleDateChange}
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
              새로고침
            </button>
            
            {/* 로스터 페이지로 이동 */}
            <a
              href="/roster"
              className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 flex items-center gap-2"
            >
              로스터로 이동
            </a>
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
            Optom Roster & Appointment Count - {selectedDate}
          </h2>

          <div className="w-full border border-gray-300 rounded-md overflow-hidden bg-white">
            <table className="min-w-full border-collapse">
              <thead className="bg-gray-100 sticky top-0">
                <tr>
                  <th className="font-semibold text-center py-3 px-4 border-b border-gray-300 text-gray-900">
                    스토어
                  </th>
                  <th className="font-semibold text-center py-3 px-4 border-b border-gray-300 text-gray-900">
                    Location ID
                  </th>
                  <th className="font-semibold text-center py-3 px-4 border-b border-gray-300 text-gray-900">
                    예상 슬롯
                  </th>
                  <th className="font-semibold text-center py-3 px-4 border-b border-gray-300 text-gray-900">
                    실제 예약
                  </th>
                  <th className="font-semibold text-center py-3 px-4 border-b border-gray-300 text-gray-900">
                    점유율 (%)
                  </th>
                </tr>
              </thead>
              <tbody>
                {optomCountLoading ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center bg-white">
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
                  optomCountData.map((item, index) => {
                    // 점유율에 따라 색상 결정
                    const getOccupancyColor = (rate: number) => {
                      if (rate >= 90) return "text-red-600 font-bold";
                      if (rate >= 70) return "text-orange-600 font-semibold";
                      if (rate >= 50) return "text-yellow-600 font-semibold";
                      return "text-green-600";
                    };

                    return (
                      <tr
                        key={item.locationId}
                        className={index % 2 === 0 ? "bg-white" : "bg-gray-50"}
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
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-500 bg-white">
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
