import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { migrateDatabase } from './database.ts';

function adapter(sqlite) {
  return {
    execAsync: async (sql) => sqlite.exec(sql),
    getFirstAsync: async (sql) => sqlite.prepare(sql).get() ?? null,
    withTransactionAsync: async (work) => {
      sqlite.exec('BEGIN');
      try {
        await work();
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

test('v1 verileri korunarak kart şemasına yükseltilir', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL,
        purpose TEXT NOT NULL, balance_minor INTEGER NOT NULL,
        balance_date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE balance_snapshots (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, observed_on TEXT NOT NULL,
        actual_minor INTEGER NOT NULL, expected_minor INTEGER, difference_minor INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE monthly_plans (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, title TEXT NOT NULL,
        kind TEXT NOT NULL, amount_minor INTEGER NOT NULL, due_day INTEGER NOT NULL,
        starts_on TEXT NOT NULL, ends_on TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO accounts (id, name, currency, purpose, balance_minor, balance_date)
      VALUES ('a1', 'Banka', 'TRY', 'spending', 125000, '2026-01-15');
      INSERT INTO balance_snapshots (id, account_id, observed_on, actual_minor)
      VALUES ('s1', 'a1', '2026-01-15', 125000);
      INSERT INTO monthly_plans (id, account_id, title, kind, amount_minor, due_day, starts_on)
      VALUES ('p1', 'a1', 'Kira', 'expense', 10000, 1, '2026-01-01');
      PRAGMA user_version = 1;
    `);
    await migrateDatabase(adapter(sqlite));
    assert.equal(sqlite.prepare('PRAGMA user_version').get().user_version, 7);
    assert.equal(sqlite.prepare('SELECT balance_minor, remaining_flexible_minor FROM accounts WHERE id = ?').get('a1').balance_minor, 125000);
    assert.equal(sqlite.prepare('SELECT remaining_flexible_minor FROM accounts WHERE id = ?').get('a1').remaining_flexible_minor, null);
    assert.equal(sqlite.prepare('SELECT actual_minor, remaining_flexible_minor FROM balance_snapshots WHERE id = ?').get('s1').actual_minor, 125000);
    assert.equal(sqlite.prepare('SELECT id FROM monthly_plans WHERE id = ?').get('p1').id, 'p1');
    assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'flexible_monthly_plans'").get());
    assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'credit_cards'").get());
  } finally {
    sqlite.close();
  }
});

test('v2 hesap ve esnek gider verileri korunarak kart şemasına yükseltilir', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL,
        purpose TEXT NOT NULL, balance_minor INTEGER NOT NULL,
        balance_date TEXT NOT NULL, remaining_flexible_minor INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE balance_snapshots (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, observed_on TEXT NOT NULL,
        actual_minor INTEGER NOT NULL, expected_minor INTEGER, difference_minor INTEGER,
        remaining_flexible_minor INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE monthly_plans (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, title TEXT NOT NULL,
        kind TEXT NOT NULL, amount_minor INTEGER NOT NULL, due_day INTEGER NOT NULL,
        starts_on TEXT NOT NULL, ends_on TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE flexible_monthly_plans (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, title TEXT NOT NULL,
        amount_minor INTEGER NOT NULL, starts_on TEXT NOT NULL, ends_on TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO accounts (id, name, currency, purpose, balance_minor, balance_date, remaining_flexible_minor)
      VALUES ('a1', 'Banka', 'TRY', 'spending', 50000, '2026-02-10', 3000);
      INSERT INTO flexible_monthly_plans (id, account_id, title, amount_minor, starts_on)
      VALUES ('f1', 'a1', 'Market', 1000, '2026-01-01');
      PRAGMA user_version = 2;
    `);
    await migrateDatabase(adapter(sqlite));
    assert.equal(sqlite.prepare('PRAGMA user_version').get().user_version, 7);
    assert.equal(sqlite.prepare('SELECT balance_minor, remaining_flexible_minor FROM accounts WHERE id = ?').get('a1').remaining_flexible_minor, 3000);
    assert.equal(sqlite.prepare('SELECT id FROM flexible_monthly_plans WHERE id = ?').get('f1').id, 'f1');
    assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'card_statements'").get());
  } finally {
    sqlite.close();
  }
});

test('v3 kart ve hesap verileri korunarak fiyat önbelleğine yükseltilir', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(`
      CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL,
        purpose TEXT NOT NULL, balance_minor INTEGER NOT NULL, balance_date TEXT NOT NULL,
        balance_recorded_at TEXT, remaining_flexible_minor INTEGER);
      CREATE TABLE balance_snapshots (id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
        observed_on TEXT NOT NULL, actual_minor INTEGER NOT NULL, expected_minor INTEGER,
        difference_minor INTEGER, remaining_flexible_minor INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE credit_cards (id TEXT PRIMARY KEY, name TEXT NOT NULL, payment_account_id TEXT NOT NULL,
        closing_day INTEGER NOT NULL, payment_day INTEGER NOT NULL,
        monthly_spending_estimate_minor INTEGER NOT NULL, starts_on TEXT NOT NULL);
      CREATE TABLE monthly_plans (id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
        title TEXT NOT NULL, kind TEXT NOT NULL, amount_minor INTEGER NOT NULL,
        due_day INTEGER NOT NULL, starts_on TEXT NOT NULL, ends_on TEXT,
        created_at TEXT NOT NULL);
      CREATE TABLE flexible_monthly_plans (id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
        title TEXT NOT NULL, amount_minor INTEGER NOT NULL, starts_on TEXT NOT NULL,
        ends_on TEXT, created_at TEXT NOT NULL);
      INSERT INTO accounts VALUES ('usd1', 'Dolar', 'USD', 'savings', 12345, '2026-10-01', NULL, NULL);
      INSERT INTO accounts VALUES ('try1', 'Banka', 'TRY', 'spending', 50000, '2026-10-01', NULL, NULL);
      INSERT INTO credit_cards VALUES ('card1', 'Kart', 'try1', 15, 25, 1000, '2026-10-01');
      PRAGMA user_version = 3;
    `);
    await migrateDatabase(adapter(sqlite));
    assert.equal(sqlite.prepare('PRAGMA user_version').get().user_version, 7);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'usd1'").get().balance_minor, 12345);
    assert.equal(sqlite.prepare("SELECT id FROM credit_cards WHERE id = 'card1'").get().id, 'card1');
    assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'gold_holdings'").get());
  } finally {
    sqlite.close();
  }
});

test('v4 fiyat ve altın kayıtları v7 geçişinde korunur', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(`
      CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL,
        purpose TEXT NOT NULL, balance_minor INTEGER NOT NULL, balance_date TEXT NOT NULL,
        balance_recorded_at TEXT, remaining_flexible_minor INTEGER);
      CREATE TABLE balance_snapshots (id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
        observed_on TEXT NOT NULL, actual_minor INTEGER NOT NULL, expected_minor INTEGER,
        difference_minor INTEGER, remaining_flexible_minor INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE gold_holdings (id TEXT PRIMARY KEY, name TEXT NOT NULL, quantity_micros INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE price_quotes (asset_code TEXT PRIMARY KEY, price_try_micros INTEGER NOT NULL,
        quoted_at TEXT NOT NULL, source TEXT NOT NULL, source_url TEXT NOT NULL, fetched_at TEXT NOT NULL);
      CREATE TABLE monthly_plans (id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
        title TEXT NOT NULL, kind TEXT NOT NULL, amount_minor INTEGER NOT NULL,
        due_day INTEGER NOT NULL, starts_on TEXT NOT NULL, ends_on TEXT,
        created_at TEXT NOT NULL);
      CREATE TABLE flexible_monthly_plans (id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
        title TEXT NOT NULL, amount_minor INTEGER NOT NULL, starts_on TEXT NOT NULL,
        ends_on TEXT, created_at TEXT NOT NULL);
      INSERT INTO accounts VALUES ('usd1', 'Dolar', 'USD', 'savings', 12345, '2026-10-01', NULL, NULL);
      INSERT INTO gold_holdings (id, name, quantity_micros) VALUES ('gold1', 'Altın', 12500000);
      INSERT INTO price_quotes VALUES ('USD', 50000000, '2026-10-23', 'ECB', 'https://example.test', '2026-10-25T10:00:00Z');
      PRAGMA user_version = 4;
    `);
    await migrateDatabase(adapter(sqlite));
    assert.equal(sqlite.prepare('PRAGMA user_version').get().user_version, 7);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'usd1'").get().balance_minor, 12345);
    assert.equal(sqlite.prepare("SELECT quantity_micros FROM gold_holdings WHERE id = 'gold1'").get().quantity_micros, 12500000);
    assert.equal(sqlite.prepare("SELECT price_try_micros FROM price_quotes WHERE asset_code = 'USD'").get().price_try_micros, 50000000);
    assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'asset_conversions'").get());
  } finally {
    sqlite.close();
  }
});

