"use client";

import { useEffect, useState } from "react";
import { OptomMap } from "@/data/stores";

/** 현재 날짜 기준 이번 달 몇 번째 주인지 계산 (1-5) */
function getWeekOfMonth(): number {
    return Math.ceil(new Date().getDate() / 7);
}

interface SyncResult {
    synced: number;
    skipped: number;
    created: number;
    updated: number;
    errors: string[];
    unresolvedNames?: string[];
    totalShifts?: number;
    resolvedCount?: number;
}

export default function SyncPage() {
    // Sheet 설정 상태
    const [sheetInput, setSheetInput] = useState("");
    const [savedSheetId, setSavedSheetId] = useState("");
    const [sheetSaving, setSheetSaving] = useState(false);

    // Sync 옵션 상태
    const [week, setWeek] = useState<string>("");
    const [store, setStore] = useState<string>("");
    const [dryRun, setDryRun] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
    const [syncError, setSyncError] = useState<string | null>(null);

    const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

    const showToast = (msg: string, ok = true) => {
        setToast({ msg, ok });
        setTimeout(() => setToast(null), 3000);
    };

    // 페이지 로드: 현재 설정값 및 기본 주차 세팅
    useEffect(() => {
        const currentWeek = getWeekOfMonth().toString();
        setWeek(currentWeek);

        fetch("/api/settings")
            .then((r) => r.json())
            .then((data) => {
                const id = data.google_sheet_id ?? "";
                setSavedSheetId(id);
                setSheetInput(id);
            })
            .catch(() => showToast("설정 로딩 실패", false));
    }, []);

    // Sheet ID/URL 저장
    const handleSheetSave = async () => {
        if (!sheetInput.trim()) {
            showToast("Sheet URL 또는 ID를 입력해주세요.", false);
            return;
        }
        setSheetSaving(true);
        try {
            const res = await fetch("/api/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ google_sheet_id: sheetInput }),
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(data.error ?? "저장 실패", false);
                return;
            }
            setSavedSheetId(data.google_sheet_id);
            setSheetInput(data.google_sheet_id);
            showToast("✅ Sheet ID 저장됨");
        } catch {
            showToast("저장 중 오류 발생", false);
        } finally {
            setSheetSaving(false);
        }
    };

    // Sync 실행
    const handleSync = async () => {
        setSyncing(true);
        setSyncResult(null);
        setSyncError(null);

        const params = new URLSearchParams();
        if (week) params.set("week", week);
        if (store) params.set("store", store);
        if (dryRun) params.set("dryRun", "true");

        try {
            const res = await fetch(`/api/roster/sheet-sync?${params.toString()}`);
            const data = await res.json();
            if (!res.ok) {
                setSyncError(data.error ?? data.message ?? "Sync 실패");
                return;
            }
            setSyncResult(data.data ?? data);
        } catch (e) {
            setSyncError(String(e));
        } finally {
            setSyncing(false);
        }
    };

    const storeOptions = OptomMap.map((s) => s.StoreName).sort();

    return (
        <div className="min-h-screen bg-black text-white p-8">
            <div className="max-w-2xl mx-auto space-y-8">
                <h1 className="text-2xl font-bold">🔄 Sync</h1>

                {/* ── Sheet 설정 ── */}
                <section className="bg-zinc-900 rounded-xl p-6 space-y-4">
                    <h2 className="text-lg font-semibold text-zinc-200">📋 Google Sheet</h2>

                    <div className="space-y-2">
                        <label className="text-sm text-zinc-400">Sheet URL 또는 ID</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={sheetInput}
                                onChange={(e) => setSheetInput(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleSheetSave()}
                                placeholder="https://docs.google.com/spreadsheets/d/..."
                                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                            />
                            <button
                                onClick={handleSheetSave}
                                disabled={sheetSaving}
                                className="px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
                            >
                                {sheetSaving ? "저장 중..." : "저장"}
                            </button>
                        </div>

                        {savedSheetId && (
                            <p className="text-xs text-zinc-500">
                                현재 적용됨:{" "}
                                <span className="text-zinc-300 font-mono">
                                    {savedSheetId.length > 40
                                        ? `${savedSheetId.slice(0, 20)}...${savedSheetId.slice(-12)}`
                                        : savedSheetId}
                                </span>
                            </p>
                        )}
                    </div>
                </section>

                {/* ── Sync 실행 ── */}
                <section className="bg-zinc-900 rounded-xl p-6 space-y-5">
                    <h2 className="text-lg font-semibold text-zinc-200">⚙️ Sync 옵션</h2>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-sm text-zinc-400">Week</label>
                            <input
                                type="number"
                                min={1}
                                max={53}
                                value={week}
                                onChange={(e) => setWeek(e.target.value)}
                                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="text-sm text-zinc-400">Store</label>
                            <select
                                value={store}
                                onChange={(e) => setStore(e.target.value)}
                                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                            >
                                <option value="">All stores</option>
                                {storeOptions.map((s) => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <label className="flex items-center gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={dryRun}
                            onChange={(e) => setDryRun(e.target.checked)}
                            className="w-4 h-4 rounded accent-blue-500"
                        />
                        <span className="text-sm text-zinc-300">
                            Dry Run{" "}
                            <span className="text-zinc-500">(실제 변경 없이 미리보기)</span>
                        </span>
                    </label>

                    <button
                        onClick={handleSync}
                        disabled={syncing || !savedSheetId}
                        className="w-full py-3 bg-green-700 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-semibold transition-colors"
                    >
                        {syncing ? "Sync 중..." : dryRun ? "🔍 Dry Run 실행" : "🚀 Sync 실행"}
                    </button>

                    {!savedSheetId && (
                        <p className="text-xs text-yellow-500 text-center">
                            ⚠️ Sheet ID를 먼저 설정해주세요.
                        </p>
                    )}
                </section>

                {/* ── Sync 결과 ── */}
                {syncError && (
                    <section className="bg-red-950 border border-red-800 rounded-xl p-5">
                        <p className="text-red-300 text-sm font-medium">❌ {syncError}</p>
                    </section>
                )}

                {syncResult && (
                    <section className="bg-zinc-900 rounded-xl p-6 space-y-4">
                        <h2 className="text-lg font-semibold text-zinc-200">
                            {dryRun ? "🔍 Dry Run 결과" : "✅ Sync 결과"}
                        </h2>

                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {[
                                { label: "Total", value: syncResult.totalShifts ?? syncResult.synced + syncResult.skipped, color: "text-zinc-300" },
                                { label: "Resolved", value: syncResult.resolvedCount ?? "-", color: "text-blue-400" },
                                { label: dryRun ? "To sync" : "Synced", value: dryRun ? (syncResult.resolvedCount ?? syncResult.synced) : syncResult.synced, color: "text-green-400" },
                                { label: "Skipped", value: syncResult.skipped, color: "text-zinc-400" },
                            ].map(({ label, value, color }) => (
                                <div key={label} className="bg-zinc-800 rounded-lg p-3 text-center">
                                    <p className={`text-2xl font-bold ${color}`}>{value}</p>
                                    <p className="text-xs text-zinc-500 mt-1">{label}</p>
                                </div>
                            ))}
                        </div>

                        {!dryRun && (
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-zinc-800 rounded-lg p-3 text-center">
                                    <p className="text-2xl font-bold text-yellow-400">{syncResult.created}</p>
                                    <p className="text-xs text-zinc-500 mt-1">Created</p>
                                </div>
                                <div className="bg-zinc-800 rounded-lg p-3 text-center">
                                    <p className="text-2xl font-bold text-orange-400">{syncResult.updated}</p>
                                    <p className="text-xs text-zinc-500 mt-1">Updated</p>
                                </div>
                            </div>
                        )}

                        {syncResult.unresolvedNames && syncResult.unresolvedNames.length > 0 && (
                            <div className="space-y-2">
                                <p className="text-sm text-yellow-400 font-medium">
                                    ⚠️ 미매핑 직원 ({syncResult.unresolvedNames.length}명)
                                </p>
                                <div className="bg-zinc-800 rounded-lg p-3 space-y-1">
                                    {syncResult.unresolvedNames.map((name) => (
                                        <p key={name} className="text-sm text-zinc-300 font-mono">
                                            {name}
                                        </p>
                                    ))}
                                </div>
                                <p className="text-xs text-zinc-500">
                                    <a href="/mapping" className="text-blue-400 hover:underline">
                                        /mapping 페이지
                                    </a>
                                    에서 매핑 후 다시 실행해주세요.
                                </p>
                            </div>
                        )}

                        {syncResult.errors && syncResult.errors.length > 0 && (
                            <div className="space-y-2">
                                <p className="text-sm text-red-400 font-medium">
                                    ❌ 에러 ({syncResult.errors.length}건)
                                </p>
                                <div className="bg-red-950 border border-red-800 rounded-lg p-3 space-y-1 max-h-48 overflow-y-auto">
                                    {syncResult.errors.map((err, i) => (
                                        <p key={i} className="text-xs text-red-300 font-mono">
                                            {err}
                                        </p>
                                    ))}
                                </div>
                            </div>
                        )}
                    </section>
                )}
            </div>

            {/* Toast */}
            {toast && (
                <div
                    className={`fixed bottom-6 right-6 px-4 py-3 rounded-lg text-sm font-medium shadow-lg transition-all ${
                        toast.ok ? "bg-green-800 text-green-100" : "bg-red-800 text-red-100"
                    }`}
                >
                    {toast.msg}
                </div>
            )}
        </div>
    );
}
