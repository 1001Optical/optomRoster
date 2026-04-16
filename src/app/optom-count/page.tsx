"use client";

import { useOptomCount } from "./useOptomCount";
import { OccupancyTable } from "./components/OccupancyTable";

export default function OptomCountPage() {
  const {
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
    handleRefresh,
    getPeriodText,
  } = useOptomCount();

  return (
    <div className="mx-auto py-8 px-4 w-screen h-screen flex flex-col justify-center items-center bg-white dark:bg-gray-900">
      <div className="w-[1240px] h-full flex flex-col gap-4">
        {/* Header and controls */}
        <div className="w-full flex flex-col gap-4">
          <div className="flex justify-between items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Appointment Rate
            </h1>

            <div className="flex items-center gap-3">
              <input
                type="month"
                value={selectedMonth}
                onChange={handleMonthChange}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                onClick={handleRefresh}
                disabled={loading}
              >
                <svg
                  className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
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

          {/* Tab selection */}
          <div className="flex gap-2 border-b border-gray-300 dark:border-gray-600">
            <button
              onClick={() => setViewMode("weekly")}
              className={`px-4 py-2 font-medium ${
                viewMode === "weekly"
                  ? "border-b-2 border-blue-500 text-blue-600"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              Weekly
            </button>
            <button
              onClick={() => setViewMode("monthly")}
              className={`px-4 py-2 font-medium ${
                viewMode === "monthly"
                  ? "border-b-2 border-blue-500 text-blue-600"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              Monthly
            </button>
          </div>

          {/* Week selector (weekly mode only) */}
          {viewMode === "weekly" && (
            <div className="flex items-center gap-2">
              <label
                htmlFor="week-select"
                className="text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Week:
              </label>
              <input
                id="week-select"
                type="number"
                min="1"
                value={selectedWeek}
                onChange={handleWeekChange}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 w-20"
              />
            </div>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="w-full p-4 bg-red-50 border border-red-200 rounded-md">
            <div className="flex">
              <svg className="h-5 w-5 text-red-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Error</h3>
                <div className="mt-2 text-sm text-red-700">{error}</div>
              </div>
            </div>
          </div>
        )}

        {/* Data table */}
        <div className="w-full flex flex-col gap-2 flex-1 min-h-0">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {getPeriodText()}
          </h2>
          <OccupancyTable
            data={optomCountData}
            weeklyDates={weeklyDates}
            viewMode={viewMode}
            loading={loading}
          />
        </div>
      </div>
    </div>
  );
}
