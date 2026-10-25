import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { migrateDatabase } from './database.ts';

// Expo Crypto is native; keep the repository SQL under test and replace only UUID generation.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'expo-crypto') {
      return { url: 'data:text/javascript,export%20const%20randomUUID%3D()%3D%3EglobalThis.crypto.randomUUID()', shortCircuit: true };
    }
    if (specifier.startsWith('../domain/') && !specifier.endsWith('.ts')) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { listAssetConversions, listOneTimePlans, createOneTimePlan, cancelOneTimePlan,
  listAccounts, updateBalance, recordFxExchange, recordGoldSale, savePriceQuotes,
  createPlan, stopPlan, listPlans, createFlexiblePlan, stopFlexiblePlan, listFlexiblePlans,
  deleteAccount, deletePlan, deleteFlexiblePlan, deleteOneTimePlan, deleteCreditCard,
  deleteCardStatement, deleteInstallmentPlan, deleteGoldHolding, deleteAssetConversion,
  listSnapshots, latestSnapshot, deleteLatestObservedSnapshot,
  createCategory, listCategories, renameCategory, deleteCategory,
  createActualExpense, listActualExpenses, deleteActualExpense, listCategoryMonthlyTotals,
  recordTryTransfer, deleteTryTransfer, recordCardStatementPayment, deleteCardStatementPayment,
  listCardStatements,
} = await import('./repository.ts');
const { localDateString, monthEnd, projectAccountBalance } = await import('../domain/finance.ts');

