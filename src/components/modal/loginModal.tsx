'use client';

import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/services/apiFetch';

const FIXED_DOMAIN = '@1001optical.com.au';

type Mode = 'login' | 'signup';

interface LoginModalProps {
    open: boolean;
    onAuth?: (data: { id: string; role: 'ADMIN' | 'Staff' }) => void;
}

export default function LoginModal({open, onAuth,}: LoginModalProps) {
    // Login form
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    // Signup form (separate inputs)
    const [suEmail, setSuEmail] = useState('');
    const [suPassword, setSuPassword] = useState('');
    const [suConfirm, setSuConfirm] = useState('');
    const [suBranch, setSuBranch] = useState('');

    const [mode, setMode] = useState<Mode>('signup');
    const [error, setError] = useState('');
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const firstInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (open) {
            const prev = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            setTimeout(() => firstInputRef.current?.focus(), 0);
            return () => {
                document.body.style.overflow = prev;
            };
        } else {
            setError('');
            setPassword('');
        }
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const el = dialogRef.current;
        if (!el) return;

        const focusable = () =>
            Array.from(
                el.querySelectorAll<HTMLElement>(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                )
            ).filter((n) => !n.hasAttribute('disabled'));

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                return; // ESC close disabled
            }
            if (e.key === 'Tab') {
                const items = focusable();
                if (items.length === 0) return;
                const current = document.activeElement as HTMLElement | null;
                const idx = items.indexOf(current || items[0]);
                const nextIdx = e.shiftKey
                    ? idx <= 0
                        ? items.length - 1
                        : idx - 1
                    : idx === items.length - 1
                        ? 0
                        : idx + 1;
                e.preventDefault();
                items[nextIdx]?.focus();
            }
        };

        el.addEventListener('keydown', handleKeyDown);
        return () => el.removeEventListener('keydown', handleKeyDown);
    }, [open]);

    if (!open) return null;

    // Login validations
    const emailEmpty = email.trim().length === 0;
    const isDomainValidLogin = email.trim().toLowerCase().endsWith(FIXED_DOMAIN);
    const disabledLogin = emailEmpty || !isDomainValidLogin || !password;

    // Signup validations
    const suEmailEmpty = suEmail.trim().length === 0;
    const isDomainValidSignup = suEmail.trim().toLowerCase().endsWith(FIXED_DOMAIN);
    const isPwMatch = suPassword.length > 0 && suPassword === suConfirm;
    const disabledSignup = suEmailEmpty || !isDomainValidSignup || !isPwMatch;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    function mapError(status: number, _: unknown): string {
        if (status === 400) return 'Please enter required fields correctly';
        if (status === 401) return 'Invalid email or password';
        if (status === 409) return 'This email is already registered';
        return 'A temporary error occurred. Please try again';
    }

    async function submit(nextMode: Mode) {
        setMode(nextMode);
        setError('');
        const path = process.env.NEXT_PUBLIC_API_BASE_URL + nextMode === 'signup' ? '/auth/register' : '/auth/login';
        const payload =
            nextMode === 'signup'
                ? { email: suEmail.trim(), password: suPassword }
                : { email: email.trim(), password };

        try {
            const res = await apiFetch(path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({} as unknown));
                setError(mapError(res.status, data));
                return;
            }
            const data = await res.json(); // { id, role }
            onAuth?.(data);
        } catch (e) {
            setError('A temporary error occurred. Please try again');
            console.log(e)
        }
    }

    return (
        <div
            aria-modal="true"
            role="dialog"
            tabIndex={-1}
            ref={dialogRef}
            className="fixed inset-0 z-[1000] bg-black/50 backdrop-blur-[1px] flex items-center justify-center"
            onClick={(e) => {
                e.stopPropagation();
            }}
        >
            <div className="w-full max-w-md mx-4">
                <div className="relative rounded-2xl bg-white shadow-2xl border border-gray-200">
                    <div className="px-6 pt-6 pb-4">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="h-9 w-9 rounded-full bg-gray-900 text-white flex items-center justify-center text-sm font-semibold">
                                1001
                            </div>
                            <h2 className="text-xl font-semibold tracking-tight">
                                {mode === 'login' ? 'Login' : 'Sign up'}
                            </h2>
                        </div>

                        {mode === 'login' ? (
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                                    <input
                                        ref={firstInputRef}
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        type="email"
                                        placeholder={`you${FIXED_DOMAIN}`}
                                        className="w-full rounded-lg border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 px-3 py-2 text-sm placeholder:text-gray-400"
                                        autoComplete="email"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
                                    <input
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        type="password"
                                        placeholder="••••••••"
                                        className="w-full rounded-lg border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 px-3 py-2 text-sm placeholder:text-gray-400"
                                        autoComplete="current-password"
                                    />
                                </div>

                                {!emailEmpty && !isDomainValidLogin && (
                                    <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                                        Are you 1001 member? Login is available only with {FIXED_DOMAIN} email.
                                    </div>
                                )}

                                {error && (
                                    <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                                        {error}
                                    </div>
                                )}

                                <button
                                    onClick={() => submit('login')}
                                    disabled={disabledLogin}
                                    className="w-full inline-flex items-center justify-center rounded-lg bg-gray-900 text-white text-sm font-medium px-4 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-black transition"
                                >
                                    Login
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                                    <input
                                        value={suEmail}
                                        onChange={(e) => setSuEmail(e.target.value)}
                                        type="email"
                                        placeholder={`you${FIXED_DOMAIN}`}
                                        className="w-full rounded-lg border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 px-3 py-2 text-sm placeholder:text-gray-400"
                                        autoComplete="email"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
                                    <input
                                        value={suPassword}
                                        onChange={(e) => setSuPassword(e.target.value)}
                                        type="password"
                                        placeholder="••••••••"
                                        className="w-full rounded-lg border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 px-3 py-2 text-sm placeholder:text-gray-400"
                                        autoComplete="new-password"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">
                                        Confirm Password
                                    </label>
                                    <input
                                        value={suConfirm}
                                        onChange={(e) => setSuConfirm(e.target.value)}
                                        type="password"
                                        placeholder="••••••••"
                                        className="w-full rounded-lg border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 px-3 py-2 text-sm placeholder:text-gray-400"
                                        autoComplete="new-password"
                                    />
                                    {!isPwMatch && suConfirm.length > 0 && (
                                        <p className="mt-1 text-[11px] text-red-600">Passwords do not match</p>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">
                                        Branch (optional)
                                    </label>
                                    <input
                                        value={suBranch}
                                        onChange={(e) => setSuBranch(e.target.value)}
                                        type="text"
                                        placeholder="e.g. Burwood, Chase"
                                        className="w-full rounded-lg border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 px-3 py-2 text-sm placeholder:text-gray-400"
                                    />
                                </div>

                                {!suEmailEmpty && !isDomainValidSignup && (
                                    <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                                        Are you 1001 member? Sign up is available only with {FIXED_DOMAIN} email.
                                    </div>
                                )}

                                {error && (
                                    <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                                        {error}
                                    </div>
                                )}

                                <button
                                    onClick={() => submit('signup')}
                                    disabled={disabledSignup}
                                    className="w-full inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-900 text-sm font-medium px-4 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 transition"
                                >
                                    Sign up
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="px-6 pb-6">
                        <div className="flex items-center gap-3 my-4">
                            <div className="h-px flex-1 bg-gray-200" />
                            <span className="text-[11px] uppercase tracking-wider text-gray-400">
                {mode === 'login' ? 'or' : 'back to'}
              </span>
                            <div className="h-px flex-1 bg-gray-200" />
                        </div>

                        <div className="flex items-center justify-between">
                            <p className="text-sm text-gray-700">Are you 1001 member?</p>
                            {mode === 'login' ? (
                                <button
                                    onClick={() => setMode('signup')}
                                    className="text-sm font-medium text-gray-900 hover:underline"
                                >
                                    Create an account
                                </button>
                            ) : (
                                <button
                                    onClick={() => setMode('login')}
                                    className="text-sm font-medium text-gray-900 hover:underline"
                                >
                                    Go to Login
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <p className="mt-3 text-[11px] text-center text-gray-500">
                    Access restricted to 1001 employees only.
                </p>
            </div>
        </div>
    );
}