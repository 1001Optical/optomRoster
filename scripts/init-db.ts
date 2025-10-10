import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

async function initDatabase() {
    console.log('=== Database Initialization ===');
    
    const dbPath = path.resolve(process.cwd(), 'roster.sqlite');
    
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
    
    console.log('Creating new database...');
    
    const db = new Database(dbPath);
    
    // 기본 설정
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    
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
        const statements = upSection
            .split(';')
            .map(stmt => stmt.trim())
            .filter(stmt => stmt && !stmt.startsWith('--'));
        
        console.log(`Running migration: ${file}`);
        
        for (const statement of statements) {
            if (statement.trim()) {
                try {
                    db.exec(statement);
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
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log('Created tables:', tables.map((t: any) => t.name));
    
    db.close();
}

initDatabase().catch(console.error);
