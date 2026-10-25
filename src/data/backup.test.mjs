import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { migrateDatabase } from './database.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'expo-crypto') {
      return { url: 'data:text/javascript,export%20const%20randomUUID%3D()%3D%3EglobalThis.crypto.randomUUID()', shortCircuit: true };
    }
    if (specifier.startsWith('../domain/') && !specifier.endsWith('.ts')) {
      return nextResolve(`${specifier}.ts`, context);
    }
    if (specifier === './database' || specifier === './repository') {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { prepareBackupSource, restoreBackupSource } = await import('./backupCore.ts');

function adapter(sqlite) {
  return {
    execAsync: async (sql) => sqlite.exec(sql),
    getFirstAsync: async (sql, ...params) => sqlite.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql, ...params) => sqlite.prepare(sql).all(...params),
    runAsync: async (sql, ...params) => sqlite.prepare(sql).run(...params),
    withTransactionAsync: async (work) => {
      sqlite.exec('BEGIN');
      try { await work(); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}

test('yedek ön izlemesi kayıtları sayar ve geri yükleme tabloları bütün halinde değiştirir', async () => {
  const liveSqlite = new DatabaseSync(':memory:');
  const sourceSqlite = new DatabaseSync(':memory:');
  try {
    const live = adapter(liveSqlite);
    const source = adapter(sourceSqlite);
    await migrateDatabase(live);
    await migrateDatabase(source);
    liveSqlite.exec(`INSERT INTO accounts
      (id, name, currency, purpose, balance_minor, balance_date)
      VALUES ('old', 'Eski hesap', 'TRY', 'spending', 1000, '2026-10-25')`);
    sourceSqlite.exec(`
      INSERT INTO accounts (id, name, currency, purpose, balance_minor, balance_date)
      VALUES ('new', 'Yeni hesap', 'TRY', 'spending', 7000, '2026-10-25');
      INSERT INTO categories (id, name, created_at)
      VALUES ('rent', 'Kira', '2026-10-25T09:00:00Z');
      INSERT INTO monthly_plans (id, account_id, title, kind, amount_minor, due_day, starts_on, category_id)
      VALUES ('plan', 'new', 'Kira', 'expense', 3000, 1, '2026-10-25', 'rent');
      INSERT INTO actual_expenses
        (id, account_id, category_id, amount_minor, occurred_on, created_at,
         balance_before_minor, balance_after_minor)
      VALUES ('expense', 'new', 'rent', 2000, '2026-10-25', '2026-10-25T10:00:00Z', 9000, 7000);
      INSERT INTO balance_snapshots
        (id, account_id, observed_on, actual_minor, kind, expense_id)
      VALUES ('expense-snapshot', 'new', '2026-10-25', 7000, 'expense', 'expense');
    `);
    assert.deepEqual(await prepareBackupSource(source), {
      accountCount: 1, planCount: 1, cardCount: 0, goldCount: 0, expenseCount: 1,
    });
    await restoreBackupSource(live, source);
    assert.deepEqual(liveSqlite.prepare('SELECT id, balance_minor FROM accounts').all().map((row) => ({ ...row })), [{ id: 'new', balance_minor: 7000 }]);
    assert.deepEqual(liveSqlite.prepare('SELECT category_id FROM monthly_plans').all().map((row) => ({ ...row })), [{ category_id: 'rent' }]);
    assert.deepEqual(liveSqlite.prepare('SELECT id, category_id FROM actual_expenses').all().map((row) => ({ ...row })), [{ id: 'expense', category_id: 'rent' }]);
    assert.equal(liveSqlite.prepare('PRAGMA foreign_key_check').get(), undefined);
  } finally {
    liveSqlite.close();
    sourceSqlite.close();
  }
});

test('geri yükleme ortasında hata olursa eski finans verileri korunur', async () => {
  const liveSqlite = new DatabaseSync(':memory:');
  const sourceSqlite = new DatabaseSync(':memory:');
  try {
    const live = adapter(liveSqlite);
    const source = adapter(sourceSqlite);
    await migrateDatabase(live);
    await migrateDatabase(source);
    liveSqlite.exec(`INSERT INTO accounts
      (id, name, currency, purpose, balance_minor, balance_date)
      VALUES ('old', 'Eski hesap', 'TRY', 'spending', 1000, '2026-10-25');
      CREATE TRIGGER fail_restore BEFORE INSERT ON accounts
      BEGIN SELECT RAISE(ABORT, 'test restore failure'); END;`);
    sourceSqlite.exec(`INSERT INTO accounts
      (id, name, currency, purpose, balance_minor, balance_date)
      VALUES ('new', 'Yeni hesap', 'TRY', 'spending', 9000, '2026-10-25')`);
    await assert.rejects(restoreBackupSource(live, source), (error) => error.code === 'RESTORE_FAILED');
    assert.deepEqual(liveSqlite.prepare('SELECT id, balance_minor FROM accounts').all().map((row) => ({ ...row })), [{ id: 'old', balance_minor: 1000 }]);
  } finally {
    liveSqlite.close();
    sourceSqlite.close();
  }
});
