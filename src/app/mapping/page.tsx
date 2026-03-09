"use client";

import { useEffect, useState, useCallback } from "react";

interface EHEmployee {
    id: number;
    name: string;
}

interface Mapping {
    sheet_name: string;
    employee_id: number;
    employee_name: string;
    updated_at: string;
}

interface UnresolvedEntry {
    sheet_name: string;
    selected_id: number | null;
}

export default function MappingPage() {
    const [ehEmployees, setEhEmployees] = useState<EHEmployee[]>([]);
    const [mappings, setMappings] = useState<Mapping[]>([]);
    const [unresolved, setUnresolved] = useState<UnresolvedEntry[]>([]);
    const [search, setSearch] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [dryRunLoading, setDryRunLoading] = useState(false);
    const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
    const [week, setWeek] = useState<string>("");

    const showToast = (msg: string, ok = true) => {
        setToast({ msg, ok });
        setTimeout(() => setToast(null), 3000);
    };

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [empRes, mapRes] = await Promise.all([
                fetch("/api/employee-mapping/eh-employees").then((r) => r.json()),
                fetch("/api/employee-mapping").then((r) => r.json()),
            ]);
            setEhEmployees(empRes.data ?? []);
            setMappings(mapRes.data ?? []);
        } catch {
            showToast("데이터 로딩 실패", false);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const runDryRun = async () => {
        setDryRunLoading(true);
        try {
            const weekParam = week ? `&week=${week}` : "";
        const res = await fetch(`/api/roster/sheet-sync?dryRun=true${weekParam}`).then((r) => r.json());
            const shifts = res.data?.shifts ?? [];
            const names = [...new Set(
                shifts.filter((s: { resolved: boolean }) => !s.resolved)
                      .map((s: { employeeName: string }) => s.employeeName as string)
            )] as string[];

            // 이미 매핑된 이름 제외
            const mappedNames = new Set(mappings.map((m) => m.sheet_name));
            const newUnresolved = names
                .filter((n) => !mappedNames.has(n))
                .map((n) => ({ sheet_name: n, selected_id: null }));

            setUnresolved(newUnresolved);
            if (newUnresolved.length === 0) {
                showToast("미매핑 직원이 없어요!");
            }
        } catch {
            showToast("드라이런 실패", false);
        } finally {
            setDryRunLoading(false);
        }
    };

    const saveMapping = async (sheetName: string, employeeId: number) => {
        const emp = ehEmployees.find((e) => e.id === employeeId);
        if (!emp) return;

        setSaving(sheetName);
        try {
            const res = await fetch("/api/employee-mapping", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sheet_name: sheetName,
                    employee_id: employeeId,
                    employee_name: emp.name,
                }),
            });
            if (!res.ok) throw new Error();
            showToast(`"${sheetName}" 매핑 저장됨`);
            setUnresolved((prev) => prev.filter((u) => u.sheet_name !== sheetName));
            await loadData();
        } catch {
            showToast("저장 실패", false);
        } finally {
            setSaving(null);
        }
    };

    const deleteMapping = async (sheetName: string) => {
        setDeleting(sheetName);
        try {
            await fetch("/api/employee-mapping", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sheet_name: sheetName }),
            });
            showToast(`"${sheetName}" 삭제됨`);
            await loadData();
        } catch {
            showToast("삭제 실패", false);
        } finally {
            setDeleting(null);
        }
    };

    const filteredEmployees = (sheetName: string) => {
        const q = (search[sheetName] ?? "").toLowerCase();
        if (!q) return ehEmployees;
        return ehEmployees.filter((e) => e.name.toLowerCase().includes(q));
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen bg-black text-white">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-blue-500" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-white p-6 max-w-3xl mx-auto">
            {/* Toast */}
            {toast && (
                <div className={`fixed top-4 right-4 px-4 py-2 rounded text-sm z-50 ${toast.ok ? "bg-green-700" : "bg-red-700"}`}>
                    {toast.msg}
                </div>
            )}

            <div className="flex items-center justify-between mb-6">
                <h1 className="text-xl font-bold">직원 이름 매핑</h1>
                <div className="flex items-center gap-2">
                    <input
                        type="number"
                        min={1}
                        placeholder="주차 (예: 1)"
                        value={week}
                        onChange={(e) => setWeek(e.target.value)}
                        className="bg-gray-800 text-white text-sm rounded px-2 py-2 w-28 border border-gray-700 focus:outline-none focus:border-blue-500"
                    />
                    <button
                        onClick={runDryRun}
                        disabled={dryRunLoading}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm disabled:opacity-50"
                    >
                        {dryRunLoading ? "확인 중..." : "미매핑 직원 불러오기"}
                    </button>
                </div>
            </div>

            {/* 미매핑 섹션 */}
            {unresolved.length > 0 && (
                <div className="mb-8">
                    <h2 className="text-sm font-semibold text-gray-400 uppercase mb-3">
                        미매핑 ({unresolved.length}명)
                    </h2>
                    <div className="space-y-2">
                        {unresolved.map((u) => {
                            const options = filteredEmployees(u.sheet_name);
                            return (
                                <div key={u.sheet_name} className="flex items-center gap-3 bg-gray-900 rounded px-4 py-3">
                                    <span className="w-36 text-sm font-medium text-yellow-400 shrink-0">
                                        {u.sheet_name}
                                    </span>
                                    <input
                                        type="text"
                                        placeholder="EH 이름 검색..."
                                        value={search[u.sheet_name] ?? ""}
                                        onChange={(e) =>
                                            setSearch((prev) => ({ ...prev, [u.sheet_name]: e.target.value }))
                                        }
                                        className="bg-gray-800 text-white text-sm rounded px-2 py-1 w-40 border border-gray-700 focus:outline-none focus:border-blue-500"
                                    />
                                    <select
                                        value={u.selected_id ?? ""}
                                        onChange={(e) => {
                                            const id = Number(e.target.value) || null;
                                            setUnresolved((prev) =>
                                                prev.map((x) =>
                                                    x.sheet_name === u.sheet_name ? { ...x, selected_id: id } : x
                                                )
                                            );
                                        }}
                                        className="bg-gray-800 text-white text-sm rounded px-2 py-1 flex-1 border border-gray-700 focus:outline-none focus:border-blue-500"
                                    >
                                        <option value="">-- EH 직원 선택 --</option>
                                        {options.map((e) => (
                                            <option key={e.id} value={e.id}>
                                                {e.name}
                                            </option>
                                        ))}
                                    </select>
                                    <button
                                        disabled={!u.selected_id || saving === u.sheet_name}
                                        onClick={() => u.selected_id && saveMapping(u.sheet_name, u.selected_id)}
                                        className="px-3 py-1 bg-green-700 hover:bg-green-600 rounded text-sm disabled:opacity-40 shrink-0"
                                    >
                                        {saving === u.sheet_name ? "..." : "저장"}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* 저장된 매핑 목록 */}
            <div>
                <h2 className="text-sm font-semibold text-gray-400 uppercase mb-3">
                    저장된 매핑 ({mappings.length}개)
                </h2>
                {mappings.length === 0 ? (
                    <p className="text-gray-500 text-sm">저장된 매핑이 없어요.</p>
                ) : (
                    <div className="space-y-2">
                        {mappings.map((m) => (
                            <div key={m.sheet_name} className="flex items-center gap-3 bg-gray-900 rounded px-4 py-3">
                                <span className="w-36 text-sm font-medium text-green-400 shrink-0">
                                    {m.sheet_name}
                                </span>
                                <span className="text-gray-400 text-sm">→</span>
                                <span className="flex-1 text-sm">{m.employee_name}</span>
                                <span className="text-xs text-gray-600">id: {m.employee_id}</span>
                                <button
                                    onClick={() => deleteMapping(m.sheet_name)}
                                    disabled={deleting === m.sheet_name}
                                    className="px-3 py-1 bg-red-900 hover:bg-red-700 rounded text-xs disabled:opacity-40 shrink-0"
                                >
                                    {deleting === m.sheet_name ? "..." : "삭제"}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
