import assert from 'node:assert/strict';
import test from 'node:test';
import { cardPaymentsThrough, installmentAmountForPeriod, parseAmountMinor, projectAccountBalance, projectMonths } from './finance.ts';

test('tutarı kuruşa dönüştürür ve geçersiz hassasiyeti reddeder', () => {
  assert.equal(parseAmountMinor('1 250,50'), 125050);
  assert.equal(parseAmountMinor('1.250,50'), 125050);
  assert.equal(parseAmountMinor('1.250'), 125000);
  assert.equal(parseAmountMinor('-0,50'), -50);
  assert.equal(parseAmountMinor('12.3456'), null);
});

test('ayın 31. günündeki ödeme kısa ayın sonuna taşınır', () => {
  const account = {
    id: 'try-account', name: 'Banka', currency: 'TRY', purpose: 'spending',
    balanceMinor: 10000, balanceDate: '2026-01-15',
  };
  const plans = [
    { id: 'salary', accountId: account.id, title: 'Maaş', kind: 'income', amountMinor: 5000, dueDay: 25, startsOn: '2026-01-01', endsOn: null },
    { id: 'rent', accountId: account.id, title: 'Kira', kind: 'expense', amountMinor: 3000, dueDay: 31, startsOn: '2026-01-01', endsOn: null },
  ];
  assert.equal(projectAccountBalance(account, plans, '2026-02-28'), 14000);
});

test('sonradan eklenen plan geçmiş bakiyeye uygulanmaz', () => {
  const account = {
    id: 'try-account', name: 'Banka', currency: 'TRY', purpose: 'spending',
    balanceMinor: 10000, balanceDate: '2026-01-01',
  };
  const plans = [
    { id: 'new-plan', accountId: account.id, title: 'Gider', kind: 'expense', amountMinor: 1000, dueDay: 10, startsOn: '2026-02-01', endsOn: null },
  ];
  assert.equal(projectAccountBalance(account, plans, '2026-01-31'), 10000);
  assert.equal(projectAccountBalance(account, plans, '2026-02-28'), 9000);
});

test('durdurulan plan geçmiş ödemeleri korur ve geleceğe taşınmaz', () => {
  const account = {
    id: 'try-account', name: 'Banka', currency: 'TRY', purpose: 'spending',
    balanceMinor: 10000, balanceDate: '2026-01-01',
  };
  const plans = [
    { id: 'rent', accountId: account.id, title: 'Kira', kind: 'expense', amountMinor: 2000, dueDay: 10, startsOn: '2026-01-01', endsOn: '2026-02-20' },
  ];
  assert.equal(projectAccountBalance(account, plans, '2026-03-31'), 6000);
});

test('harcanabilir TL hesabına birikim ve döviz eklenmez', () => {
  const accounts = [
    { id: 'spend', name: 'Banka', currency: 'TRY', purpose: 'spending', balanceMinor: 10000, balanceDate: '2026-01-01' },
    { id: 'save', name: 'Birikim', currency: 'TRY', purpose: 'savings', balanceMinor: 20000, balanceDate: '2026-01-01' },
    { id: 'usd', name: 'Döviz', currency: 'USD', purpose: 'savings', balanceMinor: 30000, balanceDate: '2026-01-01' },
  ];
  const projections = projectMonths(accounts, [], new Date(2026, 0, 15), 1);
  assert.equal(projections[0].spendingTryMinor, 10000);
  assert.equal(projections[0].balances.length, 3);
});

test('güncel ayda yalnızca bildirilen kalan gider, sonraki ayda tam bütçe düşülür', () => {
  const account = {
    id: 'try-account', name: 'Banka', currency: 'TRY', purpose: 'spending',
    balanceMinor: 10000, balanceDate: '2026-01-15', remainingFlexibleMinor: 3000,
  };
  const datedPlans = [
    { id: 'rent', accountId: account.id, title: 'Kira', kind: 'expense', amountMinor: 2000, dueDay: 20, startsOn: '2026-01-01', endsOn: null },
  ];
  const flexiblePlans = [
    { id: 'market', accountId: account.id, title: 'Market', amountMinor: 8000, startsOn: '2026-01-01', endsOn: null },
  ];
  assert.equal(projectAccountBalance(account, datedPlans, '2026-01-20', flexiblePlans), 8000);
  assert.equal(projectAccountBalance(account, datedPlans, '2026-01-31', flexiblePlans), 5000);
  assert.equal(projectAccountBalance(account, datedPlans, '2026-02-28', flexiblePlans), -5000);
  const months = projectMonths([account], datedPlans, new Date(2026, 0, 15), 2, flexiblePlans);
  assert.deepEqual(months.map((month) => month.spendingTryMinor), [5000, -5000]);
});

