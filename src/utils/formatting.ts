import {I1001RosterData, I1001TableType} from "@/types/api_response";

const getMinNHour = (time:string) => {
    const [h, m] = time.split(":");
    return `${h}:${m}`;
}

export function formatting(rows: I1001RosterData[]) {
    const roster: I1001TableType = {};
    for (const r of rows) {
        const loc = r.locationId.toString();
        if (!roster[loc]) {
            roster[loc] = Array.from({ length: 7 }, () => []);
        }
        // DB에서 이미 계산된 dow 사용 (시간대 변환 문제 방지)
        // dow는 0=Sun, 1=Mon, ..., 6=Sat
        const dow = r.dow ?? new Date(r.startTime).getDay(); // fallback to Date calculation if dow not available
        roster[loc][dow].push({
            name: r.firstName,
            start: getMinNHour(r.startTime.slice(11,16)),
            end:   getMinNHour(r.endTime.slice(11,16)),
        });
    }
    return roster;
}