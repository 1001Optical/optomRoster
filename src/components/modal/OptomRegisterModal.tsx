'use client';

import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/services/apiFetch';

const FIXED_DOMAIN = '@1001optical.com.au';

type Mode = 'login' | 'signup';

interface LoginModalProps {
    open: boolean;
    onAuth?: (data: { id: string; role: 'ADMIN' | 'Staff' }) => void;
}

export default function OptomRegisterModal({open, onAuth,}: LoginModalProps) {
    // Login form
    const [givenName, setGivenName] = useState('');
    const [surName, setSurName] = useState('');
    const [email, setEmail] = useState('');

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


    function mapError(status: number): string {
        if (status === 400) return 'Please enter required fields correctly';
        if (status === 401) return 'Invalid email or password';
        if (status === 409) return 'This email is already registered';
        return 'A temporary error occurred. Please try again';
    }

    async function submit(nextMode: Mode) {
        setError('');
        const path = process.env.NEXT_PUBLIC_API_BASE_URL + nextMode === 'signup' ? '/auth/register' : '/auth/login';
        const payload = { IDENTIFIER: "", GIVEN_NAME: givenName, SURNAME: surName, USERNAME: "", PASSWORD: "1001", EMAIL_ADDRESS: email}
        try {
            const res = await apiFetch(path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                // const data = await res.json().catch(() => ({} as unknown));
                setError(mapError(res.status));
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
                                Optometrist Sign up
                            </h2>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">Given name</label>
                                <input
                                    value={givenName}
                                    onChange={(e) => setGivenName(e.target.value)}
                                    placeholder="Given name"
                                    className="w-full rounded-lg border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 px-3 py-2 text-sm placeholder:text-gray-400"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">Surname</label>
                                <input
                                    value={surName}
                                    onChange={(e) => setSurName(e.target.value)}
                                    placeholder="Surname"
                                    className="w-full rounded-lg border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 px-3 py-2 text-sm placeholder:text-gray-400"
                                />
                            </div>

                            {error && (
                                <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                                    {error}
                                </div>
                            )}

                            <button
                                onClick={() => submit('signup')}
                                // disabled={disabledSignup}
                                className="w-full inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-900 text-sm font-medium px-4 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 transition"
                            >
                                Sign up
                            </button>
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