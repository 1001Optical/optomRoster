import 'server-only';
import path from 'node:path';
import fs from 'node:fs';
import { createClient } from '@libsql/client';
import type { Client, InArgs } from '@libsql/client';

export const runtime = 'nodejs';

declare global {
    // 개발(HMR) 중 중복 연결 방지용
    // eslint-disable-next-line no-var
    var __db__: Client | undefined;
    // eslint-disable-next-line no-var
    var __db_initialized__: boolean | undefined;
    // eslint-disable-next-line no-var
    var __db_init_promise__: Promise<Client> | undefined;
}

type DBArgs = InArgs;

function resolveDbUrl(): string {
    if (process.env.TURSO_DATABASE_URL) {
        return process.env.TURSO_DATABASE_URL;
    }

    const filename = process.env.DB_FILE
        ? path.resolve(process.cwd(), process.env.DB_FILE)
        : path.resolve(process.cwd(), 'roster.sqlite');

    return `file:${filename}`;
}

function getAuthToken(): string | undefined {
    return process.env.TURSO_AUTH_TOKEN || process.env.TURSO_TOKEN;
}

async function _init(): Promise<Client> {
    const url = resolveDbUrl();
    const authToken = getAuthToken();

    const db = createClient({
        url,
        authToken,
    });

    // 마이그레이션 실행
    await runMigrations(db);

    // 초기화 완료 표시
    global.__db_initialized__ = true;

    return db;
}

async function runMigrations(db: Client) {
    const migrationsDir = path.join(process.cwd(), 'migrations');

    if (!fs.existsSync(migrationsDir)) {
        console.warn('Migrations directory not found:', migrationsDir);
        return;
    }

    const migrationFiles = fs.readdirSync(migrationsDir)
        .filter(file => file.endsWith('.sql'))
        .sort();

    if (migrationFiles.length === 0) {
        console.warn('No migration files found');
        return;
    }

    // 기존 테이블 확인
    const existingTablesResult = await db.execute({
        sql: "SELECT name FROM sqlite_master WHERE type='table'",
        args: [],
    });
    const existingTables = existingTablesResult.rows
        .map((row) => ({ name: row.name as string }))
        .filter((row) => typeof row.name === 'string');

    // 필수 테이블 확인
    const requiredTables = ['ROSTER', 'CHANGE_LOG', 'STORE_INFO'];
    requiredTables.filter(table =>
        !existingTables.some(t => t.name === table)
    );

    for (const file of migrationFiles) {
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf8');

        // -- Up 섹션만 실행 (-- Down 섹션은 무시)
        const upSection = sql.split('-- Down')[0];

        // 개선된 SQL 파싱
        const statements = parseSQLStatements(upSection);

        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i];
            if (statement.trim()) {
                try {
                    await db.execute({ sql: statement, args: [] });
                } catch (error) {
                    console.error(`Error executing statement ${i + 1} in ${file}:`, error);

                    // 테이블이 이미 존재하는 경우 무시
                    if (error instanceof Error &&
                        (error.message.includes('already exists') ||
                            error.message.includes('duplicate column name'))) {
                        continue;
                    }
                    throw error;
                }
            }
        }
    }

    // 마이그레이션 후 테이블 확인
    await db.execute({
        sql: "SELECT name FROM sqlite_master WHERE type='table'",
        args: [],
    });
}

export function parseSQLStatements(sql: string): string[] {
    const statements: string[] = [];
    let currentStatement = '';
    let inTrigger = false;
    let braceCount = 0;
    let inString = false;
    let stringChar = '';

    const lines = sql.split('\n');

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        const trimmedLine = line.trim();

        // 주석 라인 건너뛰기
        if (trimmedLine.startsWith('--') || trimmedLine === '') {
            continue;
        }

        // 트리거 시작 감지
        if (trimmedLine.toUpperCase().includes('CREATE TRIGGER')) {
            inTrigger = true;
            braceCount = 0;
        }

        currentStatement += line + '\n';

        // 문자열 내부 처리
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const prevChar = i > 0 ? line[i - 1] : '';

            if (!inString && (char === "'" || char === '"')) {
                inString = true;
                stringChar = char;
            } else if (inString && char === stringChar && prevChar !== '\\') {
                inString = false;
                stringChar = '';
            }

            // 문자열 내부가 아닐 때만 처리
            if (!inString) {
                if (inTrigger) {
                    // 트리거 내부에서 중괄호 카운트
                    if (char === '{') braceCount++;
                    if (char === '}') braceCount--;

                    // 트리거 종료 감지 (END; 또는 END)
                    if (trimmedLine.toUpperCase().includes('END') &&
                        (trimmedLine.endsWith(';') || trimmedLine === 'END') &&
                        braceCount === 0) {
                        inTrigger = false;
                        statements.push(currentStatement.trim());
                        currentStatement = '';
                        break;
                    }
                } else {
                    // 일반 SQL 문에서 세미콜론으로 구분
                    if (char === ';' && trimmedLine.endsWith(';')) {
                        statements.push(currentStatement.trim());
                        currentStatement = '';
                        break;
                    }
                }
            }
        }
    }

    // 마지막 문장이 세미콜론으로 끝나지 않은 경우
    if (currentStatement.trim()) {
        statements.push(currentStatement.trim());
    }

    return statements.filter(stmt => {
        const trimmed = stmt.trim();
        if (!trimmed || trimmed.startsWith('--')) {
            return false;
        }
        // Avoid running transaction control statements inside libsql execute
        if (/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(trimmed)) {
            return false;
        }
        return true;
    });
}

export async function getDB(): Promise<Client> {
    if (global.__db__ && global.__db_initialized__) {
        return global.__db__;
    }

    if (global.__db_init_promise__) {
        return global.__db_init_promise__;
    }

    global.__db_init_promise__ = _init();
    try {
        const db = await global.__db_init_promise__;
        global.__db__ = db;
        return db;
    } finally {
        global.__db_init_promise__ = undefined;
    }
}

// 앱 초기화 확인 함수
export function isAppInitialized(): boolean {
    return global.__db_initialized__ === true;
}

// 개발 환경에서 데이터베이스 재초기화 함수
export async function resetDB() {
    if (global.__db__ && typeof global.__db__.close === 'function') {
        await global.__db__.close();
        global.__db__ = undefined;
    }

    global.__db_initialized__ = false;

    const url = resolveDbUrl();
    if (!url.startsWith('file:')) {
        console.warn('resetDB skipped: non-file database URL detected');
        return;
    }

    const filename = url.replace('file:', '');

    // 데이터베이스 파일 삭제
    if (fs.existsSync(filename)) {
        fs.unlinkSync(filename);
    }

    // WAL 파일들도 삭제
    const walFile = filename + '-wal';
    const shmFile = filename + '-shm';
    if (fs.existsSync(walFile)) {
        fs.unlinkSync(walFile);
    }
    if (fs.existsSync(shmFile)) {
        fs.unlinkSync(shmFile);
    }
}

export async function dbExecute(db: Client, sql: string, args?: DBArgs) {
    return db.execute({ sql, args: args ?? [] });
}

export async function dbAll<T = unknown>(db: Client, sql: string, args?: DBArgs): Promise<T[]> {
    const result = await db.execute({ sql, args: args ?? [] });
    return result.rows as T[];
}

export async function dbGet<T = unknown>(db: Client, sql: string, args?: DBArgs): Promise<T | undefined> {
    const result = await db.execute({ sql, args: args ?? [] });
    return result.rows[0] as T | undefined;
}
