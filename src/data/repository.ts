import type { SQLiteDatabase } from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { localDateString, monthEnd, projectAccountBalance } from '../domain/finance';
import type { Account, AccountPurpose, ActualExpense, BalanceSnapshot, CardStatement, Category, CategoryMonthlyTotal, CreditCard, Currency, FlexibleMonthlyPlan, InstallmentPlan, MonthlyPlan, OneTimePlan, PlanKind } from '../domain/finance';
import type { AssetCode, GoldHolding, PriceQuote } from '../domain/valuation';
import { ConversionError, previewFxConversion, previewGoldConversion } from '../domain/conversions';
import type { AssetConversion } from '../domain/conversions';

interface AccountRow {
  id: string;
  name: string;
  currency: Currency;
  purpose: AccountPurpose;
  balance_minor: number;
  balance_date: string;
  balance_recorded_at: string | null;
  remaining_flexible_minor: number | null;
}

interface PlanRow {
  id: string;
  account_id: string;
  title: string;
  kind: PlanKind;
  amount_minor: number;
  due_day: number;
  starts_on: string;
  ends_on: string | null;
  created_at: string;
  category_id: string | null;
}

interface FlexiblePlanRow {
  id: string;
  account_id: string;
  title: string;
  amount_minor: number;
  starts_on: string;
  ends_on: string | null;
  category_id: string | null;
}

interface SnapshotRow {
  id: string;
  kind: 'observed' | 'conversion' | 'expense';
  expense_id: string | null;
  account_id: string;
  observed_on: string;
  actual_minor: number;
  expected_minor: number | null;
  difference_minor: number | null;
  remaining_flexible_minor: number | null;
}

interface CardRow {
  id: string;
  name: string;
  payment_account_id: string;
  closing_day: number;
  payment_day: number;
  monthly_spending_estimate_minor: number;
  starts_on: string;
}

interface StatementRow {
  id: string;
  card_id: string;
  statement_period: string;
  due_date: string;
  actual_amount_minor: number;
  planned_payment_minor: number;
  payment_account_id: string;
  status: 'planned' | 'paid';
  paid_on: string | null;
  paid_at: string | null;
  paid_amount_minor: number | null;
}

interface InstallmentRow {
  id: string;
  card_id: string;
  title: string;
  total_amount_minor: number;
  installment_count: number;
  first_statement_period: string;
}

interface GoldRow {
  id: string;
  name: string;
  quantity_micros: number;
}

// Expo's regular transaction uses the provider connection. Keep every repository write
// out of another write transaction's async gaps on that same connection.
const writeTails = new WeakMap<SQLiteDatabase, Promise<void>>();

async function withRepositoryWrite<T>(db: SQLiteDatabase, work: () => Promise<T>): Promise<T> {
  const previous = writeTails.get(db) ?? Promise.resolve();
  let release!: () => void;
  const completed = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => completed);
  writeTails.set(db, tail);
  await previous;
  try { return await work(); }
  finally {
    release();
    if (writeTails.get(db) === tail) writeTails.delete(db);
  }
}

export function withRepositoryWriteLock<T>(db: SQLiteDatabase, work: () => Promise<T>): Promise<T> {
  return withRepositoryWrite(db, work);
}

function serializedRunAsync(
  db: SQLiteDatabase, sql: string, ...params: (string | number | null)[]
): ReturnType<SQLiteDatabase['runAsync']> {
  return withRepositoryWrite(db, () => db.runAsync(sql, ...params));
}

interface QuoteRow {
  asset_code: AssetCode;
  price_try_micros: number;
  quoted_at: string;
  source: string;
  source_url: string;
  fetched_at: string;
}

interface ConversionRow {
  id: string;
  client_request_id: string;
  kind: 'fx_exchange' | 'gold_sale';
  source_account_id: string | null;
  gold_holding_id: string | null;
  target_account_id: string;
  source_code: AssetCode;
  source_amount_minor: number | null;
  quantity_micros: number | null;
  gross_try_minor: number;
  fee_try_minor: number;
  net_try_minor: number;
  realized_price_try_micros: number;
  occurred_at: string;
}

interface OneTimePlanRow {
  id: string;
  account_id: string;
  title: string;
  kind: PlanKind;
  amount_minor: number;
  due_on: string;
  status: 'planned' | 'cancelled';
  created_at: string;
  category_id: string | null;
}

interface CategoryRow {
  id: string;
  name: string;
  created_at: string;
}

interface ActualExpenseRow {
  id: string;
  account_id: string;
  category_id: string | null;
  amount_minor: number;
  occurred_on: string;
  plan_type: 'regular' | 'flexible' | 'one_time' | null;
  plan_id: string | null;
  balance_before_minor: number;
  balance_after_minor: number;
  remaining_before_minor: number | null;
  remaining_after_minor: number | null;
}

interface AccountBalanceRow {
  id: string;
  currency: Currency;
  purpose: AccountPurpose;
  balance_minor: number;
  balance_date: string;
  balance_recorded_at: string | null;
  remaining_flexible_minor: number | null;
}

function isMonthPeriod(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function isDate(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)
    && localDateString(new Date(`${value}T12:00:00`)) === value;
}

async function requireTryAccount(db: SQLiteDatabase, accountId: string): Promise<void> {
  const row = await db.getFirstAsync<{ currency: Currency; purpose: AccountPurpose }>(
    'SELECT currency, purpose FROM accounts WHERE id = ?', accountId,
  );
  if (!row || row.currency !== 'TRY' || row.purpose !== 'spending') {
    throw new Error('Kart ödemesi için TL kullanım hesabı seçin.');
  }
}

function mapAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    currency: row.currency,
    purpose: row.purpose,
    balanceMinor: row.balance_minor,
    balanceDate: row.balance_date,
    balanceRecordedAt: row.balance_recorded_at,
    remainingFlexibleMinor: row.remaining_flexible_minor,
  };
}

function mapPlan(row: PlanRow): MonthlyPlan {
  return {
    id: row.id,
    accountId: row.account_id,
    title: row.title,
    kind: row.kind,
    amountMinor: row.amount_minor,
    dueDay: row.due_day,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    createdAt: row.created_at,
    categoryId: row.category_id,
  };
}

function mapFlexiblePlan(row: FlexiblePlanRow): FlexibleMonthlyPlan {
  return {
    id: row.id,
    accountId: row.account_id,
    title: row.title,
    amountMinor: row.amount_minor,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    categoryId: row.category_id,
  };
}

function mapSnapshot(row: SnapshotRow): BalanceSnapshot {
  return {
    id: row.id,
    kind: row.kind,
    expenseId: row.expense_id,
    accountId: row.account_id,
    observedOn: row.observed_on,
    actualMinor: row.actual_minor,
    expectedMinor: row.expected_minor,
    differenceMinor: row.difference_minor,
    remainingFlexibleMinor: row.remaining_flexible_minor,
  };
}

export async function listAccounts(db: SQLiteDatabase): Promise<Account[]> {
  const rows = await db.getAllAsync<AccountRow>('SELECT * FROM accounts ORDER BY created_at, rowid');
  return rows.map(mapAccount);
}

export async function createAccount(
  db: SQLiteDatabase,
  input: { name: string; currency: Currency; purpose: AccountPurpose; balanceMinor: number },
): Promise<void> {
  const observedOn = localDateString();
  const recordedAt = new Date().toISOString();
  const accountId = Crypto.randomUUID();
  await withRepositoryWrite(db, () => db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT INTO accounts (id, name, currency, purpose, balance_minor, balance_date, balance_recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      accountId, input.name.trim(), input.currency, input.purpose, input.balanceMinor, observedOn, recordedAt,
    );
    await db.runAsync(
      'INSERT INTO balance_snapshots (id, account_id, observed_on, actual_minor, created_at) VALUES (?, ?, ?, ?, ?)',
      Crypto.randomUUID(), accountId, observedOn, input.balanceMinor, recordedAt,
    );
  }));
}

