type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getMinLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL as LogLevel;
  if (envLevel && envLevel in LOG_LEVELS) return envLevel;
  return process.env.NODE_ENV === 'production' ? 'warn' : 'debug';
}

// 개인정보 마스킹 유틸
export function maskEmail(email: string): string {
  return email.replace(/(.{2})(.*)(@.*)/, '$1***$3');
}

export function maskName(name: string): string {
  if (!name || name.length <= 1) return name;
  return name[0] + '*'.repeat(Math.min(name.length - 1, 4));
}

export function createLogger(module: string) {
  return {
    debug: (msg: string, ctx?: Record<string, unknown>) => {
      if (LOG_LEVELS[getMinLevel()] > LOG_LEVELS['debug']) return;
      console.log(`[DEBUG] [${module}] ${msg}`, ctx ?? '');
    },
    info: (msg: string, ctx?: Record<string, unknown>) => {
      if (LOG_LEVELS[getMinLevel()] > LOG_LEVELS['info']) return;
      console.log(`[INFO] [${module}] ${msg}`, ctx ?? '');
    },
    warn: (msg: string, ctx?: Record<string, unknown>) => {
      if (LOG_LEVELS[getMinLevel()] > LOG_LEVELS['warn']) return;
      console.warn(`[WARN] [${module}] ${msg}`, ctx ?? '');
    },
    error: (msg: string, ctx?: Record<string, unknown>) => {
      console.error(`[ERROR] [${module}] ${msg}`, ctx ?? '');
    },
  };
}
