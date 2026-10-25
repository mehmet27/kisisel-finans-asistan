import type { SQLiteDatabase } from 'expo-sqlite';

const DATABASE_VERSION = 8;

export async function migrateDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version > DATABASE_VERSION) throw new Error('Veritabanı sürümü uygulamadan yeni.');
  if (version === DATABASE_VERSION) return;

  await db.withTransactionAsync(async () => {
    if (version < 1) {
      await db.execAsync(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        currency TEXT NOT NULL CHECK (currency IN ('TRY', 'USD', 'EUR')),
        purpose TEXT NOT NULL CHECK (purpose IN ('spending', 'savings')),
        balance_minor INTEGER NOT NULL,
        balance_date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS balance_snapshots (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        observed_on TEXT NOT NULL,
        actual_minor INTEGER NOT NULL,
        expected_minor INTEGER,
        difference_minor INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS monthly_plans (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
        starts_on TEXT NOT NULL,
        ends_on TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_monthly_plans_account ON monthly_plans(account_id);
      CREATE INDEX IF NOT EXISTS idx_snapshots_account ON balance_snapshots(account_id, created_at DESC);
      `);
    }
    if (version < 2) {
      await db.execAsync(`
        ALTER TABLE accounts ADD COLUMN remaining_flexible_minor INTEGER CHECK (remaining_flexible_minor >= 0);
        ALTER TABLE balance_snapshots ADD COLUMN remaining_flexible_minor INTEGER CHECK (remaining_flexible_minor >= 0);
        CREATE TABLE flexible_monthly_plans (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
          starts_on TEXT NOT NULL,
          ends_on TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX idx_flexible_monthly_plans_account ON flexible_monthly_plans(account_id);
      `);
    }
    if (version < 3) {
      await db.execAsync(`
        ALTER TABLE accounts ADD COLUMN balance_recorded_at TEXT;
        CREATE TABLE credit_cards (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          payment_account_id TEXT NOT NULL REFERENCES accounts(id),
          closing_day INTEGER NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
          payment_day INTEGER NOT NULL CHECK (payment_day BETWEEN 1 AND 31),
          monthly_spending_estimate_minor INTEGER NOT NULL DEFAULT 0 CHECK (monthly_spending_estimate_minor >= 0),
          starts_on TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE card_statements (
          id TEXT PRIMARY KEY,
          card_id TEXT NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
          statement_period TEXT NOT NULL,
          due_date TEXT NOT NULL,
          actual_amount_minor INTEGER NOT NULL CHECK (actual_amount_minor >= 0),
          planned_payment_minor INTEGER NOT NULL CHECK (planned_payment_minor >= 0),
          payment_account_id TEXT NOT NULL REFERENCES accounts(id),
          status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'paid')),
          paid_on TEXT,
          paid_at TEXT,
          paid_amount_minor INTEGER CHECK (paid_amount_minor >= 0),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(card_id, statement_period)
        );
        CREATE TABLE installment_plans (
          id TEXT PRIMARY KEY,
          card_id TEXT NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          total_amount_minor INTEGER NOT NULL CHECK (total_amount_minor > 0),
          installment_count INTEGER NOT NULL CHECK (installment_count BETWEEN 1 AND 120),
          first_statement_period TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX idx_card_statements_card_period ON card_statements(card_id, statement_period);
        CREATE INDEX idx_installment_plans_card ON installment_plans(card_id);
      `);
    }
    if (version < 4) {
      await db.execAsync(`
        CREATE TABLE gold_holdings (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          quantity_micros INTEGER NOT NULL CHECK (quantity_micros >= 0),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE price_quotes (
          asset_code TEXT PRIMARY KEY CHECK (asset_code IN ('USD', 'EUR', 'XAU_GRAM')),
          price_try_micros INTEGER NOT NULL CHECK (price_try_micros > 0),
          quoted_at TEXT NOT NULL,
          source TEXT NOT NULL,
          source_url TEXT NOT NULL,
          fetched_at TEXT NOT NULL
        );
      `);
    }
    if (version < 5) {
      await db.execAsync(`
        ALTER TABLE balance_snapshots ADD COLUMN kind TEXT NOT NULL DEFAULT 'observed'
          CHECK (kind IN ('observed', 'conversion'));
        CREATE TABLE asset_conversions (
          id TEXT PRIMARY KEY,
          client_request_id TEXT NOT NULL UNIQUE,
          kind TEXT NOT NULL CHECK (kind IN ('fx_exchange', 'gold_sale')),
          source_account_id TEXT REFERENCES accounts(id),
          gold_holding_id TEXT REFERENCES gold_holdings(id),
          target_account_id TEXT NOT NULL REFERENCES accounts(id),
          source_code TEXT NOT NULL CHECK (source_code IN ('USD', 'EUR', 'XAU_GRAM')),
          source_amount_minor INTEGER CHECK (source_amount_minor > 0),
          quantity_micros INTEGER CHECK (quantity_micros > 0),
          gross_try_minor INTEGER NOT NULL CHECK (gross_try_minor > 0),
          fee_try_minor INTEGER NOT NULL CHECK (fee_try_minor >= 0),
          net_try_minor INTEGER NOT NULL CHECK (net_try_minor > 0),
          realized_price_try_micros INTEGER NOT NULL CHECK (realized_price_try_micros > 0),
          occurred_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK (gross_try_minor = fee_try_minor + net_try_minor),
          CHECK (
            (kind = 'fx_exchange' AND source_account_id IS NOT NULL AND source_amount_minor IS NOT NULL
              AND gold_holding_id IS NULL AND quantity_micros IS NULL AND source_code IN ('USD', 'EUR'))
            OR
            (kind = 'gold_sale' AND gold_holding_id IS NOT NULL AND quantity_micros IS NOT NULL
              AND source_account_id IS NULL AND source_amount_minor IS NULL AND source_code = 'XAU_GRAM')
          )
        );
        CREATE TABLE one_time_plans (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
          amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
          due_on TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'cancelled')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_one_time_plans_due ON one_time_plans(due_on, status);
        CREATE INDEX idx_asset_conversions_occurred ON asset_conversions(occurred_at);
      `);
    }
    if (version < 6) {
      await db.execAsync(`
        UPDATE accounts
        SET balance_recorded_at = (
          SELECT CASE
            WHEN instr(s.created_at, 'T') > 0 THEN s.created_at
            ELSE replace(s.created_at, ' ', 'T') || '.000Z'
          END
          FROM balance_snapshots AS s
          WHERE s.account_id = accounts.id
            AND s.observed_on = accounts.balance_date
            AND s.kind = 'observed'
          ORDER BY s.created_at DESC, s.rowid DESC
          LIMIT 1
        )
        WHERE balance_recorded_at IS NULL;
      `);
    }
    if (version < 7) {
      await db.execAsync(`
        CREATE TABLE categories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) > 0),
          created_at TEXT NOT NULL
        );
        ALTER TABLE monthly_plans ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL;
        ALTER TABLE flexible_monthly_plans ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL;
        ALTER TABLE one_time_plans ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL;
        CREATE TABLE actual_expenses (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id),
          category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
          amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
          occurred_on TEXT NOT NULL,
          created_at TEXT NOT NULL,
          plan_type TEXT CHECK (plan_type IN ('regular', 'flexible', 'one_time')),
          plan_id TEXT,
          balance_before_minor INTEGER NOT NULL,
          balance_after_minor INTEGER NOT NULL,
          remaining_before_minor INTEGER,
          remaining_after_minor INTEGER,
          CHECK ((plan_type IS NULL AND plan_id IS NULL) OR (plan_type IS NOT NULL AND plan_id IS NOT NULL))
        );
        CREATE INDEX idx_actual_expenses_month ON actual_expenses(occurred_on, account_id);
        CREATE INDEX idx_actual_expenses_plan ON actual_expenses(plan_type, plan_id, occurred_on);
        CREATE INDEX idx_monthly_plans_category ON monthly_plans(category_id);
        CREATE INDEX idx_flexible_plans_category ON flexible_monthly_plans(category_id);
        CREATE INDEX idx_one_time_plans_category ON one_time_plans(category_id);
        CREATE TABLE balance_snapshots_v7 (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          observed_on TEXT NOT NULL,
          actual_minor INTEGER NOT NULL,
          expected_minor INTEGER,
          difference_minor INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          remaining_flexible_minor INTEGER CHECK (remaining_flexible_minor >= 0),
          kind TEXT NOT NULL DEFAULT 'observed' CHECK (kind IN ('observed', 'conversion', 'expense')),
          expense_id TEXT UNIQUE REFERENCES actual_expenses(id)
        );
        INSERT INTO balance_snapshots_v7
          (id, account_id, observed_on, actual_minor, expected_minor, difference_minor,
           created_at, remaining_flexible_minor, kind)
        SELECT id, account_id, observed_on, actual_minor, expected_minor, difference_minor,
               created_at, remaining_flexible_minor, kind FROM balance_snapshots;
        DROP TABLE balance_snapshots;
        ALTER TABLE balance_snapshots_v7 RENAME TO balance_snapshots;
        CREATE INDEX idx_snapshots_account ON balance_snapshots(account_id, created_at DESC);
      `);
    }
    if (version < 8) {
      await db.execAsync(`
        CREATE TABLE try_transfers (
          id TEXT PRIMARY KEY,
          client_request_id TEXT NOT NULL UNIQUE,
          source_account_id TEXT NOT NULL REFERENCES accounts(id),
          target_account_id TEXT NOT NULL REFERENCES accounts(id),
          amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
          occurred_at TEXT NOT NULL,
          CHECK (source_account_id <> target_account_id)
        );
        CREATE INDEX idx_try_transfers_occurred ON try_transfers(occurred_at);
        CREATE TABLE card_statement_payments (
          id TEXT PRIMARY KEY,
          statement_id TEXT NOT NULL REFERENCES card_statements(id) ON DELETE CASCADE,
          payment_account_id TEXT NOT NULL REFERENCES accounts(id),
          amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
          paid_on TEXT NOT NULL,
          paid_at TEXT NOT NULL
        );
        CREATE INDEX idx_card_payments_statement ON card_statement_payments(statement_id, paid_on, paid_at);
        INSERT INTO card_statement_payments
          (id, statement_id, payment_account_id, amount_minor, paid_on, paid_at)
        SELECT 'legacy:' || id, id, payment_account_id, paid_amount_minor,
               COALESCE(paid_on, due_date), COALESCE(paid_at, created_at)
        FROM card_statements WHERE status = 'paid' AND paid_amount_minor > 0;
        UPDATE card_statements SET status = 'planned'
        WHERE status = 'paid' AND COALESCE(paid_amount_minor, 0) < actual_amount_minor;
        CREATE TABLE balance_snapshots_v8 (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          observed_on TEXT NOT NULL,
          actual_minor INTEGER NOT NULL,
          expected_minor INTEGER,
          difference_minor INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          remaining_flexible_minor INTEGER CHECK (remaining_flexible_minor >= 0),
          kind TEXT NOT NULL DEFAULT 'observed' CHECK (kind IN ('observed', 'conversion', 'expense', 'transfer')),
          expense_id TEXT UNIQUE REFERENCES actual_expenses(id),
          transfer_id TEXT REFERENCES try_transfers(id),
          explanation TEXT
        );
        INSERT INTO balance_snapshots_v8
          (id, account_id, observed_on, actual_minor, expected_minor, difference_minor,
           created_at, remaining_flexible_minor, kind, expense_id)
        SELECT id, account_id, observed_on, actual_minor, expected_minor, difference_minor,
               created_at, remaining_flexible_minor, kind, expense_id FROM balance_snapshots;
        DROP TABLE balance_snapshots;
        ALTER TABLE balance_snapshots_v8 RENAME TO balance_snapshots;
        CREATE INDEX idx_snapshots_account ON balance_snapshots(account_id, created_at DESC);
        CREATE INDEX idx_snapshots_transfer ON balance_snapshots(transfer_id);
      `);
    }
    await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
  });
}
