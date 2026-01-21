import {I1001TableType} from "@/types/api_response";
import {OptomMap} from "@/data/stores";
import {cn} from "@/lib/utils";
import React from "react";

interface TableProps {
  data?: I1001TableType;
  loading?: boolean;
}

// eslint-disable-next-line react/display-name
const Table = React.memo(({ data = {}, loading }: TableProps) => {
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="w-full h-full overflow-x-auto border border-gray-300">
      <table className="min-w-full border-collapse">
        {/* 스토어 이름 행 */}
        <thead className={"sticky top-0 z-10"}>
          {/* 요일 헤더 행 */}
          <tr>
            <th
                key={"store"}
                className="bg-gray-100 font-semibold text-center py-3 px-4"
            >
              Store
            </th>
            {daysOfWeek.map((day, index) => (
              <th 
                key={index}
                className="sticky top-0 z-10  bg-gray-100 font-semibold text-center py-3 px-4"
              >
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? <tr>
            <td colSpan={8} className={'w-full h-full'}>
              <div role="status" className={"flex justify-center items-center h-[580px]"}>
                <svg aria-hidden="true" className="w-8 h-8 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor"/>
                  <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill"/>
                </svg>
                <span className="sr-only">Loading...</span>
              </div>
            </td>
          </tr> : Object.keys(data).length ? 
          // OptomMap 순서대로 스토어를 표시
          OptomMap
            .filter(store => data[store.LocationId.toString()]) // data에 있는 스토어만 필터링
            .map(store => {
              const key = store.LocationId.toString();
              return (
                <tr key={key+"store"}>
                  <td
                      key={key}
                      className="py-2 px-3 border-b border-gray-200 text-center w-[90px] h-[52px]"
                  >
                    {store.StoreName}
                  </td>
                  {daysOfWeek.map((_, dayIndex) => (
                      <td
                          key={dayIndex}
                          className={"w-[90px] h-[52px]"}
                      >
                        <div className={"text-center flex flex-col justify-start items-start w-full h-full border-b border-gray-200"}>
                        {
                          data[key][dayIndex]?.map((v,i) => (
                              <div key={i} className={cn("py-2 px-3 w-full", v.name ? "" : "bg-red-300")}>
                                {v.name || ''} <br/>
                                {v.start || ''}-{v.end || ''}
                              </div>
                            )
                          )
                        }
                        </div>
                      </td>
                  ))}
                </tr>
              );
            }) : <tr>
            <td colSpan={8} className={'w-full h-full'}>
              <div className={"flex justify-center items-center h-[580px]"}>
                <p className={"text-gray-400"}>EMPTY DATA</p>
              </div>
            </td>
          </tr>}

        </tbody>
      </table>
    </div>
  );
});

export default Table;