export async function updateBalance(
  db: SQLiteDatabase,
  account: Account,
  actualMinor: number,
  remainingFlexibleMinor?: number | null,
): Promise<BalanceSnapshot> {
  if (!Number.isSafeInteger(actualMinor)) throw new Error('Geçersiz bakiye.');
  if (remainingFlexibleMinor != null && (!Number.isSafeInteger(remainingFlexibleMinor) || remainingFlexibleMinor < 0)) {
    throw new Error('Kalan değişken harcama geçersiz.');
  }
  const remaining = remainingFlexibleMinor ?? null;
  const observedOn = localDateString();
  const recordedAt = new Date().toISOString();
  const [plans, flexiblePlans, cards, statements, installments, oneTimePlans] = await Promise.all([
    listPlans(db), listFlexiblePlans(db), listCreditCards(db), listCardStatements(db), listInstallmentPlans(db),
    listOneTimePlans(db),
  ]);
  const expectedMinor = projectAccountBalance(
    account, plans, observedOn, flexiblePlans, cards, statements, installments, oneTimePlans,
  );
  const differenceMinor = actualMinor - expectedMinor;
  const snapshotId = Crypto.randomUUID();
  await withRepositoryWrite(db, () => db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE accounts SET balance_minor = ?, balance_date = ?, balance_recorded_at = ?, remaining_flexible_minor = ? WHERE id = ?',
      actualMinor, observedOn, recordedAt, remaining, account.id,
    );
    await db.runAsync(
      'INSERT INTO balance_snapshots (id, account_id, observed_on, actual_minor, expected_minor, difference_minor, remaining_flexible_minor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      snapshotId, account.id, observedOn, actualMinor, expectedMinor, differenceMinor, remaining, recordedAt,
    );
  }));
  return {
    id: snapshotId,
    kind: 'observed',
    accountId: account.id,
    observedOn,
    actualMinor,
    expectedMinor,
    differenceMinor,
    remainingFlexibleMinor: remaining,
  };
}

export async function latestSnapshot(db: SQLiteDatabase, accountId: string): Promise<BalanceSnapshot | null> {
  const row = await db.getFirstAsync<SnapshotRow>(
    'SELECT * FROM balance_snapshots WHERE account_id = ? ORDER BY rowid DESC LIMIT 1', accountId,
  );
  return row ? mapSnapshot(row) : null;
}

export async function listSnapshots(db: SQLiteDatabase, accountId: string): Promise<BalanceSnapshot[]> {
  const rows = await db.getAllAsync<SnapshotRow>(
    'SELECT * FROM balance_snapshots WHERE account_id = ? ORDER BY rowid DESC', accountId,
  );
  return rows.map(mapSnapshot);
}

export async function listPlans(db: SQLiteDatabase): Promise<MonthlyPlan[]> {
  const [rows, fulfilled] = await Promise.all([
    db.getAllAsync<PlanRow>('SELECT * FROM monthly_plans ORDER BY due_day, id'),
    db.getAllAsync<{ plan_id: string; month: string }>(
      "SELECT plan_id, substr(occurred_on, 1, 7) AS month FROM actual_expenses WHERE plan_type = 'regular'",
    ),
  ]);
  const months = new Map<string, string[]>();
  for (const entry of fulfilled) months.set(entry.plan_id, [...(months.get(entry.plan_id) ?? []), entry.month]);
  return rows.map((row) => ({ ...mapPlan(row), fulfilledMonths: months.get(row.id) ?? [] }));
}

export async function listFlexiblePlans(db: SQLiteDatabase): Promise<FlexibleMonthlyPlan[]> {
  const [rows, actual] = await Promise.all([
    db.getAllAsync<FlexiblePlanRow>('SELECT * FROM flexible_monthly_plans ORDER BY created_at, rowid'),
    db.getAllAsync<{ plan_id: string; month: string; amount_minor: number }>(
      `SELECT plan_id, substr(occurred_on, 1, 7) AS month, SUM(amount_minor) AS amount_minor
       FROM actual_expenses WHERE plan_type = 'flexible' GROUP BY plan_id, month`,
    ),
  ]);
  const spent = new Map<string, Record<string, number>>();
  for (const entry of actual) {
    const months = spent.get(entry.plan_id) ?? {};
    months[entry.month] = entry.amount_minor;
    spent.set(entry.plan_id, months);
  }
  return rows.map((row) => ({ ...mapFlexiblePlan(row), actualSpentByMonth: spent.get(row.id) ?? {} }));
}

export async function createFlexiblePlan(
  db: SQLiteDatabase,
  input: { accountId: string; title: string; amountMinor: number; categoryId?: string | null },
): Promise<void> {
  if (!input.title.trim() || !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error('Geçersiz değişken gider planı.');
  }
  await serializedRunAsync(db,
    'INSERT INTO flexible_monthly_plans (id, account_id, title, amount_minor, starts_on, category_id) VALUES (?, ?, ?, ?, ?, ?)',
    Crypto.randomUUID(), input.accountId, input.title.trim(), input.amountMinor, localDateString(), input.categoryId ?? null,
  );
}

export async function stopFlexiblePlan(db: SQLiteDatabase, id: string): Promise<void> {
  const today = new Date();
  await serializedRunAsync(db, 'UPDATE flexible_monthly_plans SET ends_on = ? WHERE id = ? AND ends_on IS NULL',
    monthEnd(today.getFullYear(), today.getMonth()), id);
}

export async function createPlan(
  db: SQLiteDatabase,
  input: { accountId: string; title: string; kind: PlanKind; amountMinor: number; dueDay: number; categoryId?: string | null },
): Promise<void> {
  if (input.kind === 'income' && input.categoryId) throw new Error('Gelir planı için gider kategorisi seçilemez.');
  await serializedRunAsync(db,
    'INSERT INTO monthly_plans (id, account_id, title, kind, amount_minor, due_day, starts_on, created_at, category_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    Crypto.randomUUID(), input.accountId, input.title.trim(), input.kind, input.amountMinor, input.dueDay,
    localDateString(), new Date().toISOString(), input.kind === 'expense' ? input.categoryId ?? null : null,
  );
}

export async function stopPlan(db: SQLiteDatabase, id: string): Promise<void> {
  const today = new Date();
  await serializedRunAsync(db, 'UPDATE monthly_plans SET ends_on = ? WHERE id = ? AND ends_on IS NULL',
    monthEnd(today.getFullYear(), today.getMonth()), id);
}

export async function listCreditCards(db: SQLiteDatabase): Promise<CreditCard[]> {
  const rows = await db.getAllAsync<CardRow>('SELECT * FROM credit_cards ORDER BY created_at, rowid');
  return rows.map((row) => ({
    id: row.id, name: row.name, paymentAccountId: row.payment_account_id,
    closingDay: row.closing_day, paymentDay: row.payment_day,
    monthlySpendingEstimateMinor: row.monthly_spending_estimate_minor, startsOn: row.starts_on,
  }));
}

export async function createCreditCard(
  db: SQLiteDatabase,
  input: { name: string; paymentAccountId: string; closingDay: number; paymentDay: number; monthlySpendingEstimateMinor: number },
): Promise<void> {
  if (!input.name.trim() || !Number.isInteger(input.closingDay) || input.closingDay < 1 || input.closingDay > 31
    || !Number.isInteger(input.paymentDay) || input.paymentDay < 1 || input.paymentDay > 31
    || !Number.isSafeInteger(input.monthlySpendingEstimateMinor) || input.monthlySpendingEstimateMinor < 0) {
    throw new Error('Geçersiz kart bilgisi.');
  }
  await requireTryAccount(db, input.paymentAccountId);
  await serializedRunAsync(db,
    'INSERT INTO credit_cards (id, name, payment_account_id, closing_day, payment_day, monthly_spending_estimate_minor, starts_on) VALUES (?, ?, ?, ?, ?, ?, ?)',
    Crypto.randomUUID(), input.name.trim(), input.paymentAccountId, input.closingDay, input.paymentDay,
    input.monthlySpendingEstimateMinor, localDateString(),
  );
}

