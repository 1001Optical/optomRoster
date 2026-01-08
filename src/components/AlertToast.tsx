"use client"

import { useState, useEffect } from "react";
import { SlotMismatch, AppointmentConflict } from "@/lib/changeProcessor";
import { X, ChevronDown, ChevronUp } from "lucide-react";

interface AlertToastProps {
    slotMismatches: SlotMismatch[];
    appointmentConflicts: AppointmentConflict[];
}

// localStorage key for dismissed alerts
const DISMISSED_ALERTS_KEY = "dismissedAlerts";

// Generate unique ID for each alert
function getAlertId(type: "slot" | "conflict", item: SlotMismatch | AppointmentConflict): string {
    if (type === "slot") {
        const mismatch = item as SlotMismatch;
        // date에서 날짜 부분만 추출 (YYYY-MM-DD 형식으로 정규화)
        const dateOnly = mismatch.date.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || mismatch.date;
        // name에서 공백 제거 및 정규화
        const normalizedName = mismatch.name.trim().replace(/\s+/g, ' ');
        return `slot-${mismatch.branch}-${dateOnly}-${mismatch.optomId}-${normalizedName}`;
    } else {
        const conflict = item as AppointmentConflict;
        // date에서 날짜 부분만 추출 (YYYY-MM-DD 형식으로 정규화)
        const dateOnly = conflict.date.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || conflict.date;
        // name에서 공백 제거 및 정규화
        const normalizedName = conflict.name.trim().replace(/\s+/g, ' ');
        return `conflict-${conflict.branch}-${dateOnly}-${conflict.optomId}-${normalizedName}`;
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

    // 중복 제거 및 X 버튼으로 삭제된 경고 필터링
    const seenSlotIds = new Set<string>();
    const visibleSlotMismatches = slotMismatches.filter(
        item => {
            const alertId = getAlertId("slot", item);
            
            // 중복 제거
            if (seenSlotIds.has(alertId)) {
                return false;
            }
            seenSlotIds.add(alertId);
            
            // X 버튼으로 삭제된 경고는 필터링
            if (deletedAlerts.has(alertId)) {
                return false;
            }
            
            return true;
        }
    );
    
    const seenConflictIds = new Set<string>();
    const visibleAppointmentConflicts = appointmentConflicts.filter(
        item => {
            const alertId = getAlertId("conflict", item);
            
            // 중복 제거
            if (seenConflictIds.has(alertId)) {
                return false;
            }
            seenConflictIds.add(alertId);
            
            // X 버튼으로 삭제된 경고는 필터링
            if (deletedAlerts.has(alertId)) {
                return false;
            }
            
            return true;
        }
    );

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
                            <div className="bg-amber-50 border border-amber-200 rounded-lg shadow-lg w-96">
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
                                                    <h3 className="text-sm font-medium text-amber-800">Slot Mismatch</h3>
                                                    <p className="text-xs text-amber-600 mt-0.5">
                                                        {mismatch.branchName} ({mismatch.branch})
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
                                            <div className="mt-2 text-sm text-amber-700 space-y-1">
                                                <p className="text-xs">
                                                    {mismatch.date} - {mismatch.name}
                                                    {mismatch.optomId > 0 && ` (OptomId: ${mismatch.optomId})`}
                                                </p>
                                                <p className="text-xs text-amber-600">
                                                    EH: {mismatch.employmentHeroSlots} slots | Optomate: {mismatch.optomateSlots} slots
                                                </p>
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
                                {/* Tooltip on hover */}
                                <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                    {mismatch.branchName} - {mismatch.date}
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
                            <div className="bg-red-50 border border-red-200 rounded-lg shadow-lg w-96">
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
                                                    <h3 className="text-sm font-medium text-red-800">Appointment Conflict</h3>
                                                    <p className="text-xs text-red-600 mt-0.5">
                                                        {conflict.branchName} ({conflict.branch})
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
                                            <div className="mt-2 text-sm text-red-700 space-y-1">
                                                <p className="text-xs">
                                                    {conflict.date} - {conflict.name}
                                                    {conflict.optomId > 0 && ` (OptomId: ${conflict.optomId})`}
                                                </p>
                                                <p className="text-xs text-red-600">
                                                    Time: {conflict.startTime.split('T')[1].substring(0, 5)} - {conflict.endTime.split('T')[1].substring(0, 5)} | 
                                                    {conflict.changeType === 'roster_deleted' ? ' Deleted' : ' Changed'}
                                                </p>
                                                <p className="text-xs text-red-600">
                                                    Email: {conflict.email}
                                                </p>
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
                                {/* Tooltip on hover */}
                                <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                    {conflict.branchName} - {conflict.date}
                                </div>
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

