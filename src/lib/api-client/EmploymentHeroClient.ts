import { createSecret } from "@/utils/crypto";

interface IEHClientProps {
    path: string;
    init?: Omit<RequestInit, "headers"> & { headers?: Record<string, string> };
}

interface IEHClientResponse<T = unknown> {
    ok: boolean;
    status: number;
    data?: T;
    error?: string;
}

export const EmploymentHeroClient = async <T = unknown>({
    path,
    init,
}: IEHClientProps): Promise<IEHClientResponse<T>> => {
    const secret = process.env.EMPLOYMENTHERO_SECRET;
    const server_url = process.env.EMPLOYMENTHERO_API_URL;

    if (!secret || !server_url) {
        return {
            ok: false,
            status: 0,
            error: "Missing EMPLOYMENTHERO_SECRET or EMPLOYMENTHERO_API_URL",
        };
    }

    try {
        const response = await fetch(`${server_url}${path}`, {
            ...init,
            headers: {
                "Authorization": createSecret(secret),
                "Content-Type": "application/json",
                ...(init?.headers ?? {}),
            },
        });

        const text = await response.text();
        let data: T | undefined;
        try {
            data = text ? (JSON.parse(text) as T) : undefined;
        } catch {
            // 응답이 JSON이 아닌 경우 무시
        }

        if (!response.ok) {
            return {
                ok: false,
                status: response.status,
                error: `EH API error: ${response.status} ${response.statusText} ${text}`,
            };
        }

        return { ok: true, status: response.status, data };
    } catch (error) {
        return {
            ok: false,
            status: 0,
            error: error instanceof Error ? error.message : String(error),
        };
    }
};