function adapter(sqlite) {
  const db = {
    execAsync: async (sql) => sqlite.exec(sql),
    getFirstAsync: async (sql, ...params) => sqlite.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql, ...params) => sqlite.prepare(sql).all(...params),
    runAsync: async (sql, ...params) => sqlite.prepare(sql).run(...params),
    withTransactionAsync: async (work) => {
      sqlite.exec('BEGIN');
      try { await work(); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    withExclusiveTransactionAsync: async (work) => {
      sqlite.exec('BEGIN IMMEDIATE');
      try { await work(db); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return db;
}

async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  const db = adapter(sqlite);
  await migrateDatabase(db);
  const observedOn = localDateString();
  const recordedAt = new Date(Date.now() - 60000).toISOString();
  sqlite.prepare(`INSERT INTO accounts
    (id, name, currency, purpose, balance_minor, balance_date, balance_recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run('usd', 'Dolar', 'USD', 'savings', 10000, observedOn, recordedAt);
  sqlite.prepare(`INSERT INTO accounts
    (id, name, currency, purpose, balance_minor, balance_date, balance_recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run('try', 'Banka', 'TRY', 'spending', 100000, observedOn, recordedAt);
  sqlite.exec("INSERT INTO gold_holdings (id, name, quantity_micros) VALUES ('gold', 'Gram altın', 5000000)");
  return { sqlite, db };
}

test('TL aktarımı iki bakiyeyi bir kez değiştirir ve son işlemse geri alınır', async () => {
  const { sqlite, db } = await fixture();
  try {
    sqlite.prepare(`INSERT INTO accounts
      (id, name, currency, purpose, balance_minor, balance_date, balance_recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run('try2', 'İkinci banka', 'TRY', 'spending', 20000,
      localDateString(), new Date().toISOString());
    const input = { sourceAccountId: 'try', targetAccountId: 'try2', amountMinor: 30000,
      requestId: 'transfer-request-0001' };
    const first = await recordTryTransfer(db, input);
    assert.equal((await recordTryTransfer(db, input)).id, first.id);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'try'").get().balance_minor, 70000);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'try2'").get().balance_minor, 50000);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM try_transfers').get().count, 1);
    await assert.rejects(recordTryTransfer(db, { ...input, requestId: 'transfer-request-0002', amountMinor: 70001 }));
    await assert.rejects(recordTryTransfer(db, { ...input, amountMinor: 10000 }));
    await deleteTryTransfer(db, first.id);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'try'").get().balance_minor, 100000);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'try2'").get().balance_minor, 20000);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM balance_snapshots WHERE kind = \'transfer\'').get().count, 0);
  } finally {
    sqlite.close();
  }
});

test('ekstreye birden çok kısmi ödeme borcu azaltır; fazla ödeme reddedilir', async () => {
  const { sqlite, db } = await fixture();
  try {
    sqlite.exec(`INSERT INTO credit_cards
      (id, name, payment_account_id, closing_day, payment_day, starts_on)
      VALUES ('card', 'Kart', 'try', 15, 25, '2026-10-01');
      INSERT INTO card_statements
      (id, card_id, statement_period, due_date, actual_amount_minor, planned_payment_minor, payment_account_id)
      VALUES ('statement', 'card', '2026-10', '2026-10-25', 10000, 10000, 'try')`);
    const first = await recordCardStatementPayment(db,
      { statementId: 'statement', amountMinor: 3000, paidOn: localDateString() });
    await recordCardStatementPayment(db,
      { statementId: 'statement', amountMinor: 2000, paidOn: localDateString() });
    let statement = (await listCardStatements(db))[0];
    assert.equal(statement.paidTotalMinor, 5000);
    assert.equal(statement.remainingDebtMinor, 5000);
    assert.equal(statement.status, 'planned');
    await assert.rejects(recordCardStatementPayment(db,
      { statementId: 'statement', amountMinor: 5001, paidOn: localDateString() }));
    await recordCardStatementPayment(db,
      { statementId: 'statement', amountMinor: 5000, paidOn: localDateString() });
    statement = (await listCardStatements(db))[0];
    assert.equal(statement.remainingDebtMinor, 0);
    assert.equal(statement.status, 'paid');
    await deleteCardStatementPayment(db, first.id);
    statement = (await listCardStatements(db))[0];
    assert.equal(statement.paidTotalMinor, 7000);
    assert.equal(statement.remainingDebtMinor, 3000);
    assert.equal(statement.status, 'planned');
  } finally {
    sqlite.close();
  }
});

test('döviz bozdurma iki bakiyeyi atomik değiştirir; tekrar gönderim ve yetersiz bakiye ikinci etki yaratmaz', async () => {
  const { sqlite, db } = await fixture();
  try {
    const input = {
      requestId: 'fx-request-0001', sourceAccountId: 'usd', targetAccountId: 'try',
      sourceAmountMinor: 2500, netTryMinor: 120000, feeTryMinor: 500,
    };
    const first = await recordFxExchange(db, input);
    assert.equal(first.realizedPriceTryMicros, 48200000);
    assert.equal(first.grossTryMinor, 120500);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'usd'").get().balance_minor, 7500);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'try'").get().balance_minor, 220000);
    const planCreatedAt = new Date().toISOString();
    sqlite.prepare(`INSERT INTO one_time_plans
      (id, account_id, title, kind, amount_minor, due_on, created_at, updated_at)
      VALUES ('repair', 'try', 'Tamir', 'expense', 10000, ?, ?, ?)`).run(
      localDateString(), planCreatedAt, planCreatedAt,
    );
    const target = (await listAccounts(db)).find((account) => account.id === 'try');
    const oneTimePlans = await listOneTimePlans(db);
    assert.equal(projectAccountBalance(target, [], localDateString(), [], [], [], [], oneTimePlans), 210000);
    const snapshot = await updateBalance(db, target, 210000);
    assert.equal(snapshot.expectedMinor, 210000);
    assert.equal(snapshot.differenceMinor, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM balance_snapshots WHERE kind = 'conversion'").get().count, 2);
    const afterSnapshot = (await listAccounts(db)).find((account) => account.id === 'try');
    assert.equal(projectAccountBalance(afterSnapshot, [], '2099-11-30', [], [], [], [], oneTimePlans), 210000);
    const retry = await recordFxExchange(db, input);
    assert.equal(retry.id, first.id);
    assert.equal((await listAssetConversions(db)).length, 1);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'try'").get().balance_minor, 210000);
    await assert.rejects(recordFxExchange(db, { ...input, requestId: 'fx-request-0002', sourceAmountMinor: 7501 }),
      (error) => error.code === 'INSUFFICIENT_SOURCE');
    await assert.rejects(recordFxExchange(db, { ...input, netTryMinor: 120001 }),
      (error) => error.code === 'REQUEST_CONFLICT');
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'usd'").get().balance_minor, 7500);
  } finally {
    sqlite.close();
  }
});

test('altın satışı gramı azaltır, net TL ekler; kayıt hatasında iki bakiye geri alınır', async () => {
  const { sqlite, db } = await fixture();
  try {
    const input = {
      requestId: 'gold-request-0001', goldHoldingId: 'gold', targetAccountId: 'try',
      quantityMicros: 2500000, netTryMinor: 1200000, feeTryMinor: 10000,
    };
    const first = await recordGoldSale(db, input);
    assert.equal(first.realizedPriceTryMicros, 4840000000);
    assert.equal(sqlite.prepare("SELECT quantity_micros FROM gold_holdings WHERE id = 'gold'").get().quantity_micros, 2500000);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'try'").get().balance_minor, 1300000);
    assert.equal((await recordGoldSale(db, input)).id, first.id);
    await assert.rejects(recordGoldSale(db, { ...input, requestId: 'gold-request-0003', quantityMicros: 2500001 }),
      (error) => error.code === 'INSUFFICIENT_SOURCE');
    assert.equal(sqlite.prepare("SELECT quantity_micros FROM gold_holdings WHERE id = 'gold'").get().quantity_micros, 2500000);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM balance_snapshots WHERE kind = 'conversion'").get().count, 1);
    sqlite.exec(`CREATE TRIGGER abort_conversion BEFORE INSERT ON asset_conversions
      BEGIN SELECT RAISE(ABORT, 'forced failure'); END;`);
    await assert.rejects(recordGoldSale(db, {
      requestId: 'gold-request-0002', goldHoldingId: 'gold', targetAccountId: 'try',
      quantityMicros: 1000000, netTryMinor: 400000, feeTryMinor: 0,
    }), (error) => error.code === 'STORAGE_ERROR'
      && error.diagnosticCode === 'GOLD_CONVERSION_INSERT_UNKNOWN');
    assert.equal(sqlite.prepare("SELECT quantity_micros FROM gold_holdings WHERE id = 'gold'").get().quantity_micros, 2500000);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'try'").get().balance_minor, 1300000);
  } finally {
    sqlite.close();
  }
});

test('2 gram altın satışı geçici SQLite kilidinden sonra tek kez kaydedilir', async () => {
  const { sqlite, db } = await fixture();
  try {
    let attempts = 0;
    const lockedOnceDb = {
      ...db,
      withExclusiveTransactionAsync: () => { throw new Error('new connection must not be used'); },
      withTransactionAsync: (work) => {
        attempts += 1;
        return db.withTransactionAsync(work);
      },
      runAsync: (sql, ...params) => {
        if (attempts === 1 && sql.startsWith('UPDATE gold_holdings')) {
          throw new Error('SQLITE_BUSY_SNAPSHOT: database is locked');
        }
        return db.runAsync(sql, ...params);
      },
    };
    const input = {
      requestId: 'gold-busy-0001', goldHoldingId: 'gold', targetAccountId: 'try',
      quantityMicros: 2_000_000, netTryMinor: 500_000, feeTryMinor: 10_000,
    };
    const first = await recordGoldSale(lockedOnceDb, input);
    assert.equal(attempts, 2);
    assert.equal(first.realizedPriceTryMicros, 2_550_000_000);
    assert.equal((await recordGoldSale(db, input)).id, first.id);
    assert.equal(sqlite.prepare("SELECT quantity_micros FROM gold_holdings WHERE id = 'gold'").get().quantity_micros, 3_000_000);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'try'").get().balance_minor, 600_000);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM asset_conversions').get().count, 1);
  } finally {
    sqlite.close();
  }
});

test('altın satışı sırasında fiyat önbelleği aynı bağlantıda işlem arasına girmez', async () => {
  const { sqlite, db } = await fixture();
  try {
    let signalStarted;
    let resumeWrite;
    const started = new Promise((resolve) => { signalStarted = resolve; });
    const paused = new Promise((resolve) => { resumeWrite = resolve; });
    const guardedDb = {
      ...db,
      withExclusiveTransactionAsync: () => { throw new Error('new connection must not be used'); },
      runAsync: async (sql, ...params) => {
        if (sql.startsWith('UPDATE gold_holdings')) {
          signalStarted();
          await paused;
        }
        return db.runAsync(sql, ...params);
      },
    };
    const sale = recordGoldSale(guardedDb, {
      requestId: 'gold-quote-0001', goldHoldingId: 'gold', targetAccountId: 'try',
      quantityMicros: 2_000_000, netTryMinor: 500_000, feeTryMinor: 10_000,
    });
    await started;
    const quote = savePriceQuotes(guardedDb, [{
      assetCode: 'XAU_GRAM', priceTryMicros: 2_550_000_000,
      quotedAt: new Date().toISOString(), source: 'test', sourceUrl: 'https://example.test',
      fetchedAt: new Date().toISOString(),
    }]);
    resumeWrite();
    await Promise.all([sale, quote]);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM asset_conversions').get().count, 1);
    assert.equal(sqlite.prepare('SELECT price_try_micros FROM price_quotes').get().price_try_micros, 2_550_000_000);
  } finally {
    sqlite.close();
  }
});

test('eşzamanlı aynı satış isteği yalnız bir kez bakiyeleri değiştirir', async () => {
  const { sqlite, db } = await fixture();
  try {
    const input = {
      requestId: 'gold-parallel-0001', goldHoldingId: 'gold', targetAccountId: 'try',
      quantityMicros: 2_000_000, netTryMinor: 500_000, feeTryMinor: 10_000,
    };
    const [first, second] = await Promise.all([recordGoldSale(db, input), recordGoldSale(db, input)]);
    assert.equal(first.id, second.id);
    assert.equal(sqlite.prepare("SELECT quantity_micros FROM gold_holdings WHERE id = 'gold'").get().quantity_micros, 3_000_000);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'try'").get().balance_minor, 600_000);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM asset_conversions').get().count, 1);
  } finally {
    sqlite.close();
  }
});

test('eski bakiye ve aradaki plan varsa önce gerçek bakiye güncellenir; transfer planı tekrar düşmez', async () => {
  const { sqlite, db } = await fixture();
  try {
    sqlite.exec(`
      UPDATE accounts SET balance_date = '2026-10-01', balance_recorded_at = '2026-10-01T08:00:00Z';
      INSERT INTO one_time_plans
        (id, account_id, title, kind, amount_minor, due_on, created_at, updated_at)
      VALUES ('rent', 'try', 'Kira', 'expense', 10000, '2026-10-10',
        '2026-10-01T09:00:00Z', '2026-10-01T09:00:00Z');
    `);
    const input = {
      requestId: 'fx-request-0003', sourceAccountId: 'usd', targetAccountId: 'try',
      sourceAmountMinor: 2500, netTryMinor: 120000, feeTryMinor: 500,
    };
    await assert.rejects(recordFxExchange(db, input),
      (error) => error.code === 'BALANCE_OUTDATED' && /bugün güncelleyin/.test(error.message));
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'usd'").get().balance_minor, 10000);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'try'").get().balance_minor, 100000);
    const accounts = await listAccounts(db);
    const targetSnapshot = await updateBalance(db, accounts.find((account) => account.id === 'try'), 90000);
    assert.equal(targetSnapshot.expectedMinor, 90000);
    assert.equal(targetSnapshot.differenceMinor, 0);
    await updateBalance(db, accounts.find((account) => account.id === 'usd'), 10000);
    await recordFxExchange(db, input);
    const targetAfter = (await listAccounts(db)).find((account) => account.id === 'try');
    assert.equal(targetAfter.balanceMinor, 210000);
    assert.equal(projectAccountBalance(targetAfter, [], '2099-11-30', [], [], [], [], await listOneTimePlans(db)), 210000);
  } finally {
    sqlite.close();
  }
});

test('eski hesapta eksik gözlem zamanı tamamlanınca satış kilidi açılır', async () => {
  const { sqlite, db } = await fixture();
  try {
    const today = localDateString();
    sqlite.exec('UPDATE accounts SET balance_recorded_at = NULL');
    await assert.rejects(recordFxExchange(db, {
      requestId: 'legacy-before-0001', sourceAccountId: 'usd', targetAccountId: 'try',
      sourceAmountMinor: 1000, netTryMinor: 50000, feeTryMinor: 0,
    }), (error) => error.code === 'BALANCE_UNVERIFIED' && /yeniden kaydedin/.test(error.message));
    sqlite.prepare(`INSERT INTO balance_snapshots
      (id, account_id, observed_on, actual_minor, kind)
      VALUES (?, ?, ?, ?, 'observed')`).run('legacy-usd', 'usd', today, 10000);
    sqlite.prepare(`INSERT INTO balance_snapshots
      (id, account_id, observed_on, actual_minor, kind)
      VALUES (?, ?, ?, ?, 'observed')`).run('legacy-try', 'try', today, 100000);
    sqlite.prepare(`UPDATE accounts SET balance_recorded_at = ? WHERE id IN ('usd', 'try')`)
      .run(new Date().toISOString());
    const accounts = await listAccounts(db);
    assert.ok(accounts.every((account) => account.balanceRecordedAt));
    await recordFxExchange(db, {
      requestId: 'legacy-fx-0001', sourceAccountId: 'usd', targetAccountId: 'try',
      sourceAmountMinor: 1000, netTryMinor: 50000, feeTryMinor: 0,
    });
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'usd'").get().balance_minor, 9000);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'try'").get().balance_minor, 150000);
    await recordGoldSale(db, {
      requestId: 'legacy-gold-0001', goldHoldingId: 'gold', targetAccountId: 'try',
      quantityMicros: 1000000, netTryMinor: 20000, feeTryMinor: 0,
    });
    assert.equal(sqlite.prepare("SELECT quantity_micros FROM gold_holdings WHERE id = 'gold'").get().quantity_micros, 4000000);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'try'").get().balance_minor, 170000);
  } finally {
    sqlite.close();
  }
});

test('tek seferlik plan kaydedilir ve iptal edilir', async () => {
  const { sqlite, db } = await fixture();
  try {
    const dueOn = new Date().toLocaleDateString('sv-SE');
    await createOneTimePlan(db, { accountId: 'try', title: 'Prim', kind: 'income', amountMinor: 10000, dueOn });
    const [plan] = await listOneTimePlans(db);
    assert.equal(plan.amountMinor, 10000);
    await cancelOneTimePlan(db, plan.id);
    assert.equal((await listOneTimePlans(db))[0].status, 'cancelled');
  } finally {
    sqlite.close();
  }
});

test('aylık plan ve değişken bütçe gelecek aylar için ay sonunda durur; tekrar durdurma tarihi değiştirmez', async () => {
  const { sqlite, db } = await fixture();
  try {
    await createPlan(db, { accountId: 'try', title: 'Kira', kind: 'expense', amountMinor: 10000, dueDay: 31 });
    await createFlexiblePlan(db, { accountId: 'try', title: 'Market', amountMinor: 5000 });
    const [plan] = await listPlans(db);
    const [flexible] = await listFlexiblePlans(db);
    const now = new Date();
    const expectedEnd = monthEnd(now.getFullYear(), now.getMonth());
    await Promise.all([stopPlan(db, plan.id), stopFlexiblePlan(db, flexible.id)]);
    assert.equal((await listPlans(db))[0].endsOn, expectedEnd);
    assert.equal((await listFlexiblePlans(db))[0].endsOn, expectedEnd);
    await Promise.all([stopPlan(db, plan.id), stopFlexiblePlan(db, flexible.id)]);
    assert.equal((await listPlans(db))[0].endsOn, expectedEnd);
    assert.equal((await listFlexiblePlans(db))[0].endsOn, expectedEnd);
  } finally {
    sqlite.close();
  }
});

test('bağlı hesap, kart ve altın silinmez; alt kayıtlar ayrı ayrı kaldırılabilir', async () => {
  const { sqlite, db } = await fixture();
  try {
    await createPlan(db, { accountId: 'try', title: 'Kira', kind: 'expense', amountMinor: 10000, dueDay: 1 });
    await createFlexiblePlan(db, { accountId: 'try', title: 'Market', amountMinor: 5000 });
    const planId = (await listPlans(db))[0].id;
    const flexibleId = (await listFlexiblePlans(db))[0].id;
    await assert.rejects(deleteAccount(db, 'try'), (error) => error.code === 'DEPENDENCY_BLOCKED');
    await Promise.all([deletePlan(db, planId), deleteFlexiblePlan(db, flexibleId)]);
    assert.equal((await listPlans(db)).length, 0);
    assert.equal((await listFlexiblePlans(db)).length, 0);
    await createOneTimePlan(db, {
      accountId: 'try', title: 'Tamir', kind: 'expense', amountMinor: 5000, dueOn: localDateString(),
    });
    await deleteOneTimePlan(db, (await listOneTimePlans(db))[0].id);
    sqlite.exec(`
      INSERT INTO credit_cards (id, name, payment_account_id, closing_day, payment_day, starts_on)
      VALUES ('card', 'Kart', 'try', 10, 20, '2026-01-01');
      INSERT INTO card_statements
        (id, card_id, statement_period, due_date, actual_amount_minor, planned_payment_minor, payment_account_id)
      VALUES ('statement', 'card', '2026-10', '2026-10-20', 10000, 10000, 'try');
      INSERT INTO installment_plans (id, card_id, title, total_amount_minor, installment_count, first_statement_period)
      VALUES ('installment', 'card', 'Telefon', 10000, 2, '2026-10');
    `);
    await assert.rejects(deleteCreditCard(db, 'card'), (error) => error.code === 'DEPENDENCY_BLOCKED');
    await deleteCardStatement(db, 'statement');
    await deleteInstallmentPlan(db, 'installment');
    await deleteCreditCard(db, 'card');
    await assert.rejects(deletePlan(db, planId), (error) => error.code === 'NOT_FOUND');
    await deleteAccount(db, 'try');
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM accounts WHERE id = 'try'").get().count, 0);
    await deleteGoldHolding(db, 'gold');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM gold_holdings').get().count, 0);
  } finally {
    sqlite.close();
  }
});

test('son altın satışı silinince TL, gram ve dönüşüm snapshotı atomik geri alınır', async () => {
  const { sqlite, db } = await fixture();
  try {
    sqlite.prepare(`INSERT INTO balance_snapshots (id, account_id, observed_on, actual_minor, kind)
      VALUES ('initial-try', 'try', ?, 100000, 'observed')`).run(localDateString());
    const input = {
      requestId: 'gold-delete-0001', goldHoldingId: 'gold', targetAccountId: 'try',
      quantityMicros: 2_000_000, netTryMinor: 500_000, feeTryMinor: 10_000,
    };
    const sale = await recordGoldSale(db, input);
    await assert.rejects(deleteGoldHolding(db, 'gold'), (error) => error.code === 'DEPENDENCY_BLOCKED');
    await assert.rejects(deleteAccount(db, 'try'), (error) => error.code === 'DEPENDENCY_BLOCKED');
    sqlite.exec(`CREATE TRIGGER prevent_delete BEFORE DELETE ON asset_conversions
      BEGIN SELECT RAISE(ABORT, 'test abort'); END;`);
    await assert.rejects(deleteAssetConversion(db, sale.id));
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'try'").get().balance_minor, 600000);
    assert.equal(sqlite.prepare("SELECT quantity_micros FROM gold_holdings WHERE id = 'gold'").get().quantity_micros, 3000000);
    sqlite.exec('DROP TRIGGER prevent_delete');
    await deleteAssetConversion(db, sale.id);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'try'").get().balance_minor, 100000);
    assert.equal(sqlite.prepare("SELECT quantity_micros FROM gold_holdings WHERE id = 'gold'").get().quantity_micros, 5000000);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM balance_snapshots WHERE kind = 'conversion'").get().count, 0);
    assert.equal((await listAssetConversions(db)).length, 0);
  } finally {
    sqlite.close();
  }
});

test('eski satış yeni satıştan önce silinmez; son satıştan başlayarak geri alınır', async () => {
  const { sqlite, db } = await fixture();
  try {
    sqlite.prepare(`INSERT INTO balance_snapshots (id, account_id, observed_on, actual_minor, kind)
      VALUES ('initial-try', 'try', ?, 100000, 'observed')`).run(localDateString());
    const first = await recordGoldSale(db, {
      requestId: 'gold-chain-0001', goldHoldingId: 'gold', targetAccountId: 'try',
      quantityMicros: 1_000_000, netTryMinor: 200_000, feeTryMinor: 0,
    });
    const second = await recordGoldSale(db, {
      requestId: 'gold-chain-0002', goldHoldingId: 'gold', targetAccountId: 'try',
      quantityMicros: 1_000_000, netTryMinor: 200_000, feeTryMinor: 0,
    });
    await assert.rejects(deleteAssetConversion(db, first.id), (error) => error.code === 'UNSAFE_REVERSAL');
    await deleteAssetConversion(db, second.id);
    await deleteAssetConversion(db, first.id);
    assert.equal(sqlite.prepare("SELECT quantity_micros FROM gold_holdings WHERE id = 'gold'").get().quantity_micros, 5000000);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'try'").get().balance_minor, 100000);
    assert.equal((await listAssetConversions(db)).length, 0);
  } finally {
    sqlite.close();
  }
});

test('son döviz dönüşümü geri alınır; sonraki bakiye gözlemi varsa silinmez', async () => {
  const { sqlite, db } = await fixture();
  try {
    for (const [id, amount] of [['usd', 10000], ['try', 100000]]) {
      sqlite.prepare(`INSERT INTO balance_snapshots (id, account_id, observed_on, actual_minor, kind)
        VALUES (?, ?, ?, ?, 'observed')`).run(`initial-${id}`, id, localDateString(), amount);
    }
    const input = {
      requestId: 'fx-delete-0001', sourceAccountId: 'usd', targetAccountId: 'try',
      sourceAmountMinor: 2500, netTryMinor: 120000, feeTryMinor: 500,
    };
    const first = await recordFxExchange(db, input);
    await deleteAssetConversion(db, first.id);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'usd'").get().balance_minor, 10000);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'try'").get().balance_minor, 100000);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM balance_snapshots WHERE kind = 'conversion'").get().count, 0);
    const second = await recordFxExchange(db, { ...input, requestId: 'fx-delete-0002' });
    await updateBalance(db, (await listAccounts(db)).find((account) => account.id === 'try'), 220000);
    await assert.rejects(deleteAssetConversion(db, second.id), (error) => error.code === 'UNSAFE_REVERSAL');
    assert.equal((await listAssetConversions(db)).length, 1);
  } finally {
    sqlite.close();
  }
});

test('son gözlem snapshotı önceki gözleme döner; dönüşüm araya girdiyse geri alınmaz', async () => {
  const { sqlite, db } = await fixture();
  try {
    sqlite.prepare(`INSERT INTO balance_snapshots (id, account_id, observed_on, actual_minor, kind)
      VALUES ('usd-initial', 'usd', ?, 10000, 'observed')`).run(localDateString());
    await updateBalance(db, (await listAccounts(db)).find((account) => account.id === 'usd'), 9000);
    const latest = (await listSnapshots(db, 'usd'))[0];
    await deleteLatestObservedSnapshot(db, latest.id);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'usd'").get().balance_minor, 10000);
    assert.equal((await listSnapshots(db, 'usd')).length, 1);
    await assert.rejects(deleteLatestObservedSnapshot(db, 'usd-initial'),
      (error) => error.code === 'UNSAFE_REVERSAL');
    const sale = await recordFxExchange(db, {
      requestId: 'fx-snapshot-0001', sourceAccountId: 'usd', targetAccountId: 'try',
      sourceAmountMinor: 1000, netTryMinor: 50000, feeTryMinor: 0,
    });
    assert.ok(sale.id);
    await updateBalance(db, (await listAccounts(db)).find((account) => account.id === 'usd'), 9000);
    await assert.rejects(deleteLatestObservedSnapshot(db, (await listSnapshots(db, 'usd'))[0].id),
      (error) => error.code === 'UNSAFE_REVERSAL');
  } finally {
    sqlite.close();
  }
});

test('son bakiye kaydı farklı zaman damgası biçimlerinde de ekleme sırasına göre seçilir', async () => {
  const { sqlite, db } = await fixture();
  try {
    sqlite.prepare(`INSERT INTO balance_snapshots
      (id, account_id, observed_on, actual_minor, kind, created_at)
      VALUES ('observed', 'try', ?, 100000, 'observed', '2026-10-25T08:00:00.000Z')`).run(localDateString());
    sqlite.prepare(`INSERT INTO balance_snapshots
      (id, account_id, observed_on, actual_minor, kind, created_at)
      VALUES ('conversion', 'try', ?, 200000, 'conversion', '2026-10-25 09:00:00')`).run(localDateString());
    assert.equal((await latestSnapshot(db, 'try')).id, 'conversion');
  } finally {
    sqlite.close();
  }
});

test('kategori planlanan ve gerçekleşeni ayrı toplar; gerçek harcama bakiyeyi düşer ve son hareketse silinir', async () => {
  const { sqlite, db } = await fixture();
  try {
    const category = await createCategory(db, { name: '  Ev  ' });
    assert.equal(category.name, 'Ev');
    await assert.rejects(createCategory(db, { name: 'ev' }), /zaten kayıtlı/);
    await renameCategory(db, category.id, 'Konut');
    await createPlan(db, {
      accountId: 'try', title: 'Kira', kind: 'expense', amountMinor: 5000,
      dueDay: Number(localDateString().slice(-2)), categoryId: category.id,
    });
    await createFlexiblePlan(db, { accountId: 'try', title: 'Market', amountMinor: 10000, categoryId: category.id });
    sqlite.prepare('UPDATE flexible_monthly_plans SET starts_on = ?').run(`${localDateString().slice(0, 7)}-01`);
    await createOneTimePlan(db, {
      accountId: 'try', title: 'Tamir', kind: 'expense', amountMinor: 2000,
      dueOn: localDateString(), categoryId: category.id,
    });
    const regular = (await listPlans(db))[0];
    const flexible = (await listFlexiblePlans(db))[0];
    await createActualExpense(db, {
      accountId: 'try', amountMinor: 6000, occurredOn: localDateString(),
      planType: 'regular', planId: regular.id,
    });
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'try'").get().balance_minor, 94000);
    assert.equal((await listPlans(db))[0].fulfilledMonths[0], localDateString().slice(0, 7));
    await assert.rejects(createActualExpense(db, {
      accountId: 'try', amountMinor: 1000, occurredOn: localDateString(),
      planType: 'regular', planId: regular.id,
    }), /zaten gerçekleşen/);
    await createActualExpense(db, {
      accountId: 'try', amountMinor: 3000, occurredOn: localDateString(),
      planType: 'flexible', planId: flexible.id,
    });
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'try'").get().balance_minor, 91000);
    const month = localDateString().slice(0, 7);
    const totals = await listCategoryMonthlyTotals(db, month);
    const home = totals.find((entry) => entry.categoryId === category.id && entry.currency === 'TRY');
    assert.equal(home.plannedMinor, 17000);
    assert.equal(home.actualMinor, 9000);
    assert.equal(home.categoryName, 'Konut');
    const actual = await listActualExpenses(db, month);
    assert.equal(actual.length, 2);
    assert.equal(actual[0].categoryId, category.id);
    await assert.rejects(deleteActualExpense(db, actual[1].id), (error) => error.code === 'UNSAFE_REVERSAL');
    await deleteActualExpense(db, actual[0].id);
    await deleteActualExpense(db, actual[1].id);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'try'").get().balance_minor, 100000);
    assert.equal((await listPlans(db))[0].fulfilledMonths.length, 0);
    await deleteCategory(db, category.id);
    assert.equal((await listCategories(db)).length, 0);
    assert.equal((await listPlans(db))[0].categoryId, null);
    assert.equal((await listFlexiblePlans(db))[0].categoryId, null);
    assert.equal((await listOneTimePlans(db))[0].categoryId, null);
  } finally {
    sqlite.close();
  }
});

test('gerçek harcama TL kullanım hesabını ve tek seferlik planın ayını doğrular', async () => {
  const { sqlite, db } = await fixture();
  try {
    await assert.rejects(createActualExpense(db, {
      accountId: 'usd', amountMinor: 1000, occurredOn: localDateString(),
    }), /TL kullanım hesabı/);
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    await createOneTimePlan(db, {
      accountId: 'try', title: 'Gelecek gider', kind: 'expense', amountMinor: 1000, dueOn: localDateString(nextMonth),
    });
    await assert.rejects(createActualExpense(db, {
      accountId: 'try', amountMinor: 1000, occurredOn: localDateString(),
      planType: 'one_time', planId: (await listOneTimePlans(db))[0].id,
    }), /geçerli değil/);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'try'").get().balance_minor, 100000);
  } finally {
    sqlite.close();
  }
});

test('gözlem tarihi korunur; harcama dönüşümden önce güvenle silinmez', async () => {
  const { sqlite, db } = await fixture();
  try {
    const observedOn = localDateString();
    const observedAt = sqlite.prepare("SELECT balance_recorded_at FROM accounts WHERE id = 'try'").get().balance_recorded_at;
    sqlite.prepare("INSERT INTO balance_snapshots (id, account_id, observed_on, actual_minor, kind) VALUES ('initial-try', 'try', ?, 100000, 'observed')")
      .run(observedOn);
    await createActualExpense(db, { accountId: 'try', amountMinor: 3000, occurredOn: observedOn });
    const afterExpense = (await listAccounts(db)).find((account) => account.id === 'try');
    assert.equal(afterExpense.balanceMinor, 97000);
    assert.equal(afterExpense.balanceDate, observedOn);
    assert.equal(afterExpense.balanceRecordedAt, observedAt);
    const sale = await recordGoldSale(db, {
      requestId: 'gold-after-expense-0001', goldHoldingId: 'gold', targetAccountId: 'try',
      quantityMicros: 1000000, netTryMinor: 20000, feeTryMinor: 0,
    });
    const expenseId = (await listActualExpenses(db, observedOn.slice(0, 7)))[0].id;
    await assert.rejects(deleteActualExpense(db, expenseId), (error) => error.code === 'UNSAFE_REVERSAL');
    await deleteAssetConversion(db, sale.id);
    await deleteActualExpense(db, expenseId);
    assert.equal(sqlite.prepare("SELECT balance_minor FROM accounts WHERE id = 'try'").get().balance_minor, 100000);
  } finally {
    sqlite.close();
  }
});

test('esnek gider gerçekleşince kalan tutar azalır; son harcama silinince geri döner', async () => {
  const { sqlite, db } = await fixture();
  try {
    sqlite.exec("UPDATE accounts SET remaining_flexible_minor = 5000 WHERE id = 'try'");
    await createFlexiblePlan(db, { accountId: 'try', title: 'Market', amountMinor: 10000 });
    await createActualExpense(db, {
      accountId: 'try', amountMinor: 3000, occurredOn: localDateString(),
      planType: 'flexible', planId: (await listFlexiblePlans(db))[0].id,
    });
    const expenseId = (await listActualExpenses(db, localDateString().slice(0, 7)))[0].id;
    assert.equal(sqlite.prepare("SELECT balance_minor, remaining_flexible_minor FROM accounts WHERE id = 'try'").get().remaining_flexible_minor, 2000);
    await assert.rejects(deleteAccount(db, 'try'), (error) => error.code === 'DEPENDENCY_BLOCKED');
    await deleteActualExpense(db, expenseId);
    const account = sqlite.prepare("SELECT balance_minor, remaining_flexible_minor FROM accounts WHERE id = 'try'").get();
    assert.equal(account.balance_minor, 100000);
    assert.equal(account.remaining_flexible_minor, 5000);
  } finally {
    sqlite.close();
  }
});