test('yeni bakiye geçmiş giderleri tekrar düşmez', () => {
  const account = {
    id: 'try-account', name: 'Banka', currency: 'TRY', purpose: 'spending',
    balanceMinor: 5000, balanceDate: '2026-01-25', remainingFlexibleMinor: 1000,
  };
  const datedPlans = [
    { id: 'rent', accountId: account.id, title: 'Kira', kind: 'expense', amountMinor: 2000, dueDay: 20, startsOn: '2026-01-01', endsOn: null },
  ];
  const flexiblePlans = [
    { id: 'market', accountId: account.id, title: 'Market', amountMinor: 8000, startsOn: '2026-01-01', endsOn: null },
  ];
  assert.equal(projectAccountBalance(account, datedPlans, '2026-01-31', flexiblePlans), 4000);
});

test('kalan gider bilinmiyorsa mevcut ayın tam bütçesi varsayılmaz', () => {
  const account = {
    id: 'try-account', name: 'Banka', currency: 'TRY', purpose: 'spending',
    balanceMinor: 10000, balanceDate: '2026-01-15', remainingFlexibleMinor: null,
  };
  const flexiblePlans = [
    { id: 'market', accountId: account.id, title: 'Market', amountMinor: 8000, startsOn: '2026-01-01', endsOn: null },
  ];
  assert.equal(projectAccountBalance(account, [], '2026-01-31', flexiblePlans), 10000);
  assert.equal(projectAccountBalance(account, [], '2026-02-28', flexiblePlans), 2000);
});

test('tam ayı kapsamayan esnek bütçe otomatik tam tutar sayılmaz', () => {
  const account = {
    id: 'try-account', name: 'Banka', currency: 'TRY', purpose: 'spending',
    balanceMinor: 10000, balanceDate: '2026-01-15', remainingFlexibleMinor: 0,
  };
  const flexiblePlans = [
    { id: 'market', accountId: account.id, title: 'Market', amountMinor: 2000, startsOn: '2026-02-15', endsOn: null },
  ];
  assert.equal(projectAccountBalance(account, [], '2026-02-28', flexiblePlans), 10000);
  assert.equal(projectAccountBalance(account, [], '2026-03-31', flexiblePlans), 8000);
});

test('taksit kuruş farkı son taksitte kapanır ve kart ödemesi TL hesabından yalnız bir kez düşer', () => {
  const account = {
    id: 'bank', name: 'Banka', currency: 'TRY', purpose: 'spending',
    balanceMinor: 100000, balanceDate: '2026-01-01', remainingFlexibleMinor: null,
  };
  const card = {
    id: 'card', name: 'Kart', paymentAccountId: 'bank', closingDay: 20,
    paymentDay: 5, monthlySpendingEstimateMinor: 1000, startsOn: '2026-01-01',
  };
  const installment = {
    id: 'installment', cardId: 'card', title: 'Telefon', totalAmountMinor: 10001,
    installmentCount: 3, firstStatementPeriod: '2026-01',
  };
  assert.deepEqual(['2026-01', '2026-02', '2026-03', '2026-04']
    .map((period) => installmentAmountForPeriod(installment, period)), [3333, 3333, 3335, 0]);
  const payments = cardPaymentsThrough(account, '2026-02-28', [card], [], [installment]);
  assert.deepEqual(payments.map((payment) => [payment.statementPeriod, payment.paymentDate, payment.amountMinor]), [
    ['2026-01', '2026-02-05', 4333],
  ]);
  assert.equal(projectAccountBalance(account, [], '2026-02-28', [], [card], [], [installment]), 95667);
});