test('v5 eski hesap gözlem zamanı gerçek snapshot kaydından tamamlanır', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY, balance_minor INTEGER NOT NULL,
        balance_date TEXT NOT NULL, balance_recorded_at TEXT
      );
      CREATE TABLE balance_snapshots (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, observed_on TEXT NOT NULL,
        actual_minor INTEGER NOT NULL, expected_minor INTEGER, difference_minor INTEGER,
        remaining_flexible_minor INTEGER, kind TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE monthly_plans (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, title TEXT NOT NULL,
        kind TEXT NOT NULL, amount_minor INTEGER NOT NULL, due_day INTEGER NOT NULL,
        starts_on TEXT NOT NULL, ends_on TEXT, created_at TEXT NOT NULL);
      CREATE TABLE flexible_monthly_plans (id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
        title TEXT NOT NULL, amount_minor INTEGER NOT NULL, starts_on TEXT NOT NULL,
        ends_on TEXT, created_at TEXT NOT NULL);
      CREATE TABLE one_time_plans (id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
        title TEXT NOT NULL, kind TEXT NOT NULL, amount_minor INTEGER NOT NULL,
        due_on TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO accounts VALUES ('a1', 125000, '2026-10-25', NULL);
      INSERT INTO balance_snapshots
        (id, account_id, observed_on, actual_minor, kind, created_at) VALUES
        ('observed', 'a1', '2026-10-25', 100000, 'observed', '2026-10-25 09:00:00'),
        ('conversion', 'a1', '2026-10-25', 125000, 'conversion', '2026-10-25 10:00:00');
      PRAGMA user_version = 5;
    `);
    await migrateDatabase(adapter(sqlite));
    assert.equal(sqlite.prepare('PRAGMA user_version').get().user_version, 7);
    const account = sqlite.prepare("SELECT balance_minor, balance_recorded_at FROM accounts WHERE id = 'a1'").get();
    assert.equal(account.balance_minor, 125000);
    assert.equal(account.balance_recorded_at, '2026-10-25T09:00:00.000Z');
  } finally {
    sqlite.close();
  }
});

test('yeni kurulum doğrudan v7 şemasına gelir', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    await migrateDatabase(adapter(sqlite));
    assert.equal(sqlite.prepare('PRAGMA user_version').get().user_version, 7);
    assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'flexible_monthly_plans'").get());
    assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'installment_plans'").get());
    assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'price_quotes'").get());
    assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'one_time_plans'").get());
    sqlite.exec("INSERT INTO price_quotes VALUES ('USD', 50000000, '2026-10-23', 'ECB', 'https://example.test', '2026-10-25T10:00:00Z')");
    await migrateDatabase(adapter(sqlite));
    assert.equal(sqlite.prepare("SELECT price_try_micros FROM price_quotes WHERE asset_code = 'USD'").get().price_try_micros, 50000000);
  } finally {
    sqlite.close();
  }
});

test('v6 planları ve bakiye geçmişi korunarak kategori şemasına yükseltilir', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(`
      CREATE TABLE accounts (id TEXT PRIMARY KEY, balance_minor INTEGER NOT NULL,
        balance_date TEXT NOT NULL, balance_recorded_at TEXT);
      CREATE TABLE balance_snapshots (id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
        observed_on TEXT NOT NULL, actual_minor INTEGER NOT NULL, expected_minor INTEGER,
        difference_minor INTEGER, created_at TEXT NOT NULL, remaining_flexible_minor INTEGER,
        kind TEXT NOT NULL);
      CREATE TABLE monthly_plans (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, title TEXT NOT NULL,
        kind TEXT NOT NULL, amount_minor INTEGER NOT NULL, due_day INTEGER NOT NULL,
        starts_on TEXT NOT NULL, ends_on TEXT, created_at TEXT NOT NULL);
      CREATE TABLE flexible_monthly_plans (id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
        title TEXT NOT NULL, amount_minor INTEGER NOT NULL, starts_on TEXT NOT NULL,
        ends_on TEXT, created_at TEXT NOT NULL);
      CREATE TABLE one_time_plans (id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
        title TEXT NOT NULL, kind TEXT NOT NULL, amount_minor INTEGER NOT NULL,
        due_on TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO accounts VALUES ('a1', 100000, '2026-10-25', '2026-10-25T08:00:00.000Z');
      INSERT INTO balance_snapshots VALUES
        ('s1', 'a1', '2026-10-25', 100000, NULL, NULL, '2026-10-25T08:00:00.000Z', NULL, 'observed');
      INSERT INTO monthly_plans VALUES
        ('m1', 'a1', 'Kira', 'expense', 30000, 1, '2026-10-01', NULL, '2026-10-01T08:00:00.000Z');
      INSERT INTO flexible_monthly_plans VALUES
        ('f1', 'a1', 'Market', 20000, '2026-10-01', NULL, '2026-10-01T08:00:00.000Z');
      INSERT INTO one_time_plans VALUES
        ('o1', 'a1', 'Tamir', 'expense', 5000, '2026-10-25', 'planned',
         '2026-10-01T08:00:00.000Z', '2026-10-01T08:00:00.000Z');
      PRAGMA user_version = 6;
    `);
    await migrateDatabase(adapter(sqlite));
    assert.equal(sqlite.prepare('PRAGMA user_version').get().user_version, 7);
    assert.equal(sqlite.prepare("SELECT category_id FROM monthly_plans WHERE id = 'm1'").get().category_id, null);
    assert.equal(sqlite.prepare("SELECT category_id FROM flexible_monthly_plans WHERE id = 'f1'").get().category_id, null);
    assert.equal(sqlite.prepare("SELECT category_id FROM one_time_plans WHERE id = 'o1'").get().category_id, null);
    assert.equal(sqlite.prepare("SELECT actual_minor FROM balance_snapshots WHERE id = 's1'").get().actual_minor, 100000);
    assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'actual_expenses'").get());
  } finally {
    sqlite.close();
  }
});
