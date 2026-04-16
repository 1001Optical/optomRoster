"use client";

import React from "react";
import {
  WeeklyOptomCountResult,
  calculateStateTotal,
  getOccupancyColor,
  getOccupancyTextColor,
  getTodayString,
} from "../occupancy-utils";
import { ViewMode } from "../useOptomCount";

interface StateGroupProps {
  state: string;
  stores: WeeklyOptomCountResult[];
  weeklyDates: string[];
  viewMode: ViewMode;
}

function DateCell({
  date,
  dateData,
  isFuture,
  variant,
}: {
  date: string;
  dateData?: { slotCount: number; appointmentCount: number; occupancyRate: number };
  isFuture: boolean;
  variant: "store" | "stateTotal";
}) {
  const baseClass =
    variant === "stateTotal"
      ? "py-2 px-4 w-[120px] border-b border-gray-300 dark:border-gray-600 text-center font-bold"
      : "py-2 px-4 w-[120px] border-b border-gray-200 dark:border-gray-700 text-center font-semibold";

  if (isFuture || !dateData) {
    const emptyClass =
      variant === "stateTotal"
        ? `${baseClass} text-gray-400 bg-blue-100 dark:bg-blue-900`
        : `${baseClass} text-gray-400 dark:text-gray-500`;
    return (
      <td className={emptyClass}>
        {isFuture ? "-" : dateData === undefined ? "-" : `${(0).toFixed(2)}%`}
      </td>
    );
  }

  if (!isFuture && !dateData && variant === "store") {
    return (
      <td className={`${baseClass} ${getOccupancyColor(0)}`}>
        {(0).toFixed(2)}%
      </td>
    );
  }

  return (
    <td className={`${baseClass} ${getOccupancyColor(dateData.occupancyRate)}`}>
      <div className="flex flex-col">
        <span className="text-sm">
          {dateData.appointmentCount}/{dateData.slotCount}
        </span>
        <span>{dateData.occupancyRate.toFixed(2)}%</span>
      </div>
    </td>
  );
}

