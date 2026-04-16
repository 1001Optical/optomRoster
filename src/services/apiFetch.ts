import { createLogger } from "@/lib/logger";

const logger = createLogger("ApiFetch");

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** api.1001optometrist.com 프록시 — 과도한 동시 요청 시 429 방지 */
export function is1001OptometristApiUrl(path: string): boolean {
  return /\bapi\.1001optometrist\.com\b/i.test(path) || /\b1001optometrist\.com\b/i.test(path);
}

function minGapMs(): number {
  const raw = process.env.API_1001_MIN_GAP_MS;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 400;
}

/** 분당 요청 상한(기본 55). 60/분 제한 대비 여유. `API_1001_MAX_PER_MINUTE`로 조정. */
function max1001RequestsPerMinute(): number {
  const raw = process.env.API_1001_MAX_PER_MINUTE;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1 && n <= 120) return Math.floor(n);
  }
  return 55;
}

/** 직렬 큐에서 요청 사이 최소 대기: 사용자 간격과 분당 상한 중 더 보수적인 값 */
function enforcedMinGapMs(): number {
  const userGap = minGapMs();
  const fromRateCap = Math.ceil(60_000 / max1001RequestsPerMinute());
  return Math.max(userGap, fromRateCap);
}

function backoffMsFor429(res: Response, attempt: number): number {
  const ra = res.headers.get("Retry-After");
  if (ra) {
    const trimmed = ra.trim();
    const asSec = parseInt(trimmed, 10);
    if (!Number.isNaN(asSec) && /^\d+$/.test(trimmed)) {
      return Math.max(asSec * 1000, 800);
    }
    const when = Date.parse(ra);
    if (!Number.isNaN(when)) {
      return Math.max(when - Date.now(), 800);
    }
  }
  return Math.min(90_000, 2000 * 2 ** attempt);
}

function logPath(path: string): string {
  try {
    const u = new URL(path);
    return `${u.pathname}${u.search}`;
  } catch {
    return path.length > 120 ? `${path.slice(0, 120)}…` : path;
  }
}

let queueTail: Promise<void> = Promise.resolve();
let lastRequestFinishedAt = 0;

/**
 * 동일 호스트로의 요청을 순차 처리하고, 요청 사이에 최소 간격을 둡니다.
 */
async function runSerialized1001<T>(path: string, work: () => Promise<T>): Promise<T> {
  if (!is1001OptometristApiUrl(path)) {
    return work();
  }

  const gap = enforcedMinGapMs();
  const run = queueTail.then(async () => {
    const wait = Math.max(0, lastRequestFinishedAt + gap - Date.now());
    if (wait > 0) {
      logger.debug(`API spacing`, { waitMs: wait, path: logPath(path) });
      await sleep(wait);
    }
    try {
      return await work();
    } finally {
      lastRequestFinishedAt = Date.now();
    }
  });

  queueTail = run.then(
    () => {},
    () => {},
  );
  return run;
}

/**
 * 1001 Optometrist API용: 직렬화 + 429 시 Retry-After / 지수 백오프 재시도.
 * 다른 URL은 직렬화 없이 429 재시도만 적용합니다.
 */
export async function fetch1001OptometristApi(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  if (!path) {
    throw new Error("API path is required");
  }

  const maxAttempts = 8;
  const attemptFetch = async (): Promise<Response> => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await fetch(path, init);

      if (response.status === 429 && attempt < maxAttempts - 1) {
        await response.text().catch(() => "");
        const waitMs = backoffMsFor429(response, attempt);
        logger.warn(`429 Too Many Requests, backing off`, {
          path: logPath(path),
          method: init?.method ?? "GET",
          waitMs,
          attempt: attempt + 1,
        });
        await sleep(waitMs);
        continue;
      }

      return response;
    }

    return fetch(path, init);
  };

  return runSerialized1001(path, attemptFetch);
}

async function safeReadText(res: Response): Promise<string | undefined> {
  try {
    return await res.text();
  } catch {
    return undefined;
  }
}

const apiFetch = async (path: string, init?: RequestInit) => {
  logger.debug(`Request`, { path: logPath(path), method: init?.method ?? "GET" });

  const response = await fetch1001OptometristApi(path, init);

  if (!response.ok) {
    const bodyText = await safeReadText(response);
    logger.error(`Request failed`, {
      path: logPath(path),
      status: response.status,
      statusText: response.statusText,
      body: bodyText,
    });
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data;
};

export { apiFetch };
