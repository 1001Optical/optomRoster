export const pad = (n: number) => String(n).padStart(2, "0");

export function toLocalIsoNoOffset(d: Date) {
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const HH = pad(d.getHours());
    const MM = pad(d.getMinutes());
    const SS = pad(d.getSeconds());
    return `${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}Z`;
}

/**
 * Date 객체를 YYYY-MM-DD 형식의 날짜 문자열로 변환
 * API 호출 시 날짜만 필요한 경우 사용
 */
export function toDateOnly(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    return `${yyyy}-${mm}-${dd}`;
}

export function getDateNTime(date: string)  {
    const tmp = date.split('T')
    return {
        date: tmp[0],
        time: tmp[1],
    }
}

// npm i date-fns date-fns-tz
import {formatISO, addDays, startOfDay, endOfDay, format, parse} from 'date-fns';
import {formatInTimeZone, toZonedTime} from 'date-fns-tz';

export function sundayToSaturdayRange(tz = 'Australia/Sydney') {
    const now = new Date();
    const zonedNow = toZonedTime(now, tz);           // 오늘(현지시간)
    const dow = zonedNow.getDay();                      // 0=Sun ... 6=Sat

    // 저번 일요일(이번 주의 시작)
    const startLocal = new Date(
        zonedNow.getFullYear(), zonedNow.getMonth(), zonedNow.getDate() - dow
    );

    // 이번 토요일
    const endLocal = addDays(startLocal, 6);

    // 하루의 경계로 정리(현지)
    const start = startOfDay(startLocal);
    const end   = endOfDay(endLocal);

    // ISO 문자열(UTC 기준 ISO, 필요시 tz 로 포맷 변경 가능)
    return {
        startISO: formatISO(start),   // 예: 2025-10-05T00:00:00+11:00
        endISO:   formatISO(end),     // 예: 2025-10-11T23:59:59+11:00
        start, end
    };
}

const tz = "Australia/Sydney";

export function setTimeZone (time: string)  {
    const utcDate = new Date(time);
    return formatInTimeZone(utcDate, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

export function formatHm(hm: string) {
    // 오늘 날짜 기준으로 HH:mm 해석(로컬)
    const d = parse(hm, 'HH:mm:ss', new Date());
    return format(d, 'hh:mm a');
}

export function getTimezoneOffsetISO(date: string | Date): string {
    // getTimezoneOffset()은 "UTC - 로컬"을 분 단위로 줍니다.
    // 예: 시드니(UTC+10)는 -600 이 나옴
    const offsetMinutes = -new Date(date).getTimezoneOffset(); // 부호 뒤집기

    const sign = offsetMinutes >= 0 ? "+" : "-";
    const abs = Math.abs(offsetMinutes);
    const hours = String(Math.floor(abs / 60)).padStart(2, "0");
    const minutes = String(abs % 60).padStart(2, "0");

    return `${sign}${hours}:${minutes}`;
}
