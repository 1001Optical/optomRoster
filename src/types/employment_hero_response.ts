// 날짜·시간 형식(ISO 8601)의 문자열을 뜻하는 별칭 (가독성용)
type ISODateTimeString = string;

// 필요 시 더 넓은 문자열을 허용하면서 'Assigned'는 자동 완성 지원
type ShiftAssignmentStatus = 'Assigned' | (string & {});

export interface ShiftBreak {
    id: number;
    startTime: ISODateTimeString; // 예: "2025-09-07T12:00:00"
    endTime: ISODateTimeString;   // 예: "2025-09-07T12:30:00"
    isPaidBreak: boolean;
}

export interface Shift {
    classificationId: number | null;
    classificationName: string | null;

    description: string;
    isDifferent: boolean;

    fullyQualifiedLocationName: string;
    warnings: string[];           // 예시 데이터는 빈 배열

    id: number;
    token: string | null;

    qualifications: string[];     // 예시 데이터는 빈 배열
    breaks: ShiftBreak[];

    employeeId: number;
    employeeName: string;

    locationId: number;
    locationName: string;

    workTypeId: number | null;
    workTypeName: string;         // 빈 문자열 가능

    role: string | null;

    startTime: ISODateTimeString; // 예: "2025-09-07T09:00:00"
    endTime: ISODateTimeString;   // 예: "2025-09-07T17:00:00"

    notes: string | null;

    published: boolean;
    accepted: boolean;

    pendingSwap: unknown | null;

    datePublished: ISODateTimeString | null;

    biddable: boolean;
    shiftSwapCutoffTime: ISODateTimeString | null;

    shiftAssignmentStatus: ShiftAssignmentStatus; // 예: 'Assigned'
}