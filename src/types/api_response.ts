export interface I1001Response<T> {
    message: string;
    data?: T;
}

export interface I1001RosterData {
    id: number,
    employeeId: number,
    firstName: string,
    lastName: string,
    locationId: number,
    locationName: string,
    startTime: string,
    endTime: string,
    email: string,
    day: string,
    dow: number,
    hhmmStart: string,
    hhmmEnd: string
}

export interface I1001TableType {
    [location: string]: { name: string, start: string, end: string}[][]
}