test('gerçek ekstre taksit ve harcama tahminini bastırır; yalnız planlanan tutar ödenir', () => {
  const account = {
    id: 'bank', name: 'Banka', currency: 'TRY', purpose: 'spending',
    balanceMinor: 100000, balanceDate: '2026-01-01', remainingFlexibleMinor: null,
  };
  const card = {
    id: 'card', name: 'Kart', paymentAccountId: 'bank', closingDay: 15,
    paymentDay: 25, monthlySpendingEstimateMinor: 10000, startsOn: '2026-01-01',
  };
  const installment = {
    id: 'installment', cardId: 'card', title: 'Ürün', totalAmountMinor: 6000,
    installmentCount: 2, firstStatementPeriod: '2026-01',
  };
  const statement = {
    id: 'statement', cardId: 'card', statementPeriod: '2026-01', dueDate: '2026-01-25',
    actualAmountMinor: 20000, plannedPaymentMinor: 15000, paymentAccountId: 'bank',
    status: 'planned', paidOn: null, paidAmountMinor: null,
  };
  const payments = cardPaymentsThrough(account, '2026-01-31', [card], [statement], [installment]);
  assert.equal(payments.length, 1);
  assert.equal(payments[0].amountMinor, 15000);
  assert.equal(payments[0].source, 'actual');
  assert.equal(projectAccountBalance(account, [], '2026-01-31', [], [card], [statement], [installment]), 85000);
});

test('bakiye güncellemesinden önceki ödeme yeniden düşülmez; geçmiş vadeli açık ekstre takip edilir', () => {
  const account = {
    id: 'bank', name: 'Banka', currency: 'TRY', purpose: 'spending',
    balanceMinor: 80000, balanceDate: '2026-02-10', remainingFlexibleMinor: null,
  };
  const card = {
    id: 'card', name: 'Kart', paymentAccountId: 'bank', closingDay: 15,
    paymentDay: 25, monthlySpendingEstimateMinor: 0, startsOn: '2026-01-01',
  };
  const statement = {
    id: 'statement', cardId: 'card', statementPeriod: '2026-01', dueDate: '2026-01-25',
    actualAmountMinor: 20000, plannedPaymentMinor: 10000, paymentAccountId: 'bank',
    status: 'paid', paidOn: '2026-02-05', paidAmountMinor: 10000,
  };
  assert.equal(projectAccountBalance(account, [], '2026-02-28', [], [card], [statement]), 80000);
  const openStatement = { ...statement, status: 'planned', paidOn: null, paidAmountMinor: null };
  assert.equal(projectAccountBalance(account, [], '2026-02-28', [], [card], [openStatement]), 70000);
});

test('aynı gün ödenen ekstre, sonradan güncellenen bakiyeden tekrar düşülmez', () => {
  const card = {
    id: 'card', name: 'Kart', paymentAccountId: 'bank', closingDay: 15,
    paymentDay: 25, monthlySpendingEstimateMinor: 0, startsOn: '2026-01-01',
  };
  const statement = {
    id: 'statement', cardId: 'card', statementPeriod: '2026-01', dueDate: '2026-02-10',
    actualAmountMinor: 12000, plannedPaymentMinor: 12000, paymentAccountId: 'bank',
    status: 'paid', paidOn: '2026-02-10', paidAt: '2026-02-10T09:00:00.000Z', paidAmountMinor: 12000,
  };
  const accountBeforePayment = {
    id: 'bank', name: 'Banka', currency: 'TRY', purpose: 'spending',
    balanceMinor: 100000, balanceDate: '2026-02-10',
    balanceRecordedAt: '2026-02-10T08:00:00.000Z', remainingFlexibleMinor: null,
  };
  assert.equal(projectAccountBalance(accountBeforePayment, [], '2026-02-28', [], [card], [statement]), 88000);
  const accountAfterPayment = {
    ...accountBeforePayment, balanceMinor: 88000, balanceRecordedAt: '2026-02-10T10:00:00.000Z',
  };
  assert.equal(projectAccountBalance(accountAfterPayment, [], '2026-02-28', [], [card], [statement]), 88000);
});

test('tek seferlik plan bir kez uygulanır ve yeni bakiye görüntüsünden sonra tekrarlanmaz', () => {
  const account = {
    id: 'bank', name: 'Banka', currency: 'TRY', purpose: 'spending',
    balanceMinor: 100000, balanceDate: '2026-10-25',
    balanceRecordedAt: '2026-10-25T08:00:00.000Z', remainingFlexibleMinor: null,
  };
  const plans = [
    { id: 'bonus', accountId: 'bank', title: 'Prim', kind: 'income', amountMinor: 20000,
      dueOn: '2026-10-25', status: 'planned', createdAt: '2026-10-25T09:00:00.000Z' },
    { id: 'repair', accountId: 'bank', title: 'Tamir', kind: 'expense', amountMinor: 5000,
      dueOn: '2026-11-04', status: 'planned', createdAt: '2026-10-25T09:00:00.000Z' },
    { id: 'cancelled', accountId: 'bank', title: 'İptal', kind: 'expense', amountMinor: 10000,
      dueOn: '2026-11-04', status: 'cancelled', createdAt: '2026-10-25T09:00:00.000Z' },
  ];
  assert.equal(projectAccountBalance(account, [], '2026-10-25', [], [], [], [], plans), 120000);
  assert.equal(projectAccountBalance(account, [], '2026-12-31', [], [], [], [], plans), 115000);
  const updated = { ...account, balanceMinor: 120000, balanceRecordedAt: '2026-10-25T10:00:00.000Z' };
  assert.equal(projectAccountBalance(updated, [], '2026-12-31', [], [], [], [], plans), 115000);
});

