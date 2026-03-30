'use client';

import React, { useState, useRef, useEffect } from 'react';
import { DayPicker, DateRange } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import {RiCalendarLine} from "react-icons/ri";

interface IooICalendarProps {
  selectedWeek?: DateRange;
  onWeekSelect?: (weekRange: DateRange | undefined) => void;
  className?: string;
}

export default function IooICalendar({ selectedWeek, onWeekSelect, className = '' }: IooICalendarProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [hoveredDay, setHoveredDay] = useState<Date | undefined>(undefined);
  const [displayMonth, setDisplayMonth] = React.useState<Date>(selectedWeek?.from || new Date());
  const calendarRef = useRef<HTMLDivElement>(null);

  // 캘린더가 열릴 때 선택된 주의 월로 포커스
  useEffect(() => {
    if (isOpen && selectedWeek?.from) {
      setDisplayMonth(selectedWeek.from);
    }
  }, [isOpen, selectedWeek]);

  // 외부 클릭 감지
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // 주 범위 계산 함수 (일요일부터 토요일까지)
  const getWeekRange = (date: Date): DateRange => {
    const dayOfWeek = date.getDay(); // 0 = 일요일, 1 = 월요일, ..., 6 = 토요일
    const sunday = new Date(date);
    sunday.setDate(date.getDate() - dayOfWeek);
    
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    
    return {
      from: sunday,
      to: saturday
    };
  };

  // 날짜 클릭 핸들러
  const handleDateClick = (date: Date | undefined) => {
    if (!date) return;
    
    const weekRange = getWeekRange(date);
    onWeekSelect?.(weekRange);
  };

  // 주 범위가 선택된 날짜들을 포함하는지 확인하는 함수
  const isDateInSelectedWeek = (date: Date): boolean => {
    if (!selectedWeek?.from || !selectedWeek?.to) return false;
    return date >= selectedWeek.from && date <= selectedWeek.to;
  };

  const dateFormat = (date: Date): string => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const year = pad(date.getFullYear())
    const month = pad(date.getMonth() + 1)
    const day = pad(date.getDate())
    return `${year}-${month}-${day}`
  }

  const startOfWeek = (d: Date) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - x.getDay()); // Sun=0
    return x;
  };
  const endOfWeek = (d: Date) => {
    const s = startOfWeek(d);
    const e = new Date(s);
    e.setDate(s.getDate() + 6);
    return e;
  };
  const isInSameWeek = (d: Date, ref: Date) => {
    const s = startOfWeek(ref);
    const e = endOfWeek(ref);
    return d >= s && d <= e;
  };

  return (
    <div className={'relative'} ref={calendarRef}>
      <div
        className={"w-[280px] border-gray-300 border rounded-xl px-3 py-1 flex flex-row justify-between items-center hover:cursor-pointer"}
        onClick={() => setIsOpen(!isOpen)}
      >
        <p className={'text-center'}>
          {selectedWeek?.from ? dateFormat(selectedWeek.from) : ""} {" ~ "}
          {selectedWeek?.to ? dateFormat(selectedWeek.to) : ""}
        </p>
        <div>
          <RiCalendarLine />
        </div>
      </div>
      {
        isOpen ? <div className={'absolute top-10 z-20'}>
          <div className={`p-6 bg-white rounded-lg shadow-lg border border-gray-300 ${className}`}>
            <div className="w-full">
              <div className="w-full [&_table]:w-full [&_table]:table-fixed [&_thead_tr]:flex [&_tbody_tr]:flex [&_th]:flex-1 [&_td]:flex-1 [&_th]:w-[14.28%] [&_td]:w-[14.28%] [&_th]:min-w-0 [&_td]:min-w-0 [&_th]:p-0 [&_td]:p-0 [&_th]:border-0 [&_td]:border-0">
                <DayPicker
                    mode="single"
                    selected={selectedWeek?.from}
                    month={displayMonth}
                    onMonthChange={setDisplayMonth}
                    onSelect={(v) => {
                      handleDateClick(v)
                      setIsOpen(false)
                    }}
                    // 모디파이어: 선택 주 + 호버 주
                    modifiers={{
                      selectedWeek: (date) => isDateInSelectedWeek(date),   // 기존
                      hoveredWeek: (date) => hoveredDay ? isInSameWeek(date, hoveredDay) : false,
                      hoveredWeekStart: (date) => hoveredDay ? date.getTime() === startOfWeek(hoveredDay).getTime() : false,
                      hoveredWeekEnd:   (date) => hoveredDay ? date.getTime() === endOfWeek(hoveredDay).getTime()   : false,
                    }}

                    // Select week style, Hover style
                    modifiersClassNames={{
                      selectedWeek:    'bg-blue-500 text-white',            // 선택 주(파란 바)
                      hoveredWeek:     'bg-blue-100',                       // 호버 주(연파랑 바)
                      hoveredWeekStart:'rounded-l-full',                    // 호버 주 왼쪽 캡
                      hoveredWeekEnd:  'rounded-r-full',                    // 호버 주 오른쪽 캡
                    }}

                    // ✅ hover 이벤트로 hoveredDay 갱신
                    onDayMouseEnter={(day) => setHoveredDay(day)}
                    onDayMouseLeave={() => setHoveredDay(undefined)}
                    className="w-full"
                    classNames={{
                      day: 'w-full h-10 flex items-center justify-center text-center rounded-none first:rounded-l-full last:rounded-r-full cursor-pointer',
                      day_selected: 'bg-blue-700 text-white font-bold shadow-md',
                      week: 'flex gap-0 w-full',
                      caption: 'font-semibold text-lg text-slate-800 mb-4',
                      nav_button: 'rounded-md p-2 transition-all duration-200 hover:bg-slate-100 hover:scale-105',
                      selected: 'border-none'
                    }}
                    showOutsideDays
                    fixedWeeks
                    weekStartsOn={0} // 일요일부터 시작
                />
              </div>
            </div>
          </div>
        </div> : <></>
      }
    </div>
  );
}
