"use client"

import { useState, useEffect, useMemo } from "react";
import { SlotMismatch, AppointmentConflict } from "@/lib/changeProcessor";
import { X, ChevronDown, ChevronUp } from "lucide-react";

interface AlertToastProps {
    slotMismatches: SlotMismatch[];
    appointmentConflicts: AppointmentConflict[];
}

// localStorage key for dismissed alerts
const DISMISSED_ALERTS_KEY = "dismissedAlerts";

// 주(week)의 시작일(일요일)을 계산하는 함수
function getWeekStart(dateStr: string): string {
    const dateMatch = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) return dateStr;
    
    const date = new Date(dateMatch[1] + 'T00:00:00');
    const dayOfWeek = date.getDay(); // 0(일요일) ~ 6(토요일)
    
    // 일요일까지의 일수 계산
    const daysToSunday = -dayOfWeek;
    
    // 해당 주의 일요일
    const sunday = new Date(date);
    sunday.setDate(date.getDate() + daysToSunday);
    
    // YYYY-MM-DD 형식으로 반환
    const year = sunday.getFullYear();
    const month = String(sunday.getMonth() + 1).padStart(2, '0');
    const day = String(sunday.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
}

// Generate unique ID for each alert (주별로 그룹화)
function getAlertId(type: "slot" | "conflict", item: SlotMismatch | AppointmentConflict): string {
    if (type === "slot") {
        const mismatch = item as SlotMismatch;
        // 주의 시작일(일요일)을 계산하여 그룹화
        const weekStart = getWeekStart(mismatch.date);
        // 주와 브랜치만으로 그룹화 (같은 주, 같은 브랜치는 하나의 alert로)
        return `slot-${mismatch.branch}-${weekStart}`;
    } else {
        const conflict = item as AppointmentConflict;
        // 주의 시작일(일요일)을 계산하여 그룹화
        const weekStart = getWeekStart(conflict.date);
        // 주와 브랜치만으로 그룹화 (같은 주, 같은 브랜치는 하나의 alert로)
        return `conflict-${conflict.branch}-${weekStart}`;
    }
}

// Load dismissed alerts from localStorage
function loadDismissedAlerts(): Set<string> {
    if (typeof window === "undefined") return new Set();
    
    try {
        const stored = localStorage.getItem(DISMISSED_ALERTS_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            return new Set(parsed);
        }
    } catch (error) {
        console.error("Failed to load dismissed alerts:", error);
    }
    return new Set();
}

// Save dismissed alerts to localStorage
function saveDismissedAlerts(dismissed: Set<string>) {
    if (typeof window === "undefined") return;
    
    try {
        localStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify(Array.from(dismissed)));
    } catch (error) {
        console.error("Failed to save dismissed alerts:", error);
    }
}

// Remove a specific alert from localStorage (X 버튼 클릭 시)
function removeDismissedAlert(alertId: string) {
    if (typeof window === "undefined") return;
    
    try {
        const stored = localStorage.getItem(DISMISSED_ALERTS_KEY);
        if (stored) {
            const dismissed = new Set(JSON.parse(stored));
            dismissed.delete(alertId);
            // localStorage에서 완전히 제거
            if (dismissed.size === 0) {
                localStorage.removeItem(DISMISSED_ALERTS_KEY);
            } else {
                localStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify(Array.from(dismissed)));
            }
        }
    } catch (error) {
        console.error("Failed to remove dismissed alert:", error);
    }
}