export async function listCardStatements(db: SQLiteDatabase): Promise<CardStatement[]> {
  const rows = await db.getAllAsync<StatementRow>(
    'SELECT * FROM card_statements ORDER BY statement_period DESC, due_date DESC, rowid DESC',
  );
  return rows.map((row) => ({
    id: row.id, cardId: row.card_id, statementPeriod: row.statement_period, dueDate: row.due_date,
    actualAmountMinor: row.actual_amount_minor, plannedPaymentMinor: row.planned_payment_minor,
    paymentAccountId: row.payment_account_id, status: row.status, paidOn: row.paid_on, paidAt: row.paid_at,
    paidAmountMinor: row.paid_amount_minor,
  }));
}

export async function createCardStatement(
  db: SQLiteDatabase,
  input: {
    cardId: string; statementPeriod: string; dueDate: string; actualAmountMinor: number;
    plannedPaymentMinor?: number; paymentAccountId: string;
  },
): Promise<void> {
  const planned = input.plannedPaymentMinor ?? input.actualAmountMinor;
  if (!isMonthPeriod(input.statementPeriod) || !isDate(input.dueDate)
    || !Number.isSafeInteger(input.actualAmountMinor) || input.actualAmountMinor < 0
    || !Number.isSafeInteger(planned) || planned < 0 || planned > input.actualAmountMinor) {
    throw new Error('Geçersiz ekstre bilgisi.');
  }
  await requireTryAccount(db, input.paymentAccountId);
  await serializedRunAsync(db,
    'INSERT INTO card_statements (id, card_id, statement_period, due_date, actual_amount_minor, planned_payment_minor, payment_account_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    Crypto.randomUUID(), input.cardId, input.statementPeriod, input.dueDate,
    input.actualAmountMinor, planned, input.paymentAccountId,
  );
}

export async function markCardStatementPaid(
  db: SQLiteDatabase,
  id: string,
  paidAmountMinor?: number,
): Promise<void> {
  await withRepositoryWrite(db, () => db.withTransactionAsync(async () => {
    const statement = await db.getFirstAsync<StatementRow>('SELECT * FROM card_statements WHERE id = ?', id);
    if (!statement) throw new Error('Ekstre bulunamadı.');
    if (statement.status === 'paid') throw new Error('Bu ödeme zaten kaydedildi.');
    const amount = paidAmountMinor ?? statement.planned_payment_minor;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > statement.actual_amount_minor) {
      throw new Error('Geçersiz ödeme tutarı.');
    }
    const paidOn = localDateString();
    const paidAt = new Date().toISOString();
    await db.runAsync(
      "UPDATE card_statements SET status = 'paid', paid_on = ?, paid_at = ?, paid_amount_minor = ? WHERE id = ?",
      paidOn, paidAt, amount, id,
    );
  }));
}

export async function listInstallmentPlans(db: SQLiteDatabase): Promise<InstallmentPlan[]> {
  const rows = await db.getAllAsync<InstallmentRow>('SELECT * FROM installment_plans ORDER BY first_statement_period, rowid');
  return rows.map((row) => ({
    id: row.id, cardId: row.card_id, title: row.title, totalAmountMinor: row.total_amount_minor,
    installmentCount: row.installment_count, firstStatementPeriod: row.first_statement_period,
  }));
}

export async function createInstallmentPlan(
  db: SQLiteDatabase,
  input: { cardId: string; title: string; totalAmountMinor: number; installmentCount: number; firstStatementPeriod: string },
): Promise<void> {
  if (!input.title.trim() || !Number.isSafeInteger(input.totalAmountMinor) || input.totalAmountMinor <= 0
    || !Number.isInteger(input.installmentCount) || input.installmentCount < 1 || input.installmentCount > 120
    || !isMonthPeriod(input.firstStatementPeriod)) {
    throw new Error('Geçersiz taksit planı.');
  }
  await serializedRunAsync(db,
    'INSERT INTO installment_plans (id, card_id, title, total_amount_minor, installment_count, first_statement_period) VALUES (?, ?, ?, ?, ?, ?)',
    Crypto.randomUUID(), input.cardId, input.title.trim(), input.totalAmountMinor,
    input.installmentCount, input.firstStatementPeriod,
  );
}

export async function listGoldHoldings(db: SQLiteDatabase): Promise<GoldHolding[]> {
  const rows = await db.getAllAsync<GoldRow>('SELECT id, name, quantity_micros FROM gold_holdings ORDER BY created_at, rowid');
  return rows.map((row) => ({ id: row.id, name: row.name, quantityMicros: row.quantity_micros }));
}

export async function createGoldHolding(
  db: SQLiteDatabase, input: { name: string; quantityMicros: number },
): Promise<void> {
  if (!input.name.trim() || !Number.isSafeInteger(input.quantityMicros) || input.quantityMicros < 0) {
    throw new Error('Geçersiz gram altın bilgisi.');
  }
  await serializedRunAsync(db,
    'INSERT INTO gold_holdings (id, name, quantity_micros) VALUES (?, ?, ?)',
    Crypto.randomUUID(), input.name.trim(), input.quantityMicros,
  );
}

export async function updateGoldHoldingQuantity(
  db: SQLiteDatabase, id: string, quantityMicros: number,
): Promise<void> {
  if (!Number.isSafeInteger(quantityMicros) || quantityMicros < 0) throw new Error('Geçersiz gram altın miktarı.');
  await serializedRunAsync(db,
    'UPDATE gold_holdings SET quantity_micros = ?, updated_at = ? WHERE id = ?',
    quantityMicros, new Date().toISOString(), id,
  );
}

export async function listPriceQuotes(db: SQLiteDatabase): Promise<PriceQuote[]> {
  const rows = await db.getAllAsync<QuoteRow>('SELECT * FROM price_quotes ORDER BY asset_code');
  return rows.map((row) => ({
    assetCode: row.asset_code, priceTryMicros: row.price_try_micros, quotedAt: row.quoted_at,
    source: row.source, sourceUrl: row.source_url, fetchedAt: row.fetched_at,
  }));
}

export async function savePriceQuotes(db: SQLiteDatabase, quotes: PriceQuote[]): Promise<void> {
  await withRepositoryWrite(db, () => db.withTransactionAsync(async () => {
    for (const quote of quotes) {
      if (!['USD', 'EUR', 'XAU_GRAM'].includes(quote.assetCode)
        || !Number.isSafeInteger(quote.priceTryMicros) || quote.priceTryMicros <= 0
        || !quote.quotedAt || !quote.source.trim() || !quote.sourceUrl || !quote.fetchedAt) {
        throw new Error('Geçersiz fiyat verisi.');
      }
      await db.runAsync(
        `INSERT INTO price_quotes (asset_code, price_try_micros, quoted_at, source, source_url, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(asset_code) DO UPDATE SET
           price_try_micros = excluded.price_try_micros,
           quoted_at = excluded.quoted_at,
           source = excluded.source,
           source_url = excluded.source_url,
           fetched_at = excluded.fetched_at
         WHERE excluded.quoted_at >= price_quotes.quoted_at`,
        quote.assetCode, quote.priceTryMicros, quote.quotedAt, quote.source, quote.sourceUrl, quote.fetchedAt,
      );
    }
  }));
}

export async function listOneTimePlans(db: SQLiteDatabase): Promise<OneTimePlan[]> {
  const [rows, fulfilled] = await Promise.all([
    db.getAllAsync<OneTimePlanRow>('SELECT * FROM one_time_plans ORDER BY due_on, created_at, id'),
    db.getAllAsync<{ plan_id: string }>(
      "SELECT plan_id FROM actual_expenses WHERE plan_type = 'one_time'",
    ),
  ]);
  const fulfilledIds = new Set(fulfilled.map((row) => row.plan_id));
  return rows.map((row) => ({
    id: row.id, accountId: row.account_id, title: row.title, kind: row.kind,
    amountMinor: row.amount_minor, dueOn: row.due_on, status: row.status, createdAt: row.created_at,
    categoryId: row.category_id,
    fulfilled: fulfilledIds.has(row.id),
  }));
}

