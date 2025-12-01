"use client"

import Table from "@/components/table";
import {useEffect, useState} from "react";
import {I1001TableType} from "@/types/api_response";
import {getList, refresh} from "@/utils/fetch_utils";
import IooICalendar from "@/components/IooICalendar";
import { DateRange } from "react-day-picker";
import { RiRefreshLine } from "react-icons/ri";
import IooISelect from "@/components/IooISelect";
import {OptomMap} from "@/data/stores";

// 오늘 기준으로 이번 주의 일요일부터 토요일까지의 날짜 범위를 계산하는 함수
function getCurrentWeekRange(): DateRange {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0(일요일) ~ 6(토요일)
  
  // 일요일까지의 일수 계산 (일요일이면 0, 월요일이면 -1, ..., 토요일이면 -6)
  const daysToSunday = -dayOfWeek;
  
  // 이번 주 일요일
  const sunday = new Date(today);
  sunday.setDate(today.getDate() + daysToSunday);
  sunday.setHours(0, 0, 0, 0);
  
  // 이번 주 토요일
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);
  saturday.setHours(23, 59, 59, 999);
  
  return {
    from: sunday,
    to: saturday,
  };
}

export default function Home() {
    const [res, setRes] = useState<I1001TableType>({})
    const [selectOption, setSelectOption] = useState<number | undefined>()
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [rangeType] = useState<"weekly" | "monthly">("weekly")
    const [selectedWeek, setSelectedWeek] = useState<DateRange | undefined>(getCurrentWeekRange())

    useEffect(() => {
        console.log("=== Loading Roster Data ===");
        console.log(`Selected week: ${selectedWeek?.from} to ${selectedWeek?.to}`);
        console.log(`Selected location: ${selectOption}`);
        
        setLoading(true);
        setError(null);
        
        getList(selectedWeek?.from, selectedWeek?.to, selectOption)
            .then(res => {
                if(res){
                    console.log(`Roster data loaded successfully: ${Object.keys(res).length} stores`);
                    setRes(res);
                    setError(null);
                } else {
                    console.warn("No roster data received");
                    setRes({});
                    setError("No data available for the selected period");
                }
            })
            .catch(err => {
                console.error("Error loading roster data:", err);
                setError(err instanceof Error ? err.message : "Failed to load roster data");
                setRes({});
            })
            .finally(() => {
                setLoading(false);
            });
    }, [selectOption, selectedWeek]);

  return (
    <div className="mx-auto py-8 px-4 w-screen h-screen flex flex-col justify-center items-center">
      <div className="w-[1240px] h-full overflow-scroll flex flex-col gap-4">
        <div className="w-full flex justify-between items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-800">Roster</h1>
          
          <div className="flex justify-end gap-3">
            <IooISelect
                selectItem={selectOption}
                items={OptomMap.map(v => {
                    return {key: v.LocationId, value: v.StoreName}
                })}
                onSelect={(key) => {
                    setSelectOption(key)
                }}
            />
            <IooICalendar
                selectedWeek={selectedWeek}
                onWeekSelect={setSelectedWeek}
                className="max-w-md"
            />
            <button
                className="size-8 border border-gray-300 rounded-md cursor-pointer flex justify-center items-center hover:bg-gray-100 disabled:opacity-50"
                onClick={async () => {
                    console.log("=== Manual Refresh Triggered ===");
                    setLoading(true);
                    setError(null);
                    
                    try {
                        await refresh(selectedWeek?.from, selectedWeek?.to, selectOption);
                        console.log("Manual refresh completed successfully");
                        // 데이터 다시 로드
                        const newData = await getList(selectedWeek?.from, selectedWeek?.to, selectOption);
                        if (newData) {
                            setRes(newData);
                            setError(null);
                        }
                    } catch (err) {
                        console.error("Error during manual refresh:", err);
                        setError(err instanceof Error ? err.message : "Refresh failed");
                    } finally {
                        setLoading(false);
                    }
                }}
                disabled={loading}
            >
                <RiRefreshLine />
            </button>
            
            {/* Optom Count 페이지로 이동 */}
            <a
              href="/roster/optom-count"
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 flex items-center gap-2"
            >
              Optom Count
            </a>
          </div>
        </div>
        
        {error && (
            <div className="w-full p-4 bg-red-50 border border-red-200 rounded-md">
                <div className="flex">
                    <div className="flex-shrink-0">
                        <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                    </div>
                    <div className="ml-3">
                        <h3 className="text-sm font-medium text-red-800">Error</h3>
                        <div className="mt-2 text-sm text-red-700">
                            {error}
                        </div>
                    </div>
                </div>
            </div>
        )}
        
        <Table data={res} loading={loading} />
      </div>
    </div>
  );
}
