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
        const dow = new Date(r.startTime).getDay(); // 또는 DB에서 같이 가져오기
        roster[loc][dow].push({
            name: r.employeeName.split(" ")[0],
            start: getMinNHour(r.startTime.slice(11,16)),
            end:   getMinNHour(r.endTime.slice(11,16)),
        });
    }
    return roster;
}