export async function createOneTimePlan(
  db: SQLiteDatabase,
  input: { accountId: string; title: string; kind: PlanKind; amountMinor: number; dueOn: string; categoryId?: string | null },
): Promise<void> {
  if (!input.title.trim() || !['income', 'expense'].includes(input.kind)
    || !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0
    || !isDate(input.dueOn) || input.dueOn < localDateString()) {
    throw new Error('Geçersiz tek seferlik plan.');
  }
  if (input.kind === 'income' && input.categoryId) throw new Error('Gelir kalemi için gider kategorisi seçilemez.');
  const createdAt = new Date().toISOString();
  await serializedRunAsync(db,
    `INSERT INTO one_time_plans
      (id, account_id, title, kind, amount_minor, due_on, created_at, updated_at, category_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    Crypto.randomUUID(), input.accountId, input.title.trim(), input.kind, input.amountMinor,
    input.dueOn, createdAt, createdAt, input.kind === 'expense' ? input.categoryId ?? null : null,
  );
}

export async function cancelOneTimePlan(db: SQLiteDatabase, id: string): Promise<void> {
  await serializedRunAsync(db,
    "UPDATE one_time_plans SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'planned'",
    new Date().toISOString(), id,
  );
}

function mapConversion(row: ConversionRow): AssetConversion {
  return {
    id: row.id, requestId: row.client_request_id, kind: row.kind,
    sourceAccountId: row.source_account_id, goldHoldingId: row.gold_holding_id,
    targetAccountId: row.target_account_id, sourceCode: row.source_code,
    sourceAmountMinor: row.source_amount_minor, quantityMicros: row.quantity_micros,
    grossTryMinor: row.gross_try_minor, feeTryMinor: row.fee_try_minor, netTryMinor: row.net_try_minor,
    realizedPriceTryMicros: row.realized_price_try_micros, occurredAt: row.occurred_at,
  };
}

export async function listAssetConversions(db: SQLiteDatabase): Promise<AssetConversion[]> {
  const rows = await db.getAllAsync<ConversionRow>('SELECT * FROM asset_conversions ORDER BY occurred_at DESC, rowid DESC');
  return rows.map(mapConversion);
}

function checkedConversionPreview<T>(calculate: () => T): T {
  try { return calculate(); }
  catch (error) {
    throw new ConversionError('INVALID_INPUT', error instanceof Error ? error.message : 'Geçersiz işlem tutarı.', error);
  }
}

function sqliteFailureKind(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/SQLITE_BUSY|database is locked|database table is locked/i.test(message)) return 'BUSY';
  if (/SQLITE_CONSTRAINT|constraint failed|FOREIGN KEY constraint/i.test(message)) return 'CONSTRAINT';
  if (/SQLITE_IOERR|disk I\/O error/i.test(message)) return 'IO';
  if (/SQLITE_CORRUPT|database disk image is malformed/i.test(message)) return 'CORRUPT';
  return 'UNKNOWN';
}

async function withConversionTransaction(
  db: SQLiteDatabase,
  work: (txn: SQLiteDatabase) => Promise<void>,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await withRepositoryWrite(db, () => db.withTransactionAsync(() => work(db)));
      return;
    } catch (error) {
      if (attempt === 2 || sqliteFailureKind(error) !== 'BUSY') throw error;
      await new Promise((resolve) => setTimeout(resolve, 30 * (attempt + 1)));
    }
  }
}

function conversionStorageError(error: unknown, operation: 'FX' | 'GOLD', stage: string): ConversionError {
  return error instanceof ConversionError ? error
    : new ConversionError('STORAGE_ERROR', 'İşlem veritabanına kaydedilemedi. Lütfen tekrar deneyin.',
      error, `${operation}_${stage}_${sqliteFailureKind(error)}`);
}

export async function recordFxExchange(
  db: SQLiteDatabase,
  input: {
    requestId: string;
    sourceAccountId: string; targetAccountId: string; sourceAmountMinor: number;
    netTryMinor: number; feeTryMinor: number;
  },
): Promise<AssetConversion> {
  const preview = checkedConversionPreview(() => previewFxConversion(
    input.sourceAmountMinor, input.netTryMinor, input.feeTryMinor,
  ));
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId)) {
    throw new ConversionError('INVALID_INPUT', 'Geçersiz işlem kimliği.');
  }
  let result: AssetConversion | undefined;
  let stage = 'BEGIN';
  try { await withConversionTransaction(db, async (txn) => {
    stage = 'REQUEST_LOOKUP';
    const existing = await txn.getFirstAsync<ConversionRow>(
      'SELECT * FROM asset_conversions WHERE client_request_id = ?', input.requestId,
    );
    if (existing) {
      if (existing.kind !== 'fx_exchange' || existing.source_account_id !== input.sourceAccountId
        || existing.target_account_id !== input.targetAccountId
        || existing.source_amount_minor !== input.sourceAmountMinor
        || existing.net_try_minor !== preview.netTryMinor || existing.fee_try_minor !== preview.feeTryMinor) {
        throw new ConversionError('REQUEST_CONFLICT', 'İşlem kimliği farklı bir kayıt için kullanılmış.');
      }
      result = mapConversion(existing);
      return;
    }
    stage = 'SOURCE_LOOKUP';
    const source = await txn.getFirstAsync<AccountBalanceRow>(
      'SELECT id, currency, purpose, balance_minor, balance_date, balance_recorded_at, remaining_flexible_minor FROM accounts WHERE id = ?', input.sourceAccountId,
    );
    stage = 'TARGET_LOOKUP';
    const target = await txn.getFirstAsync<AccountBalanceRow>(
      'SELECT id, currency, purpose, balance_minor, balance_date, balance_recorded_at, remaining_flexible_minor FROM accounts WHERE id = ?', input.targetAccountId,
    );
    if (!source || !['USD', 'EUR'].includes(source.currency)) {
      throw new ConversionError('SOURCE_MISSING', 'Döviz hesabı bulunamadı.');
    }
    if (source.balance_minor < input.sourceAmountMinor) {
      throw new ConversionError('INSUFFICIENT_SOURCE', 'Döviz bakiyesi yetersiz.');
    }
    if (!target || target.currency !== 'TRY' || target.purpose !== 'spending') {
      throw new ConversionError('TARGET_INVALID', 'TL kullanım hesabı seçin.');
    }
    const now = new Date();
    const today = localDateString(now);
    if (source.balance_date !== today || target.balance_date !== today) {
      throw new ConversionError('BALANCE_OUTDATED', 'İşlemden önce döviz ve TL hesap bakiyelerini bugün güncelleyin.');
    }
    if (!source.balance_recorded_at || !target.balance_recorded_at) {
      throw new ConversionError('BALANCE_UNVERIFIED', 'Bakiye gözlem zamanı eksik. Hesaplar bölümünde bugünkü bakiyeyi yeniden kaydedin.');
    }
    const targetAfter = target.balance_minor + preview.netTryMinor;
    if (!Number.isSafeInteger(targetAfter)) throw new ConversionError('BALANCE_OVERFLOW', 'TL bakiyesi aralık dışında.');
    const sourceAfter = source.balance_minor - input.sourceAmountMinor;
    if (!Number.isSafeInteger(sourceAfter)) throw new ConversionError('BALANCE_OVERFLOW', 'Döviz bakiyesi aralık dışında.');
    const occurredAt = now.toISOString();
    const id = Crypto.randomUUID();
    stage = 'SOURCE_UPDATE';
    await txn.runAsync('UPDATE accounts SET balance_minor = ?, balance_date = ? WHERE id = ?', sourceAfter, today, source.id);
    stage = 'TARGET_UPDATE';
    await txn.runAsync('UPDATE accounts SET balance_minor = ?, balance_date = ? WHERE id = ?', targetAfter, today, target.id);
    stage = 'SOURCE_SNAPSHOT';
    await txn.runAsync(
      `INSERT INTO balance_snapshots
        (id, account_id, observed_on, actual_minor, remaining_flexible_minor, kind)
       VALUES (?, ?, ?, ?, ?, 'conversion')`,
      Crypto.randomUUID(), source.id, today, sourceAfter, source.remaining_flexible_minor,
    );
    stage = 'TARGET_SNAPSHOT';
    await txn.runAsync(
      `INSERT INTO balance_snapshots
        (id, account_id, observed_on, actual_minor, remaining_flexible_minor, kind)
       VALUES (?, ?, ?, ?, ?, 'conversion')`,
      Crypto.randomUUID(), target.id, today, targetAfter, target.remaining_flexible_minor,
    );
    stage = 'CONVERSION_INSERT';
    await txn.runAsync(
      `INSERT INTO asset_conversions
        (id, client_request_id, kind, source_account_id, target_account_id, source_code, source_amount_minor,
         gross_try_minor, fee_try_minor, net_try_minor, realized_price_try_micros, occurred_at)
       VALUES (?, ?, 'fx_exchange', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, input.requestId, source.id, target.id, source.currency, input.sourceAmountMinor,
      preview.grossTryMinor, preview.feeTryMinor, preview.netTryMinor, preview.realizedPriceTryMicros, occurredAt,
    );
    result = {
      id, requestId: input.requestId, kind: 'fx_exchange', sourceAccountId: source.id, goldHoldingId: null,
      targetAccountId: target.id, sourceCode: source.currency as 'USD' | 'EUR',
      sourceAmountMinor: input.sourceAmountMinor, quantityMicros: null,
      ...preview, occurredAt,
    };
    stage = 'COMMIT';
  }); } catch (error) { throw conversionStorageError(error, 'FX', stage); }
  if (!result) throw new ConversionError('STORAGE_ERROR', 'Döviz işlemi kaydedilemedi.');
  return result;
}

