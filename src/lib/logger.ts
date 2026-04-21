import { axiomLogger } from "@/lib/axiom/server";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const originalConsole = {
  debug: console.debug.bind(console),
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

let isConsolePatched = false;

/** 터미널 / Vercel 함수 로그에 쓸 최소 레벨 */
function getConsoleMinLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL as LogLevel;
  if (envLevel && envLevel in LOG_LEVELS) return envLevel;
  return process.env.NODE_ENV === "production" ? "warn" : "debug";
}

/**
 * Axiom으로 보낼 최소 레벨 (콘솔과 독립).
 * 기본은 로컬·프로덕션 모두 `debug` 이상 전송(프로세스 전반 가시성).
 * 볼륨을 줄이려면 예: `AXIOM_LOG_LEVEL=info` 또는 `warn`.
 */
function getAxiomMinLevel(): LogLevel {
  const envLevel = process.env.AXIOM_LOG_LEVEL as LogLevel;
  if (envLevel && envLevel in LOG_LEVELS) return envLevel;
  return "debug";
}

function shouldConsoleLog(level: LogLevel): boolean {
  return LOG_LEVELS[getConsoleMinLevel()] <= LOG_LEVELS[level];
}

function shouldAxiomLog(level: LogLevel): boolean {
  return LOG_LEVELS[getAxiomMinLevel()] <= LOG_LEVELS[level];
}

function serializeError(error: Error) {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: error.cause,
  };
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      normalizeValue(nestedValue),
    ]),
  );
}

function normalizeContext(ctx?: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeValue(ctx ?? {});
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    return {};
  }

  return normalized as Record<string, unknown>;
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;

  try {
    return JSON.stringify(normalizeValue(value));
  } catch {
    return String(value);
  }
}

function buildConsolePayload(args: unknown[]): {
  message: string;
  fields?: Record<string, unknown>;
} {
  if (args.length === 0) {
    return { message: "" };
  }

  const [first, ...rest] = args;

  if (first instanceof Error) {
    return {
      message: first.message,
      fields: {
        error: serializeError(first),
        args: rest.map(normalizeValue),
      },
    };
  }

  if (typeof first === "string") {
    if (rest.length === 1 && rest[0] && typeof rest[0] === "object") {
      return {
        message: first,
        fields: normalizeValue(rest[0]) as Record<string, unknown>,
      };
    }

    return {
      message: first,
      fields: rest.length > 0 ? { args: rest.map(normalizeValue) } : undefined,
    };
  }

  return {
    message: stringifyValue(first),
    fields: rest.length > 0 ? { args: rest.map(normalizeValue) } : undefined,
  };
}

function writeToConsole(level: LogLevel, message: string, ctx?: Record<string, unknown>) {
  const prefix = `[${level.toUpperCase()}]`;
  const method =
    level === "error"
      ? originalConsole.error
      : level === "warn"
        ? originalConsole.warn
        : level === "info"
          ? originalConsole.info
          : originalConsole.log;

  if (ctx && Object.keys(ctx).length > 0) {
    method(`${prefix} ${message}`, ctx);
    return;
  }

  method(`${prefix} ${message}`);
}

const AXIOM_STACK_MAX = 8000;

/** Axiom에서 컬럼으로 잡히게 `error` 객체를 평탄 문자열 필드로 풀어줌 */
function flattenForAxiom(fields?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!fields || Object.keys(fields).length === 0) return fields;

  const out: Record<string, unknown> = { ...fields };
  const err = out.error;
  if (err && typeof err === "object" && err !== null && !Array.isArray(err)) {
    const e = err as Record<string, unknown>;
    if (typeof e.message === "string") out.errorMessage = e.message;
    if (typeof e.name === "string") out.errorName = e.name;
    if (typeof e.stack === "string") {
      out.errorStack = e.stack.slice(0, AXIOM_STACK_MAX);
    }
    delete out.error;
  }
  return out;
}

function sendToAxiom(
  level: LogLevel,
  message: string,
  fields?: Record<string, unknown>,
) {
  if (!axiomLogger || !shouldAxiomLog(level)) return;
  axiomLogger[level](message, flattenForAxiom(fields));
}

export function initConsoleAxiomBridge() {
  if (isConsolePatched) return;
  isConsolePatched = true;

  console.debug = (...args: unknown[]) => {
    originalConsole.debug(...args);
    const payload = buildConsolePayload(args);
    sendToAxiom("debug", payload.message, {
      ...payload.fields,
      module: "console",
    });
  };

  console.log = (...args: unknown[]) => {
    originalConsole.log(...args);
    const payload = buildConsolePayload(args);
    sendToAxiom("info", payload.message, {
      ...payload.fields,
      module: "console",
    });
  };

  console.info = (...args: unknown[]) => {
    originalConsole.info(...args);
    const payload = buildConsolePayload(args);
    sendToAxiom("info", payload.message, {
      ...payload.fields,
      module: "console",
    });
  };

  console.warn = (...args: unknown[]) => {
    originalConsole.warn(...args);
    const payload = buildConsolePayload(args);
    sendToAxiom("warn", payload.message, {
      ...payload.fields,
      module: "console",
    });
  };

  console.error = (...args: unknown[]) => {
    originalConsole.error(...args);
    const payload = buildConsolePayload(args);
    sendToAxiom("error", payload.message, {
      ...payload.fields,
      module: "console",
    });
  };
}

// 개인정보 마스킹 유틸
export function maskEmail(email: string): string {
  return email.replace(/(.{2})(.*)(@.*)/, "$1***$3");
}

export function maskName(name: string): string {
  if (!name || name.length <= 1) return name;
  return name[0] + "*".repeat(Math.min(name.length - 1, 4));
}

export function createLogger(module: string) {
  return {
    debug: (msg: string, ctx?: Record<string, unknown>) => {
      const ctxNorm = normalizeContext(ctx);
      if (shouldConsoleLog("debug")) {
        writeToConsole("debug", `[${module}] ${msg}`, ctxNorm);
      }
      sendToAxiom("debug", msg, { module, ...ctxNorm });
    },
    info: (msg: string, ctx?: Record<string, unknown>) => {
      const ctxNorm = normalizeContext(ctx);
      if (shouldConsoleLog("info")) {
        writeToConsole("info", `[${module}] ${msg}`, ctxNorm);
      }
      sendToAxiom("info", msg, { module, ...ctxNorm });
    },
    warn: (msg: string, ctx?: Record<string, unknown>) => {
      const ctxNorm = normalizeContext(ctx);
      if (shouldConsoleLog("warn")) {
        writeToConsole("warn", `[${module}] ${msg}`, ctxNorm);
      }
      sendToAxiom("warn", msg, { module, ...ctxNorm });
    },
    error: (msg: string, ctx?: Record<string, unknown>) => {
      const ctxNorm = normalizeContext(ctx);
      writeToConsole("error", `[${module}] ${msg}`, ctxNorm);
      sendToAxiom("error", msg, { module, ...ctxNorm });
    },
  };
}