export default function AlertToast({ slotMismatches, appointmentConflicts }: AlertToastProps) {
    // X 버튼으로 삭제된 경고들을 추적하는 state
    const [deletedAlerts, setDeletedAlerts] = useState<Set<string>>(new Set());
    const [isVisible, setIsVisible] = useState(true); // 초기값을 true로 설정
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    // 컴포넌트 마운트 시 초기화
    useEffect(() => {
        setIsVisible(true);
    }, []);

    // 주별로 그룹화하여 중복 제거 및 X 버튼으로 삭제된 경고 필터링
    const { visibleSlotMismatches, slotMismatchesByWeek } = useMemo(() => {
        const slotMismatchesByWeek = new Map<string, SlotMismatch[]>();
        
        slotMismatches.forEach(item => {
            const alertId = getAlertId("slot", item);
            
            // X 버튼으로 삭제된 경고는 건너뛰기
            if (deletedAlerts.has(alertId)) {
                return;
            }
            
            // 주별로 그룹화
            if (!slotMismatchesByWeek.has(alertId)) {
                slotMismatchesByWeek.set(alertId, []);
            }
            slotMismatchesByWeek.get(alertId)!.push(item);
        });
        
        // 각 주별로 첫 번째 항목만 사용 (대표 항목)
        const visibleSlotMismatches = Array.from(slotMismatchesByWeek.entries()).map(([alertId, items]) => items[0]);
        
        return { visibleSlotMismatches, slotMismatchesByWeek };
    }, [slotMismatches, deletedAlerts]);
    
    const { visibleAppointmentConflicts, appointmentConflictsByWeek } = useMemo(() => {
        const appointmentConflictsByWeek = new Map<string, AppointmentConflict[]>();
        
        appointmentConflicts.forEach(item => {
            const alertId = getAlertId("conflict", item);
            
            // X 버튼으로 삭제된 경고는 건너뛰기
            if (deletedAlerts.has(alertId)) {
                return;
            }
            
            // 주별로 그룹화
            if (!appointmentConflictsByWeek.has(alertId)) {
                appointmentConflictsByWeek.set(alertId, []);
            }
            appointmentConflictsByWeek.get(alertId)!.push(item);
        });
        
        // 각 주별로 첫 번째 항목만 사용 (대표 항목)
        const visibleAppointmentConflicts = Array.from(appointmentConflictsByWeek.entries()).map(([alertId, items]) => items[0]);
        
        return { visibleAppointmentConflicts, appointmentConflictsByWeek };
    }, [appointmentConflicts, deletedAlerts]);

    const hasAlerts = visibleSlotMismatches.length > 0 || visibleAppointmentConflicts.length > 0;
    
    // 디버깅: 필터링 결과 확인
    useEffect(() => {
        console.log("[AlertToast] Filtering results:", {
            totalSlotMismatches: slotMismatches.length,
            visibleSlotMismatches: visibleSlotMismatches.length,
            totalAppointmentConflicts: appointmentConflicts.length,
            visibleAppointmentConflicts: visibleAppointmentConflicts.length,
            deletedAlertsCount: deletedAlerts.size,
            slotMismatchesData: slotMismatches,
            appointmentConflictsData: appointmentConflicts
        });
        
        if (slotMismatches.length > 0 && visibleSlotMismatches.length === 0) {
            console.warn("[AlertToast] WARNING: All slot mismatches are filtered out!");
        }
        if (appointmentConflicts.length > 0 && visibleAppointmentConflicts.length === 0) {
            console.warn("[AlertToast] WARNING: All appointment conflicts are filtered out!");
        }
    }, [slotMismatches, appointmentConflicts, deletedAlerts]);
    
    // Log props changes for debugging
    useEffect(() => {
        console.log("[AlertToast] Props updated:", {
            slotMismatches: slotMismatches.length,
            appointmentConflicts: appointmentConflicts.length,
            slotMismatchesData: slotMismatches,
            appointmentConflictsData: appointmentConflicts
        });
    }, [slotMismatches, appointmentConflicts]);
    
    // Debug log
    useEffect(() => {
        console.log("[AlertToast] Render state:", {
            hasAlerts,
            isVisible,
            visibleSlotMismatches: visibleSlotMismatches.length,
            visibleAppointmentConflicts: visibleAppointmentConflicts.length,
            totalSlotMismatches: slotMismatches.length,
            totalAppointmentConflicts: appointmentConflicts.length,
            deletedAlertsCount: deletedAlerts.size
        });
    }, [slotMismatches, appointmentConflicts, deletedAlerts, isVisible]);

    // Auto-expand first alert when new alerts arrive
    useEffect(() => {
        if (visibleSlotMismatches.length > 0 || visibleAppointmentConflicts.length > 0) {
            const firstSlotId = visibleSlotMismatches.length > 0 
                ? getAlertId("slot", visibleSlotMismatches[0])
                : null;
            const firstConflictId = visibleAppointmentConflicts.length > 0
                ? getAlertId("conflict", visibleAppointmentConflicts[0])
                : null;
            
            const firstAlertId = firstSlotId || firstConflictId;
            
            if (firstAlertId) {
                setExpanded(prev => {
                    if (!prev.has(firstAlertId)) {
                        console.log("[AlertToast] Auto-expanding first alert:", firstAlertId);
                        return new Set([firstAlertId]);
                    }
                    return prev;
                });
            }
        }
    }, [slotMismatches, appointmentConflicts, deletedAlerts]);

    const handleDismiss = (type: "slot" | "conflict", item: SlotMismatch | AppointmentConflict) => {
        const alertId = getAlertId(type, item);
        // X를 누르면 localStorage에서 해당 항목을 삭제
        removeDismissedAlert(alertId);
        // deletedAlerts에 추가하여 즉시 화면에서 사라지게 함
        setDeletedAlerts(prev => {
            const newDeleted = new Set(prev);
            newDeleted.add(alertId);
            return newDeleted;
        });
        console.log("[AlertToast] Removed alert from localStorage and marked as deleted:", alertId);
    };

    const toggleExpand = (alertId: string) => {
        const newExpanded = new Set(expanded);
        if (newExpanded.has(alertId)) {
            newExpanded.delete(alertId);
        } else {
            newExpanded.add(alertId);
        }
        setExpanded(newExpanded);
    };

    // 디버깅: 렌더링 조건 확인
    console.log("[AlertToast] Render check:", {
        hasAlerts,
        isVisible,
        willRender: hasAlerts && isVisible,
        slotMismatchesLength: slotMismatches.length,
        appointmentConflictsLength: appointmentConflicts.length,
        visibleSlotMismatchesLength: visibleSlotMismatches.length,
        visibleAppointmentConflictsLength: visibleAppointmentConflicts.length
    });

    if (!hasAlerts || !isVisible) {
        console.log("[AlertToast] Not rendering - hasAlerts:", hasAlerts, "isVisible:", isVisible);
        return null;
    }
    
    console.log("[AlertToast] Rendering alerts - slotMismatches:", visibleSlotMismatches.length, "appointmentConflicts:", visibleAppointmentConflicts.length);

    return (
        <div className="fixed top-4 right-4 z-50 flex flex-col items-end gap-2 max-h-[calc(100vh-2rem)] overflow-y-auto">
            {/* Slot Mismatches */}
            {visibleSlotMismatches.map((mismatch, index) => {
                const alertId = getAlertId("slot", mismatch);
                const isExpanded = expanded.has(alertId);
                // 해당 주의 모든 항목 가져오기
                const allItemsForWeek = slotMismatchesByWeek.get(alertId) || [mismatch];
                const totalCount = allItemsForWeek.length;
                
                // 주의 시작일과 끝일 계산
                const weekStart = getWeekStart(mismatch.date);
                const weekStartDate = new Date(weekStart + 'T00:00:00');
                const weekEndDate = new Date(weekStartDate);
                weekEndDate.setDate(weekStartDate.getDate() + 6);
                const weekEnd = `${weekEndDate.getFullYear()}-${String(weekEndDate.getMonth() + 1).padStart(2, '0')}-${String(weekEndDate.getDate()).padStart(2, '0')}`;
                
                return (
                    <div
                        key={alertId}
                        className="flex items-start gap-2 animate-slide-in-right"
                        style={{
                            animationDelay: `${index * 0.1}s`,
                        }}
                    >
                        {/* Expanded Card */}
                        {isExpanded && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg shadow-lg w-96 max-h-96 overflow-y-auto">
                                <div className="p-4">
                                    <div className="flex items-start gap-3">
                                        <div className="flex-shrink-0 mt-0.5">
                                            <svg className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                            </svg>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-start justify-between gap-2">
                                                <div>
                                                    <h3 className="text-sm font-medium text-amber-800">
                                                        Slot Mismatch {totalCount > 1 && `(${totalCount} items)`}
                                                    </h3>
                                                    <p className="text-xs text-amber-600 mt-0.5">
                                                        {mismatch.branchName} ({mismatch.branch}) - Week of {weekStart}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        onClick={() => toggleExpand(alertId)}
                                                        className="flex-shrink-0 text-amber-400 hover:text-amber-600 transition-colors"
                                                        aria-label="Collapse"
                                                    >
                                                        <ChevronUp className="h-4 w-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDismiss("slot", mismatch)}
                                                        className="flex-shrink-0 text-amber-400 hover:text-amber-600 transition-colors"
                                                        aria-label="Dismiss alert"
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="mt-2 text-sm text-amber-700 space-y-2">
                                                {allItemsForWeek.map((item, idx) => (
                                                    <div key={idx} className="border-b border-amber-200 pb-2 last:border-0 last:pb-0">
                                                        <p className="text-xs font-medium">
                                                            {item.date} - {item.name}
                                                            {item.optomId > 0 && ` (OptomId: ${item.optomId})`}
                                                        </p>
                                                        <p className="text-xs text-amber-600">
                                                            EH: {item.employmentHeroSlots} slots | Optomate: {item.optomateSlots} slots
                                                        </p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        
                        {/* Collapsed Icon Button */}
                        {!isExpanded && (
                            <button
                                onClick={() => toggleExpand(alertId)}
                                className="bg-amber-50 border border-amber-200 rounded-lg shadow-lg p-3 hover:bg-amber-100 transition-colors group relative"
                                aria-label="Expand alert"
                            >
                                <svg className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                                {totalCount > 1 && (
                                    <span className="absolute -top-1 -right-1 bg-amber-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                                        {totalCount}
                                    </span>
                                )}
                                {/* Tooltip on hover */}
                                <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                    {mismatch.branchName} - Week of {weekStart} {totalCount > 1 && `(${totalCount} items)`}
                                </div>
                            </button>
                        )}
                    </div>
                );
            })}

            {/* Appointment Conflicts */}
            {visibleAppointmentConflicts.map((conflict, index) => {
                const alertId = getAlertId("conflict", conflict);
                const isExpanded = expanded.has(alertId);
                // 해당 주의 모든 항목 가져오기
                const allItemsForWeek = appointmentConflictsByWeek.get(alertId) || [conflict];
                const totalCount = allItemsForWeek.length;
                
                // 주의 시작일과 끝일 계산
                const weekStart = getWeekStart(conflict.date);
                const weekStartDate = new Date(weekStart + 'T00:00:00');
                const weekEndDate = new Date(weekStartDate);
                weekEndDate.setDate(weekStartDate.getDate() + 6);
                const weekEnd = `${weekEndDate.getFullYear()}-${String(weekEndDate.getMonth() + 1).padStart(2, '0')}-${String(weekEndDate.getDate()).padStart(2, '0')}`;
                
                return (
                    <div
                        key={alertId}
                        className="flex items-start gap-2 animate-slide-in-right"
                        style={{
                            animationDelay: `${(visibleSlotMismatches.length + index) * 0.1}s`,
                        }}
                    >
                        {/* Expanded Card */}
                        {isExpanded && (
                            <div className="bg-red-50 border border-red-200 rounded-lg shadow-lg w-96 max-h-96 overflow-y-auto">
                                <div className="p-4">
                                    <div className="flex items-start gap-3">
                                        <div className="flex-shrink-0 mt-0.5">
                                            <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                            </svg>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-start justify-between gap-2">
                                                <div>
                                                    <h3 className="text-sm font-medium text-red-800">
                                                        Appointment Conflict {totalCount > 1 && `(${totalCount} items)`}
                                                    </h3>
                                                    <p className="text-xs text-red-600 mt-0.5">
                                                        {conflict.branchName} ({conflict.branch}) - Week of {weekStart}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        onClick={() => toggleExpand(alertId)}
                                                        className="flex-shrink-0 text-red-400 hover:text-red-600 transition-colors"
                                                        aria-label="Collapse"
                                                    >
                                                        <ChevronUp className="h-4 w-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDismiss("conflict", conflict)}
                                                        className="flex-shrink-0 text-red-400 hover:text-red-600 transition-colors"
                                                        aria-label="Dismiss alert"
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="mt-2 text-sm text-red-700 space-y-2">
                                                {allItemsForWeek.map((item, idx) => (
                                                    <div key={idx} className="border-b border-red-200 pb-2 last:border-0 last:pb-0">
                                                        <p className="text-xs font-medium">
                                                            {item.date} - {item.name}
                                                            {item.optomId > 0 && ` (OptomId: ${item.optomId})`}
                                                        </p>
                                                        <p className="text-xs text-red-600">
                                                            Time: {item.startTime.split('T')[1].substring(0, 5)} - {item.endTime.split('T')[1].substring(0, 5)} | 
                                                            {item.changeType === 'roster_deleted' ? ' Deleted' : ' Changed'}
                                                        </p>
                                                        <p className="text-xs text-red-600">
                                                            Email: {item.email}
                                                        </p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        
                        {/* Collapsed Icon Button */}
                        {!isExpanded && (
                            <button
                                onClick={() => toggleExpand(alertId)}
                                className="bg-red-50 border border-red-200 rounded-lg shadow-lg p-3 hover:bg-red-100 transition-colors group relative"
                                aria-label="Expand alert"
                            >
                                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                </svg>
                                {totalCount > 1 && (
                                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                                        {totalCount}
                                    </span>
                                )}
                                {/* Tooltip on hover */}
                                <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                    {conflict.branchName} - Week of {weekStart} {totalCount > 1 && `(${totalCount} items)`}
                                </div>
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