export async function recordGoldSale(
  db: SQLiteDatabase,
  input: {
    requestId: string;
    goldHoldingId: string; targetAccountId: string; quantityMicros: number;
    netTryMinor: number; feeTryMinor: number;
  },
): Promise<AssetConversion> {
  const preview = checkedConversionPreview(() => previewGoldConversion(
    input.quantityMicros, input.netTryMinor, input.feeTryMinor,
  ));
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId)) {
    throw new ConversionError('INVALID_INPUT', 'Geçersiz işlem kimliği.');
  }
  let result: AssetConversion | undefined;
  let stage = 'BEGIN';
  try { await withConversionTransaction(db, async (txn) => {
    stage = 'REQUEST_LOOKUP';
    const existing = await txn.getFirstAsync<ConversionRow>(
      'SELECT * FROM asset_conversions WHERE client_request_id = ?', input.requestId,
    );
    if (existing) {
      if (existing.kind !== 'gold_sale' || existing.gold_holding_id !== input.goldHoldingId
        || existing.target_account_id !== input.targetAccountId
        || existing.quantity_micros !== input.quantityMicros
        || existing.net_try_minor !== preview.netTryMinor || existing.fee_try_minor !== preview.feeTryMinor) {
        throw new ConversionError('REQUEST_CONFLICT', 'İşlem kimliği farklı bir kayıt için kullanılmış.');
      }
      result = mapConversion(existing);
      return;
    }
    stage = 'SOURCE_LOOKUP';
    const source = await txn.getFirstAsync<GoldRow>(
      'SELECT id, name, quantity_micros FROM gold_holdings WHERE id = ?', input.goldHoldingId,
    );
    stage = 'TARGET_LOOKUP';
    const target = await txn.getFirstAsync<AccountBalanceRow>(
      'SELECT id, currency, purpose, balance_minor, balance_date, balance_recorded_at, remaining_flexible_minor FROM accounts WHERE id = ?', input.targetAccountId,
    );
    if (!source) {
      throw new ConversionError('SOURCE_MISSING', 'Gram altın kaydı bulunamadı.');
    }
    if (source.quantity_micros < input.quantityMicros) {
      throw new ConversionError('INSUFFICIENT_SOURCE', 'Gram altın miktarı yetersiz.');
    }
    if (!target || target.currency !== 'TRY' || target.purpose !== 'spending') {
      throw new ConversionError('TARGET_INVALID', 'TL kullanım hesabı seçin.');
    }
    const now = new Date();
    const today = localDateString(now);
    if (target.balance_date !== today) {
      throw new ConversionError('BALANCE_OUTDATED', 'İşlemden önce TL hesap bakiyesini bugün güncelleyin.');
    }
    if (!target.balance_recorded_at) {
      throw new ConversionError('BALANCE_UNVERIFIED', 'TL hesabının bakiye gözlem zamanı eksik. Hesaplar bölümünde bugünkü bakiyeyi yeniden kaydedin.');
    }
    const targetAfter = target.balance_minor + preview.netTryMinor;
    if (!Number.isSafeInteger(targetAfter)) throw new ConversionError('BALANCE_OVERFLOW', 'TL bakiyesi aralık dışında.');
    const sourceAfter = source.quantity_micros - input.quantityMicros;
    if (!Number.isSafeInteger(sourceAfter)) throw new ConversionError('BALANCE_OVERFLOW', 'Altın miktarı aralık dışında.');
    const occurredAt = now.toISOString();
    const id = Crypto.randomUUID();
    stage = 'SOURCE_UPDATE';
    await txn.runAsync('UPDATE gold_holdings SET quantity_micros = ?, updated_at = ? WHERE id = ?',
      sourceAfter, occurredAt, source.id);
    stage = 'TARGET_UPDATE';
    await txn.runAsync('UPDATE accounts SET balance_minor = ?, balance_date = ? WHERE id = ?', targetAfter, today, target.id);
    stage = 'TARGET_SNAPSHOT';
    await txn.runAsync(
      `INSERT INTO balance_snapshots
        (id, account_id, observed_on, actual_minor, remaining_flexible_minor, kind)
       VALUES (?, ?, ?, ?, ?, 'conversion')`,
      Crypto.randomUUID(), target.id, today, targetAfter, target.remaining_flexible_minor,
    );
    stage = 'CONVERSION_INSERT';
    await txn.runAsync(
      `INSERT INTO asset_conversions
        (id, client_request_id, kind, gold_holding_id, target_account_id, source_code, quantity_micros,
         gross_try_minor, fee_try_minor, net_try_minor, realized_price_try_micros, occurred_at)
       VALUES (?, ?, 'gold_sale', ?, ?, 'XAU_GRAM', ?, ?, ?, ?, ?, ?)`,
      id, input.requestId, source.id, target.id, input.quantityMicros,
      preview.grossTryMinor, preview.feeTryMinor, preview.netTryMinor, preview.realizedPriceTryMicros, occurredAt,
    );
    result = {
      id, requestId: input.requestId, kind: 'gold_sale', sourceAccountId: null, goldHoldingId: source.id,
      targetAccountId: target.id, sourceCode: 'XAU_GRAM',
      sourceAmountMinor: null, quantityMicros: input.quantityMicros,
      ...preview, occurredAt,
    };
    stage = 'COMMIT';
  }); } catch (error) { throw conversionStorageError(error, 'GOLD', stage); }
  if (!result) throw new ConversionError('STORAGE_ERROR', 'Altın işlemi kaydedilemedi.');
  return result;
}

export type DeletionErrorCode = 'NOT_FOUND' | 'DEPENDENCY_BLOCKED' | 'UNSAFE_REVERSAL';

export class DeletionError extends Error {
  readonly code: DeletionErrorCode;

  constructor(code: DeletionErrorCode, message: string) {
    super(message);
    this.name = 'DeletionError';
    this.code = code;
  }
}

function missingRecord(): never {
  throw new DeletionError('NOT_FOUND', 'Kayıt bulunamadı. Listeyi yenileyip tekrar deneyin.');
}

function dependentRecord(message: string): never {
  throw new DeletionError('DEPENDENCY_BLOCKED', message);
}

function unsafeReversal(message: string): never {
  throw new DeletionError('UNSAFE_REVERSAL', message);
}

async function deleteSimpleRecord(
  db: SQLiteDatabase, table: 'monthly_plans' | 'flexible_monthly_plans' | 'one_time_plans'
    | 'card_statements' | 'installment_plans', id: string,
): Promise<void> {
  const result = await serializedRunAsync(db, `DELETE FROM ${table} WHERE id = ?`, id);
  if (result.changes === 0) missingRecord();
}

export async function deletePlan(db: SQLiteDatabase, id: string): Promise<void> {
  await deletePlanWithExpenseGuard(db, 'monthly_plans', 'regular', id);
}

