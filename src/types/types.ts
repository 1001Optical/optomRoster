// ===== DATABASE TABLE TYPES =====

// ROSTER table
export interface Roster {
    id: number;
    employeeId: number | null;
    employeeName: string | null;
    locationId: number;
    locationName: string;
    startTime: string;
    endTime: string;
}

// ROSTER_BREAK table
export interface RosterBreak {
    id: number;
    rosterId: number;
    startTime: string;
    endTime: string;
    isPaidBreak: number; // 0 or 1 (boolean as integer)
}

// OPTOMETRISTS table
export interface Optometrist {
    id: number;
    identifier: string;
    given_name: string;
    surname: string;
    branch_identifier: string | null;
    inactive: boolean | null;
}

// CHANGE_LOG table
export interface ChangeLog {
    id: number;
    rosterId: string;
    changeType: 'roster_changed' | 'roster_inserted' | 'roster_deleted';
    whenDetected: string;
    windowStart: string;
    windowEnd: string;
    diffSummary: string | null; // JSON string
}

// ===== COMPOSITE TYPES =====

// Roster with breaks (for API responses)
export interface RosterWithBreaks extends Roster {
    breaks: RosterBreak[];
}

// Change log with parsed diff summary
export interface ChangeLogWithDiff extends Omit<ChangeLog, 'diffSummary'> {
    diffSummary: {
        old?: Partial<Roster>;
        new?: Partial<Roster>;
    } | null;
}

// ===== API RESPONSE TYPES =====

// Legacy interface (keeping for backward compatibility)
export interface optomData {
    id: number;
    employeeId: number;
    firstName: string;
    lastName: string;
    locationId: number;
    locationName: string;
    startTime: string;
    endTime: string;
    isLocum: number;
    email: string;
    breaks?: {
        id: number;
        startTime: string;
        endTime: string;
        isPaidBreak: number;
    }[];
}

// ===== UTILITY TYPES =====

// Database row types for insert operations
export type RosterInsert = Omit<Roster, 'id'>;
export type RosterBreakInsert = Omit<RosterBreak, 'id'>;
export type OptometristInsert = Omit<Optometrist, 'id'>;
export type ChangeLogInsert = Omit<ChangeLog, 'id'>;

// Database row types for update operations
export type RosterUpdate = Partial<Omit<Roster, 'id'>>;
export type RosterBreakUpdate = Partial<Omit<RosterBreak, 'id'>>;
export type OptometristUpdate = Partial<Omit<Optometrist, 'id'>>;
export type ChangeLogUpdate = Partial<Omit<ChangeLog, 'id'>>;

// Query result types
export interface RosterQueryResult {
    roster: Roster;
    breaks: RosterBreak[];
}

export interface ChangeLogQueryResult {
    changeLog: ChangeLog;
    roster?: Roster; // Optional if roster still exists
}