function WeeklyStoreRow({
  item,
  weeklyDates,
  storeIndex,
}: {
  item: WeeklyOptomCountResult;
  weeklyDates: string[];
  storeIndex: number;
}) {
  const today = getTodayString();
  const rowBg = storeIndex % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50 dark:bg-gray-800";

  let totalSlotCount = 0;
  let totalAppointmentCount = 0;

  Object.entries(item.dateOccupancyRates || {}).forEach(([date, dateData]) => {
    if (date < today && typeof dateData === "object" && "slotCount" in dateData) {
      totalSlotCount += dateData.slotCount;
      totalAppointmentCount += dateData.appointmentCount;
    }
  });

  const totalOccupancyRate =
    totalSlotCount > 0
      ? Math.round((totalAppointmentCount / totalSlotCount) * 100 * 100) / 100
      : 0;

  return (
    <tr className={rowBg}>
      <td
        className={`py-2 px-4 border-b border-gray-200 dark:border-gray-700 text-center text-gray-900 dark:text-white font-semibold ${rowBg}`}
        style={{ width: "200px", minWidth: "200px", position: "sticky", left: 0, zIndex: 5 }}
      >
        {item.storeName}
      </td>
      <td
        className={`py-2 px-4 border-b border-gray-200 dark:border-gray-700 text-center font-semibold ${getOccupancyTextColor(totalOccupancyRate)} ${rowBg}`}
        style={{ width: "120px", minWidth: "120px", position: "sticky", left: "200px", zIndex: 5 }}
      >
        <div className="flex flex-col">
          <span className="text-sm">{totalAppointmentCount}/{totalSlotCount}</span>
          <span>{totalOccupancyRate.toFixed(2)}%</span>
        </div>
      </td>
      {weeklyDates.map((date) => {
        const isFuture = date >= today;
        const dateData = item.dateOccupancyRates?.[date];

        if (isFuture) {
          return <td key={date} className="w-[120px] py-2 px-4 border-b border-gray-200 dark:border-gray-700 text-center font-semibold text-gray-400 dark:text-gray-500">-</td>;
        }

        if (!dateData) {
          return <td key={date} className={`py-2 px-4 border-b border-gray-200 dark:border-gray-700 text-center font-semibold ${getOccupancyColor(0)}`}>{(0).toFixed(2)}%</td>;
        }

        return (
          <td key={date} className={`py-2 px-4 w-[120px] border-b border-gray-200 dark:border-gray-700 text-center font-semibold ${getOccupancyColor(dateData.occupancyRate)}`}>
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

function BasicStoreRow({ item, storeIndex }: { item: WeeklyOptomCountResult; storeIndex: number }) {
  const rowBg = storeIndex % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50 dark:bg-gray-800";

  return (
    <tr className={rowBg}>
      <td className="py-2 px-4 border-b border-gray-200 dark:border-gray-700 text-center text-gray-900 dark:text-white">{item.storeName}</td>
      <td className="py-2 px-4 border-b border-gray-200 dark:border-gray-700 text-center text-gray-900 dark:text-white">{item.locationId}</td>
      <td className="py-2 px-4 border-b border-gray-200 dark:border-gray-700 text-center font-semibold text-gray-900 dark:text-white">{item.slotCount}</td>
      <td className="py-2 px-4 border-b border-gray-200 dark:border-gray-700 text-center font-semibold text-gray-900 dark:text-white">{item.appointmentCount}</td>
      <td className={`py-2 px-4 border-b border-gray-200 dark:border-gray-700 text-center font-semibold ${getOccupancyColor(item.occupancyRate)}`}>{item.occupancyRate.toFixed(2)}%</td>
    </tr>
  );
}

function StateTotalRow({
  state,
  stores,
  weeklyDates,
}: {
  state: string;
  stores: WeeklyOptomCountResult[];
  weeklyDates: string[];
}) {
  const stateTotal = calculateStateTotal(stores, weeklyDates);
  const today = getTodayString();

  return (
    <tr className="bg-blue-100 dark:bg-blue-900 font-bold border-t border-blue-300 dark:border-blue-700">
      <td
        className="py-2 px-4 border-b border-gray-300 dark:border-gray-600 text-center text-gray-900 dark:text-white font-bold bg-blue-100 dark:bg-blue-900"
        style={{ width: "200px", minWidth: "200px", position: "sticky", left: 0, zIndex: 5 }}
      >
        {state} Total
      </td>
      <td
        className="py-2 px-4 border-b border-gray-300 dark:border-gray-600 text-center font-bold bg-blue-100 dark:bg-blue-900"
        style={{ width: "120px", minWidth: "120px", position: "sticky", left: "200px", zIndex: 5 }}
      >
        <div className="flex flex-col">
          <span className="text-sm">{stateTotal.totalAppointmentCount}/{stateTotal.totalSlotCount}</span>
          <span>{stateTotal.totalOccupancyRate.toFixed(2)}%</span>
        </div>
      </td>
      {weeklyDates.map((date) => {
        const isFuture = date >= today;
        const dateTotal = stateTotal.dateTotals[date];

        if (isFuture || !dateTotal) {
          return (
            <td key={date} className="w-[120px] py-2 px-4 border-b border-gray-300 dark:border-gray-600 text-center font-bold text-gray-400 bg-blue-100 dark:bg-blue-900">-</td>
          );
        }

        return (
          <td key={date} className={`py-2 px-4 w-[120px] border-b border-gray-300 dark:border-gray-600 text-center font-bold ${getOccupancyColor(dateTotal.occupancyRate)}`}>
            <div className="flex flex-col">
              <span className="text-sm">{dateTotal.appointmentCount}/{dateTotal.slotCount}</span>
              <span>{dateTotal.occupancyRate.toFixed(2)}%</span>
            </div>
          </td>
        );
      })}
    </tr>
  );
}

export function StateGroup({ state, stores, weeklyDates, viewMode }: StateGroupProps) {
  const hasWeeklyDates = weeklyDates.length > 0;
  const isWeeklyMode = (viewMode === "weekly" || viewMode === "monthly") && hasWeeklyDates;

  return (
    <React.Fragment>
      <tr
        className="bg-gray-200 dark:bg-gray-700"
        style={{ position: "sticky", top: "120px", zIndex: 8 }}
      >
        <td
          className="py-2 px-4 font-bold text-gray-900 dark:text-white border-b border-gray-300 dark:border-gray-600 bg-gray-200 dark:bg-gray-700"
          style={{ width: "200px", minWidth: "200px", position: "sticky", left: 0, zIndex: 8 }}
        >
          {state}
        </td>
        <td
          colSpan={weeklyDates.length + 1}
          className="py-2 px-4 font-bold text-gray-900 dark:text-white border-b border-gray-300 dark:border-gray-600 bg-gray-200 dark:bg-gray-700"
        />
      </tr>

      {stores.map((item, idx) =>
        isWeeklyMode && item.dateOccupancyRates ? (
          <WeeklyStoreRow key={item.locationId} item={item} weeklyDates={weeklyDates} storeIndex={idx} />
        ) : (
          <BasicStoreRow key={item.locationId} item={item} storeIndex={idx} />
        )
      )}

      {isWeeklyMode && (
        <StateTotalRow state={state} stores={stores} weeklyDates={weeklyDates} />
      )}
    </React.Fragment>
  );
}