export async function deleteFlexiblePlan(db: SQLiteDatabase, id: string): Promise<void> {
  await deletePlanWithExpenseGuard(db, 'flexible_monthly_plans', 'flexible', id);
}

export async function deleteOneTimePlan(db: SQLiteDatabase, id: string): Promise<void> {
  await deletePlanWithExpenseGuard(db, 'one_time_plans', 'one_time', id);
}

async function deletePlanWithExpenseGuard(
  db: SQLiteDatabase, table: 'monthly_plans' | 'flexible_monthly_plans' | 'one_time_plans',
  planType: 'regular' | 'flexible' | 'one_time', id: string,
): Promise<void> {
  await withRepositoryWrite(db, () => db.withTransactionAsync(async () => {
    const linked = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM actual_expenses WHERE plan_type = ? AND plan_id = ? LIMIT 1', planType, id,
    );
    if (linked) dependentRecord('Plana bağlı gerçek harcama var. Önce harcama kaydını güvenle geri alın.');
    const result = await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, id);
    if (result.changes === 0) missingRecord();
  }));
}

export async function deleteCardStatement(db: SQLiteDatabase, id: string): Promise<void> {
  // Payment status changes projections only; no account balance is directly debited.
  await deleteSimpleRecord(db, 'card_statements', id);
}

export async function deleteInstallmentPlan(db: SQLiteDatabase, id: string): Promise<void> {
  await deleteSimpleRecord(db, 'installment_plans', id);
}

export async function deleteCreditCard(db: SQLiteDatabase, id: string): Promise<void> {
  await withRepositoryWrite(db, () => db.withTransactionAsync(async () => {
    const card = await db.getFirstAsync<{ id: string }>('SELECT id FROM credit_cards WHERE id = ?', id);
    if (!card) missingRecord();
    const child = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM card_statements WHERE card_id = ?
       UNION ALL SELECT id FROM installment_plans WHERE card_id = ? LIMIT 1`, id, id,
    );
    if (child) dependentRecord('Kartın ekstre veya taksit kayıtları var. Önce bu kayıtları silin.');
    await db.runAsync('DELETE FROM credit_cards WHERE id = ?', id);
  }));
}

export async function deleteGoldHolding(db: SQLiteDatabase, id: string): Promise<void> {
  await withRepositoryWrite(db, () => db.withTransactionAsync(async () => {
    const holding = await db.getFirstAsync<{ id: string }>('SELECT id FROM gold_holdings WHERE id = ?', id);
    if (!holding) missingRecord();
    const conversion = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM asset_conversions WHERE gold_holding_id = ? LIMIT 1', id,
    );
    if (conversion) dependentRecord('Altın kaydına bağlı satış var. Önce satış geçmişini güvenle geri alın.');
    await db.runAsync('DELETE FROM gold_holdings WHERE id = ?', id);
  }));
}

export async function deleteAccount(db: SQLiteDatabase, id: string): Promise<void> {
  await withRepositoryWrite(db, () => db.withTransactionAsync(async () => {
    const account = await db.getFirstAsync<{ id: string }>('SELECT id FROM accounts WHERE id = ?', id);
    if (!account) missingRecord();
    const dependencies = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM monthly_plans WHERE account_id = ?
       UNION ALL SELECT id FROM flexible_monthly_plans WHERE account_id = ?
       UNION ALL SELECT id FROM one_time_plans WHERE account_id = ?
       UNION ALL SELECT id FROM credit_cards WHERE payment_account_id = ?
       UNION ALL SELECT id FROM card_statements WHERE payment_account_id = ?
       UNION ALL SELECT id FROM actual_expenses WHERE account_id = ?
       UNION ALL SELECT id FROM asset_conversions WHERE source_account_id = ? OR target_account_id = ?
       LIMIT 1`, id, id, id, id, id, id, id, id,
    );
    if (dependencies) dependentRecord('Hesaba bağlı plan, harcama, kart, ekstre veya dönüşüm var. Önce bağlı kayıtları silin.');
    // The account's observed balance history belongs to it and cascades with the account.
    await db.runAsync('DELETE FROM accounts WHERE id = ?', id);
  }));
}

interface ReversalSnapshotRow extends SnapshotRow {
  rowid: number;
  created_at: string;
}

function snapshotRecordedAt(createdAt: string): string {
  return createdAt.includes('T') ? createdAt : `${createdAt.replace(' ', 'T')}.000Z`;
}

export async function deleteLatestObservedSnapshot(db: SQLiteDatabase, snapshotId: string): Promise<void> {
  await withRepositoryWrite(db, () => db.withTransactionAsync(async () => {
    const requested = await db.getFirstAsync<{ account_id: string; kind: string }>(
      'SELECT account_id, kind FROM balance_snapshots WHERE id = ?', snapshotId,
    );
    if (!requested) missingRecord();
    if (requested.kind !== 'observed') unsafeReversal('Dönüşüm bakiyesi bu ekrandan silinemez. Satış geçmişini kullanın.');
    const snapshots = await db.getAllAsync<ReversalSnapshotRow>(
      'SELECT rowid, * FROM balance_snapshots WHERE account_id = ? ORDER BY rowid DESC LIMIT 2', requested.account_id,
    );
    const [latest, previous] = snapshots;
    if (!latest || latest.id !== snapshotId || !previous || previous.kind !== 'observed') {
      unsafeReversal('Yalnız son bakiye gözlemi, önceki gözlemle arasında dönüşüm yoksa geri alınabilir.');
    }
    const account = await db.getFirstAsync<AccountBalanceRow>(
      'SELECT id, currency, purpose, balance_minor, balance_date, balance_recorded_at, remaining_flexible_minor FROM accounts WHERE id = ?', requested.account_id,
    );
    if (!account || account.balance_minor !== latest.actual_minor || account.balance_date !== latest.observed_on) {
      unsafeReversal('Hesap bakiyesi son gözlemle eşleşmiyor. Önce kayıtları kontrol edin.');
    }
    await db.runAsync(
      `UPDATE accounts SET balance_minor = ?, balance_date = ?, balance_recorded_at = ?,
       remaining_flexible_minor = ? WHERE id = ?`,
      previous.actual_minor, previous.observed_on, snapshotRecordedAt(previous.created_at),
      previous.remaining_flexible_minor, account.id,
    );
    await db.runAsync('DELETE FROM balance_snapshots WHERE id = ?', snapshotId);
  }));
}

async function latestConversionSnapshot(
  db: SQLiteDatabase, accountId: string, currentMinor: number, previousMinor: number,
): Promise<ReversalSnapshotRow> {
  const rows = await db.getAllAsync<ReversalSnapshotRow>(
    'SELECT rowid, * FROM balance_snapshots WHERE account_id = ? ORDER BY rowid DESC LIMIT 2', accountId,
  );
  if (rows.length < 2 || rows[0].kind !== 'conversion'
    || rows[0].actual_minor !== currentMinor || rows[1].actual_minor !== previousMinor) {
    unsafeReversal('Dönüşümden sonra bakiye güncellenmiş veya başka işlem yapılmış. Önce bakiyeleri kontrol edin.');
  }
  return rows[0];
}

