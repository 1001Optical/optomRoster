import path from 'node:path';
import fs from 'node:fs';
import { createClient } from '@libsql/client';
import { parseSQLStatements } from '../src/utils/db/db';

async function initDatabase() {
    console.log('=== Database Initialization ===');
    
    const dbPath = path.resolve(process.cwd(), 'roster.sqlite');
    const dbUrl = process.env.TURSO_DATABASE_URL
        ? process.env.TURSO_DATABASE_URL
        : `file:${dbPath}`;
    const authToken = process.env.TURSO_AUTH_TOKEN || process.env.TURSO_TOKEN;
    
    if (dbUrl.startsWith('file:')) {
        // 기존 데이터베이스 파일 삭제
        if (fs.existsSync(dbPath)) {
            console.log('Removing existing database file...');
            fs.unlinkSync(dbPath);
        }
        
        // WAL 파일들도 삭제
        const walPath = dbPath + '-wal';
        const shmPath = dbPath + '-shm';
        if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
        if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
    } else {
        console.log('Remote database detected, skipping local file cleanup.');
    }
    
    console.log('Creating new database...');
    
    const db = createClient({
        url: dbUrl,
        authToken,
    });
    
    // 마이그레이션 실행
    console.log('Running migrations...');
    const migrationsDir = path.join(process.cwd(), 'migrations');
    
    if (!fs.existsSync(migrationsDir)) {
        console.error('Migrations directory not found:', migrationsDir);
        process.exit(1);
    }
    
    const migrationFiles = fs.readdirSync(migrationsDir)
        .filter(file => file.endsWith('.sql'))
        .sort();
    
    console.log('Found migration files:', migrationFiles);
    
    for (const file of migrationFiles) {
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf8');
        
        // -- Up 섹션만 실행 (-- Down 섹션은 무시)
        const upSection = sql.split('-- Down')[0];
        const statements = parseSQLStatements(upSection);
        
        console.log(`Running migration: ${file}`);
        
        for (const statement of statements) {
            if (statement.trim()) {
                try {
                    await db.execute({ sql: statement, args: [] });
                } catch (error) {
                    console.error(`Error executing statement in ${file}:`, error);
                    console.error('Statement:', statement);
                    throw error;
                }
            }
        }
    }
    
    console.log('Database initialization completed successfully!');
    
    // 테이블 확인
    const tablesResult = await db.execute({
        sql: "SELECT name FROM sqlite_master WHERE type='table'",
        args: [],
    });
    const tableNames = tablesResult.rows.map((t: any) => t.name);
    console.log('Created tables:', tableNames);
    
    if (typeof db.close === 'function') {
        await db.close();
    }
}

initDatabase().catch(console.error);
