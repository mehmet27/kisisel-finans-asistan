import type { SQLiteDatabase } from 'expo-sqlite';
import { migrateDatabase } from './database';
import { withRepositoryWriteLock } from './repository';

const TABLES = [
  'accounts', 'balance_snapshots', 'monthly_plans', 'flexible_monthly_plans',
  'credit_cards', 'card_statements', 'installment_plans', 'gold_holdings',
  'price_quotes', 'asset_conversions', 'one_time_plans', 'categories', 'actual_expenses',
  'try_transfers', 'card_statement_payments',
] as const;

type SqlValue = string | number | null | boolean | Uint8Array | ArrayBuffer;

export class BackupDatabaseError extends Error {
  readonly code: 'INVALID_DATABASE' | 'UNSUPPORTED_SCHEMA' | 'RESTORE_FAILED';
  constructor(code: 'INVALID_DATABASE' | 'UNSUPPORTED_SCHEMA' | 'RESTORE_FAILED', message: string) {
    super(message);
    this.name = 'BackupDatabaseError';
    this.code = code;
  }
}

function tableName(name: string): string {
  if (!/^[a-z_]+$/.test(name)) throw new BackupDatabaseError('INVALID_DATABASE', 'Yedekte geçersiz tablo adı var.');
  return `"${name}"`;
}

async function userTables(db: SQLiteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  return rows.map((row) => row.name);
}

async function assertExpectedTables(db: SQLiteDatabase): Promise<void> {
  const actual = await userTables(db);
  const expected = [...TABLES].sort();
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new BackupDatabaseError('UNSUPPORTED_SCHEMA', 'Yedekteki veritabanı tabloları bu uygulama sürümüyle uyumlu değil.');
  }
}

async function columns(db: SQLiteDatabase, name: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${tableName(name)})`);
  return rows.map((row) => row.name);
}

async function assertIntegrity(db: SQLiteDatabase): Promise<void> {
  const result = await db.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check');
  const invalidForeignKey = await db.getFirstAsync<Record<string, unknown>>('PRAGMA foreign_key_check');
  if (result?.integrity_check !== 'ok' || invalidForeignKey) {
    throw new BackupDatabaseError('INVALID_DATABASE', 'Yedekteki veritabanı bütünlüğü doğrulanamadı.');
  }
}

async function tableOrder(db: SQLiteDatabase): Promise<string[]> {
  const expected = new Set<string>(TABLES);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const order: string[] = [];
  async function visit(name: string): Promise<void> {
    if (visited.has(name)) return;
    if (visiting.has(name)) throw new BackupDatabaseError('UNSUPPORTED_SCHEMA', 'Yedek şemasında döngüsel tablo bağı var.');
    visiting.add(name);
    const parents = await db.getAllAsync<{ table: string }>(`PRAGMA foreign_key_list(${tableName(name)})`);
    for (const parent of parents) {
      if (!expected.has(parent.table)) throw new BackupDatabaseError('UNSUPPORTED_SCHEMA', 'Yedek şemasında bilinmeyen tablo bağı var.');
      await visit(parent.table);
    }
    visiting.delete(name);
    visited.add(name);
    order.push(name);
  }
  for (const name of TABLES) await visit(name);
  return order;
}

export interface BackupPreview {
  accountCount: number;
  planCount: number;
  cardCount: number;
  goldCount: number;
  expenseCount: number;
}

async function count(db: SQLiteDatabase, table: string): Promise<number> {
  const row = await db.getFirstAsync<{ value: number }>(`SELECT COUNT(*) AS value FROM ${tableName(table)}`);
  return row?.value ?? 0;
}

export async function prepareBackupSource(source: SQLiteDatabase): Promise<BackupPreview> {
  await assertIntegrity(source);
  const version = await source.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if (!version?.user_version) throw new BackupDatabaseError('INVALID_DATABASE', 'Yedekte uygulama veritabanı bulunamadı.');
  try { await migrateDatabase(source); }
  catch (error) {
    throw new BackupDatabaseError('UNSUPPORTED_SCHEMA',
      error instanceof Error ? error.message : 'Yedek şeması bu sürümle açılamadı.');
  }
  await assertExpectedTables(source);
  await assertIntegrity(source);
  return {
    accountCount: await count(source, 'accounts'),
    planCount: (await count(source, 'monthly_plans')) + (await count(source, 'flexible_monthly_plans'))
      + (await count(source, 'one_time_plans')),
    cardCount: await count(source, 'credit_cards'),
    goldCount: await count(source, 'gold_holdings'),
    expenseCount: await count(source, 'actual_expenses'),
  };
}

export function serializeBackupDatabase(db: SQLiteDatabase): Promise<Uint8Array> {
  return withRepositoryWriteLock(db, () => db.serializeAsync());
}

export async function restoreBackupSource(live: SQLiteDatabase, source: SQLiteDatabase): Promise<void> {
  await prepareBackupSource(source);
  await assertExpectedTables(live);
  const [sourceVersion, liveVersion] = await Promise.all([
    source.getFirstAsync<{ user_version: number }>('PRAGMA user_version'),
    live.getFirstAsync<{ user_version: number }>('PRAGMA user_version'),
  ]);
  if (sourceVersion?.user_version !== liveVersion?.user_version) {
    throw new BackupDatabaseError('UNSUPPORTED_SCHEMA', 'Yedek ve uygulama veritabanı sürümleri uyuşmuyor.');
  }
  const order = await tableOrder(live);
  const rows = new Map<string, Record<string, SqlValue>[]>();
  const names = new Map<string, string[]>();
  for (const table of order) {
    const [sourceColumns, liveColumns] = await Promise.all([columns(source, table), columns(live, table)]);
    if (sourceColumns.length !== liveColumns.length
      || sourceColumns.some((name, index) => name !== liveColumns[index])) {
      throw new BackupDatabaseError('UNSUPPORTED_SCHEMA', 'Yedek ile uygulama tablo alanları uyuşmuyor.');
    }
    names.set(table, liveColumns);
    rows.set(table, await source.getAllAsync<Record<string, SqlValue>>(`SELECT * FROM ${tableName(table)}`));
  }
  try {
    await withRepositoryWriteLock(live, () => live.withTransactionAsync(async () => {
      for (const table of [...order].reverse()) await live.runAsync(`DELETE FROM ${tableName(table)}`);
      for (const table of order) {
        const tableColumns = names.get(table)!;
        const sql = `INSERT INTO ${tableName(table)} (${tableColumns.map(tableName).join(', ')}) VALUES (${tableColumns.map(() => '?').join(', ')})`;
        for (const row of rows.get(table)!) {
          await live.runAsync(sql, ...tableColumns.map((name) => row[name]));
        }
      }
      await assertIntegrity(live);
    }));
  } catch (error) {
    throw new BackupDatabaseError('RESTORE_FAILED',
      error instanceof Error ? `Geri yükleme uygulanamadı: ${error.message}` : 'Geri yükleme uygulanamadı.');
  }
}