export async function deleteAssetConversion(db: SQLiteDatabase, id: string): Promise<void> {
  await withRepositoryWrite(db, () => db.withTransactionAsync(async () => {
    const conversion = await db.getFirstAsync<ConversionRow & { sequence: number }>(
      'SELECT rowid AS sequence, * FROM asset_conversions WHERE id = ?', id,
    );
    if (!conversion) missingRecord();
    const later = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM asset_conversions WHERE rowid > ? AND
       (source_account_id = ? OR source_account_id = ? OR target_account_id = ?
        OR target_account_id = ? OR gold_holding_id = ?) LIMIT 1`,
      conversion.sequence, conversion.source_account_id, conversion.target_account_id,
      conversion.source_account_id, conversion.target_account_id, conversion.gold_holding_id,
    );
    if (later) unsafeReversal('Bu kaynaktan veya TL hesabından daha sonra başka dönüşüm yapılmış. Önce son işlemi geri alın.');
    const target = await db.getFirstAsync<AccountBalanceRow>(
      'SELECT id, currency, purpose, balance_minor, balance_date, balance_recorded_at, remaining_flexible_minor FROM accounts WHERE id = ?',
      conversion.target_account_id,
    );
    if (!target) unsafeReversal('TL hesabı bulunamadı; dönüşüm güvenle geri alınamıyor.');
    const targetBefore = target.balance_minor - conversion.net_try_minor;
    if (!Number.isSafeInteger(targetBefore)) unsafeReversal('TL bakiyesi geri alma aralığı dışında.');
    const targetSnapshot = await latestConversionSnapshot(db, target.id, target.balance_minor, targetBefore);
    let sourceSnapshot: ReversalSnapshotRow | null = null;
    let source: AccountBalanceRow | null = null;
    let sourceBefore = 0;
    let holding: (GoldRow & { updated_at: string; created_at: string }) | null = null;
    if (conversion.kind === 'fx_exchange') {
      source = await db.getFirstAsync<AccountBalanceRow>(
        'SELECT id, currency, purpose, balance_minor, balance_date, balance_recorded_at, remaining_flexible_minor FROM accounts WHERE id = ?',
        conversion.source_account_id,
      );
      if (!source || conversion.source_amount_minor == null) unsafeReversal('Döviz hesabı bulunamadı; dönüşüm güvenle geri alınamıyor.');
      sourceBefore = source.balance_minor + conversion.source_amount_minor;
      if (!Number.isSafeInteger(sourceBefore)) unsafeReversal('Döviz bakiyesi geri alma aralığı dışında.');
      sourceSnapshot = await latestConversionSnapshot(db, source.id, source.balance_minor, sourceBefore);
    } else {
      holding = await db.getFirstAsync<GoldRow & { updated_at: string; created_at: string }>(
        'SELECT id, name, quantity_micros, updated_at, created_at FROM gold_holdings WHERE id = ?',
        conversion.gold_holding_id,
      );
      if (!holding || conversion.quantity_micros == null || holding.updated_at !== conversion.occurred_at
        || !Number.isSafeInteger(holding.quantity_micros + conversion.quantity_micros)) {
        unsafeReversal('Altın miktarı son satıştan sonra değişmiş. Satış güvenle geri alınamıyor.');
      }
    }
    await db.runAsync('UPDATE accounts SET balance_minor = ? WHERE id = ?', targetBefore, target.id);
    await db.runAsync('DELETE FROM balance_snapshots WHERE id = ?', targetSnapshot.id);
    if (source && sourceSnapshot) {
      await db.runAsync('UPDATE accounts SET balance_minor = ? WHERE id = ?', sourceBefore, source.id);
      await db.runAsync('DELETE FROM balance_snapshots WHERE id = ?', sourceSnapshot.id);
    }
    if (holding && conversion.quantity_micros != null) {
      const previousSale = await db.getFirstAsync<{ occurred_at: string }>(
        'SELECT occurred_at FROM asset_conversions WHERE gold_holding_id = ? AND rowid < ? ORDER BY rowid DESC LIMIT 1',
        holding.id, conversion.sequence,
      );
      await db.runAsync('UPDATE gold_holdings SET quantity_micros = ?, updated_at = ? WHERE id = ?',
        holding.quantity_micros + conversion.quantity_micros,
        previousSale?.occurred_at ?? holding.created_at, holding.id);
    }
    await db.runAsync('DELETE FROM asset_conversions WHERE id = ?', id);
  }));
}

function validCategoryName(name: string): string {
  const clean = name.trim();
  if (!clean || clean.length > 80) throw new Error('Kategori adı 1–80 karakter olmalı.');
  return clean;
}

export async function listCategories(db: SQLiteDatabase): Promise<Category[]> {
  const rows = await db.getAllAsync<CategoryRow>('SELECT id, name, created_at FROM categories ORDER BY name COLLATE NOCASE, id');
  return rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at }));
}

export async function createCategory(db: SQLiteDatabase, input: { name: string }): Promise<Category> {
  const name = validCategoryName(input.name);
  const category = { id: Crypto.randomUUID(), name, createdAt: new Date().toISOString() };
  await withRepositoryWrite(db, async () => {
    const duplicate = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM categories WHERE name = ? COLLATE NOCASE', name,
    );
    if (duplicate) throw new Error('Bu kategori zaten kayıtlı.');
    await db.runAsync('INSERT INTO categories (id, name, created_at) VALUES (?, ?, ?)',
      category.id, category.name, category.createdAt);
  });
  return category;
}

export async function renameCategory(db: SQLiteDatabase, id: string, name: string): Promise<void> {
  const clean = validCategoryName(name);
  await withRepositoryWrite(db, async () => {
    const duplicate = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND id <> ?', clean, id,
    );
    if (duplicate) throw new Error('Bu kategori zaten kayıtlı.');
    const result = await db.runAsync('UPDATE categories SET name = ? WHERE id = ?', clean, id);
    if (result.changes === 0) missingRecord();
  });
}

export async function deleteCategory(db: SQLiteDatabase, id: string): Promise<void> {
  await withRepositoryWrite(db, () => db.withTransactionAsync(async () => {
    const category = await db.getFirstAsync<{ id: string }>('SELECT id FROM categories WHERE id = ?', id);
    if (!category) missingRecord();
    // Keep the user's plans and expenses, moving them into the uncategorized group.
    await db.runAsync('UPDATE monthly_plans SET category_id = NULL WHERE category_id = ?', id);
    await db.runAsync('UPDATE flexible_monthly_plans SET category_id = NULL WHERE category_id = ?', id);
    await db.runAsync('UPDATE one_time_plans SET category_id = NULL WHERE category_id = ?', id);
    await db.runAsync('UPDATE actual_expenses SET category_id = NULL WHERE category_id = ?', id);
    await db.runAsync('DELETE FROM categories WHERE id = ?', id);
  }));
}

function validateMonth(month: string): void {
  if (!isMonthPeriod(month)) throw new Error('Ay YYYY-AA biçiminde olmalı.');
}

export async function listActualExpenses(db: SQLiteDatabase, month: string): Promise<ActualExpense[]> {
  validateMonth(month);
  const [year, monthNumber] = month.split('-').map(Number);
  const rows = await db.getAllAsync<ActualExpenseRow>(
    `SELECT id, account_id, category_id, amount_minor, occurred_on, plan_type, plan_id FROM actual_expenses
     WHERE occurred_on BETWEEN ? AND ? ORDER BY occurred_on DESC, rowid DESC`,
    `${month}-01`, monthEnd(year, monthNumber - 1),
  );
  return rows.map((row) => ({
    id: row.id, accountId: row.account_id, categoryId: row.category_id,
    amountMinor: row.amount_minor, occurredOn: row.occurred_on,
    planType: row.plan_type, planId: row.plan_id,
  }));
}

export async function createActualExpense(
  db: SQLiteDatabase,
  input: {
    accountId: string; categoryId?: string | null; amountMinor: number; occurredOn: string;
    planType?: 'regular' | 'flexible' | 'one_time'; planId?: string;
  },
): Promise<void> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0
    || !isDate(input.occurredOn) || input.occurredOn > localDateString()) {
    throw new Error('Gerçek harcama tutarı veya tarihi geçersiz. Tarih bugün ya da öncesi olmalı.');
  }
  if (!!input.planType !== !!input.planId) throw new Error('İlişkili plan türü ve plan birlikte seçilmeli.');
  await withRepositoryWrite(db, () => db.withTransactionAsync(async () => {
    const account = await db.getFirstAsync<AccountBalanceRow>(
      'SELECT id, currency, purpose, balance_minor, balance_date, balance_recorded_at, remaining_flexible_minor FROM accounts WHERE id = ?',
      input.accountId,
    );
    if (!account) throw new Error('Harcama hesabı bulunamadı.');
    if (account.currency !== 'TRY' || account.purpose !== 'spending') {
      throw new Error('Gerçek harcama için TL kullanım hesabı seçin.');
    }
    if (input.occurredOn < account.balance_date) {
      throw new Error('Harcama tarihi son bakiye gözleminden önce olamaz; tutar bakiyede zaten bulunabilir.');
    }
    let categoryId = input.categoryId ?? null;
    const planType = input.planType ?? null;
    const planId = input.planId ?? null;
    if (planType && planId) {
      if (planType === 'regular') {
        const plan = await db.getFirstAsync<PlanRow>('SELECT * FROM monthly_plans WHERE id = ?', planId);
        if (!plan || plan.account_id !== account.id || plan.kind !== 'expense'
          || plan.starts_on > input.occurredOn || (plan.ends_on && plan.ends_on < input.occurredOn)) {
          throw new Error('İlişkili düzenli gider bu hesap ve tarih için geçerli değil.');
        }
        categoryId = plan.category_id;
      } else if (planType === 'flexible') {
        const plan = await db.getFirstAsync<FlexiblePlanRow>('SELECT * FROM flexible_monthly_plans WHERE id = ?', planId);
        if (!plan || plan.account_id !== account.id || plan.starts_on > input.occurredOn
          || (plan.ends_on && plan.ends_on < input.occurredOn)) {
          throw new Error('İlişkili değişken bütçe bu hesap ve tarih için geçerli değil.');
        }
        categoryId = plan.category_id;
      } else {
        const plan = await db.getFirstAsync<OneTimePlanRow>('SELECT * FROM one_time_plans WHERE id = ?', planId);
        if (!plan || plan.account_id !== account.id || plan.kind !== 'expense' || plan.status !== 'planned'
          || plan.due_on.slice(0, 7) !== input.occurredOn.slice(0, 7)) {
          throw new Error('İlişkili tek seferlik gider bu hesap için geçerli değil.');
        }
        categoryId = plan.category_id;
      }
      if (planType !== 'flexible') {
        const duplicate = await db.getFirstAsync<{ id: string }>(
          `SELECT id FROM actual_expenses WHERE plan_type = ? AND plan_id = ?
           AND (? = 'one_time' OR substr(occurred_on, 1, 7) = ?) LIMIT 1`,
          planType, planId, planType, input.occurredOn.slice(0, 7),
        );
        if (duplicate) throw new Error('Bu planın döneminde zaten gerçekleşen gider kaydı var.');
      }
    }
    const balanceAfter = account.balance_minor - input.amountMinor;
    if (!Number.isSafeInteger(balanceAfter)) throw new Error('Harcama sonrası hesap bakiyesi sayı aralığını aşıyor.');
    const remainingBefore = account.remaining_flexible_minor;
    const remainingAfter = planType === 'flexible' && remainingBefore != null
      && input.occurredOn.slice(0, 7) === account.balance_date.slice(0, 7)
      ? Math.max(0, remainingBefore - input.amountMinor) : remainingBefore;
    const id = Crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO actual_expenses
        (id, account_id, category_id, amount_minor, occurred_on, created_at, plan_type, plan_id,
         balance_before_minor, balance_after_minor, remaining_before_minor, remaining_after_minor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, account.id, categoryId, input.amountMinor, input.occurredOn, createdAt, planType, planId,
      account.balance_minor, balanceAfter, remainingBefore, remainingAfter,
    );
    await db.runAsync(
      'UPDATE accounts SET balance_minor = ?, remaining_flexible_minor = ? WHERE id = ?',
      balanceAfter, remainingAfter, account.id,
    );
    await db.runAsync(
      `INSERT INTO balance_snapshots
        (id, account_id, observed_on, actual_minor, remaining_flexible_minor, kind, expense_id, created_at)
       VALUES (?, ?, ?, ?, ?, 'expense', ?, ?)`,
      Crypto.randomUUID(), account.id, input.occurredOn, balanceAfter, remainingAfter, id, createdAt,
    );
  }));
}

export async function deleteActualExpense(db: SQLiteDatabase, id: string): Promise<void> {
  await withRepositoryWrite(db, () => db.withTransactionAsync(async () => {
    const expense = await db.getFirstAsync<ActualExpenseRow>('SELECT * FROM actual_expenses WHERE id = ?', id);
    if (!expense) missingRecord();
    const account = await db.getFirstAsync<AccountBalanceRow>(
      'SELECT id, currency, purpose, balance_minor, balance_date, balance_recorded_at, remaining_flexible_minor FROM accounts WHERE id = ?',
      expense.account_id,
    );
    const latest = await db.getFirstAsync<ReversalSnapshotRow>(
      'SELECT rowid, * FROM balance_snapshots WHERE account_id = ? ORDER BY rowid DESC LIMIT 1', expense.account_id,
    );
    if (!account || !latest || latest.kind !== 'expense' || latest.expense_id !== id
      || account.balance_minor !== expense.balance_after_minor
      || account.remaining_flexible_minor !== expense.remaining_after_minor) {
      unsafeReversal('Bu harcamadan sonra bakiye veya başka işlem güncellenmiş. Önce son hareketi geri alın.');
    }
    await db.runAsync('DELETE FROM balance_snapshots WHERE id = ?', latest.id);
    await db.runAsync('UPDATE accounts SET balance_minor = ?, remaining_flexible_minor = ? WHERE id = ?',
      expense.balance_before_minor, expense.remaining_before_minor, account.id);
    await db.runAsync('DELETE FROM actual_expenses WHERE id = ?', id);
  }));
}

export async function listCategoryMonthlyTotals(
  db: SQLiteDatabase, month: string,
): Promise<CategoryMonthlyTotal[]> {
  validateMonth(month);
  const [year, monthNumber] = month.split('-').map(Number);
  const firstDay = `${month}-01`;
  const lastDay = monthEnd(year, monthNumber - 1);
  const [categories, accounts, regular, flexible, oneTime, actual] = await Promise.all([
    listCategories(db), listAccounts(db), listPlans(db), listFlexiblePlans(db),
    listOneTimePlans(db), listActualExpenses(db, month),
  ]);
  const accountCurrency = new Map(accounts.map((account) => [account.id, account.currency]));
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));
  const totals = new Map<string, CategoryMonthlyTotal>();
  function add(categoryId: string | null | undefined, currency: Currency, field: 'plannedMinor' | 'actualMinor', amount: number): void {
    const id = categoryId ?? null;
    const key = `${currency}\u0000${id ?? ''}`;
    const current = totals.get(key) ?? {
      categoryId: id, categoryName: id ? categoryName.get(id) ?? 'Kategorisiz' : 'Kategorisiz',
      currency, plannedMinor: 0, actualMinor: 0,
    };
    const sum = current[field] + amount;
    if (!Number.isSafeInteger(sum)) throw new Error('Kategori toplamı sayı aralığını aşıyor.');
    current[field] = sum;
    totals.set(key, current);
  }
  for (const plan of regular) {
    if (plan.kind !== 'expense') continue;
    const currency = accountCurrency.get(plan.accountId);
    if (!currency) continue;
    const due = `${month}-${String(Math.min(plan.dueDay, Number(lastDay.slice(-2)))).padStart(2, '0')}`;
    if (plan.startsOn <= due && (!plan.endsOn || plan.endsOn >= due)) {
      add(plan.categoryId, currency, 'plannedMinor', plan.amountMinor);
    }
  }
  for (const plan of flexible) {
    const currency = accountCurrency.get(plan.accountId);
    if (currency && plan.startsOn <= firstDay && (!plan.endsOn || plan.endsOn >= lastDay)) {
      add(plan.categoryId, currency, 'plannedMinor', plan.amountMinor);
    }
  }
  for (const plan of oneTime) {
    const currency = accountCurrency.get(plan.accountId);
    if (currency && plan.kind === 'expense' && plan.status === 'planned'
      && plan.dueOn >= firstDay && plan.dueOn <= lastDay) {
      add(plan.categoryId, currency, 'plannedMinor', plan.amountMinor);
    }
  }
  for (const expense of actual) {
    const currency = accountCurrency.get(expense.accountId);
    if (currency) add(expense.categoryId, currency, 'actualMinor', expense.amountMinor);
  }
  return [...totals.values()].sort((a, b) =>
    a.currency.localeCompare(b.currency) || a.categoryName.localeCompare(b.categoryName, 'tr')
    || (a.categoryId ?? '').localeCompare(b.categoryId ?? ''));
}