test('aynı gün eklenen aylık plan transfer bakiyesi sonrası görünür kalır', () => {
  const account = {
    id: 'bank', name: 'Banka', currency: 'TRY', purpose: 'spending',
    balanceMinor: 100000, balanceDate: '2026-10-25',
    balanceRecordedAt: '2026-10-25T08:00:00.000Z', remainingFlexibleMinor: null,
  };
  const plan = {
    id: 'bill', accountId: 'bank', title: 'Fatura', kind: 'expense', amountMinor: 5000,
    dueDay: 25, startsOn: '2026-10-25', endsOn: null, createdAt: '2026-10-25T09:00:00.000Z',
  };
  assert.equal(projectAccountBalance(account, [plan], '2026-10-25'), 95000);
  const afterTransfer = { ...account, balanceMinor: 120000 };
  assert.equal(projectAccountBalance(afterTransfer, [plan], '2026-10-25'), 115000);
  const afterObservedBalance = { ...afterTransfer, balanceMinor: 115000, balanceRecordedAt: '2026-10-25T10:00:00.000Z' };
  assert.equal(projectAccountBalance(afterObservedBalance, [plan], '2026-10-25'), 115000);
});

test('ayın son gününde bildirilen kalan değişken gider ay sonuna katılır', () => {
  const account = {
    id: 'bank', name: 'Banka', currency: 'TRY', purpose: 'spending',
    balanceMinor: 10000, balanceDate: '2026-01-31',
    balanceRecordedAt: '2026-01-31T08:00:00Z', remainingFlexibleMinor: 1000,
  };
  assert.equal(projectAccountBalance(account, [], '2026-01-31'), 9000);
});

test('gerçek harcamaya bağlanan düzenli ve tek seferlik plan aynı dönemde ikinci kez düşmez', () => {
  const account = {
    id: 'bank', name: 'Banka', currency: 'TRY', purpose: 'spending',
    balanceMinor: 90000, balanceDate: '2026-01-01',
    balanceRecordedAt: '2026-01-01T08:00:00.000Z', remainingFlexibleMinor: null,
  };
  const regular = [{
    id: 'rent', accountId: 'bank', title: 'Kira', kind: 'expense', amountMinor: 7000,
    dueDay: 20, startsOn: '2026-01-01', endsOn: null, fulfilledMonths: ['2026-01'],
  }];
  const oneTime = [{
    id: 'repair', accountId: 'bank', title: 'Tamir', kind: 'expense', amountMinor: 3000,
    dueOn: '2026-01-25', status: 'planned', createdAt: '2026-01-01T09:00:00.000Z', fulfilled: true,
  }];
  assert.equal(projectAccountBalance(account, regular, '2026-01-31', [], [], [], [], oneTime), 90000);
  assert.equal(projectAccountBalance(account, regular, '2026-02-28', [], [], [], [], oneTime), 83000);
});

test('gözlemden sonraki ayda esnek bütçe yalnız gerçekleşenden kalan kadar projekte edilir', () => {
  const account = {
    id: 'bank', name: 'Banka', currency: 'TRY', purpose: 'spending',
    balanceMinor: 97000, balanceDate: '2026-01-01',
    balanceRecordedAt: '2026-01-01T08:00:00.000Z', remainingFlexibleMinor: null,
  };
  const flexible = [{
    id: 'market', accountId: 'bank', title: 'Market', amountMinor: 10000,
    startsOn: '2026-01-01', endsOn: null, actualSpentByMonth: { '2026-02': 3000 },
  }];
  assert.equal(projectAccountBalance(account, [], '2026-02-28', flexible), 90000);
  assert.equal(projectAccountBalance(account, [], '2026-03-31', flexible), 80000);
});
