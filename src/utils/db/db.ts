import 'server-only';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

export const runtime = 'nodejs';

declare global {
    // 개발(HMR) 중 중복 연결 방지용
    var __db__: Promise<Database> | undefined;
}

async function _init() {
    const filename = process.env.DB_FILE
        ? path.resolve(process.cwd(), process.env.DB_FILE)
        : path.resolve(process.cwd(), 'roster.sqlite');

    const db = await open({
        filename,
        driver: sqlite3.Database,
    });

    // 마이그레이션: migrations 폴더(아래 3절) 자동 적용
    await db.migrate();

    // 성능·일관성 옵션(선택)
    await db.exec('PRAGMA foreign_keys = ON;');
    // await db.exec('PRAGMA journal_mode = WAL;'); // 파일시스템/호스팅 환경에 따라

    return db;
}

export function getDB() {
    if (!global.__db__) global.__db__ = _init();
    return global.__db__!;
}