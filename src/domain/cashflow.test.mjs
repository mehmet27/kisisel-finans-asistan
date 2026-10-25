import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './finance' && context.parentURL?.endsWith('/cashflow.ts')) {
      return nextResolve('./finance.ts', context);
    }
    return nextResolve(specifier, context);
  },
});

const { buildCashFlowTimeline, compareCashFlowScenario } = await import('./cashflow.ts');
const { projectMonths } = await import('./finance.ts');

const emptyInput = {
  accounts: [], plans: [], flexiblePlans: [], cards: [], statements: [], installments: [], oneTimePlans: [],
};

test('ay sonu pozitif olsa da kira günü ilk TL nakit açığı görünür', () => {
  const account = {
    id: 'bank', name: 'Banka', currency: 'TRY', purpose: 'spending',
    balanceMinor: 10000, balanceDate: '2026-01-01', balanceRecordedAt: '2026-01-01T08:00:00Z',
    remainingFlexibleMinor: null,
  };
  const plans = [
    { id: 'rent', accountId: 'bank', title: 'Kira', kind: 'expense', amountMinor: 15000,
      dueDay: 5, startsOn: '2026-01-01', endsOn: null },
    { id: 'salary', accountId: 'bank', title: 'Maaş', kind: 'income', amountMinor: 10000,
      dueDay: 20, startsOn: '2026-01-01', endsOn: null },
  ];
  const input = { ...emptyInput, accounts: [account], plans };
  const timeline = buildCashFlowTimeline(input, new Date(2026, 0, 1), 3);
  assert.equal(timeline.firstShortfallDate, '2026-01-05');
  assert.equal(timeline.firstAccountShortfallDate, '2026-01-05');
  assert.equal(timeline.days.find((day) => day.date === '2026-01-05').spendingTryMinor, -5000);
  assert.equal(timeline.monthEnds[0].spendingTryMinor, 5000);
  assert.deepEqual(timeline.monthEnds.map((month) => month.spendingTryMinor),
    projectMonths([account], plans, new Date(2026, 0, 1), 3).map((month) => month.spendingTryMinor));
  const rent = timeline.days.find((day) => day.date === '2026-01-05').events[0];
  assert.equal(rent.sourceKind, 'monthly_plan');
  assert.equal(rent.sourceId, 'rent');
  assert.match(rent.assumption, /planlanan/);
});

test('aynı gün gider önce geldiğinde geçici açık görünür; gün sonu pozitif kalır', () => {
  const account = {
    id: 'bank', name: 'Banka', currency: 'TRY', purpose: 'spending',
    balanceMinor: 5000, balanceDate: '2026-01-01', balanceRecordedAt: null, remainingFlexibleMinor: null,
  };
  const plans = [
    { id: 'expense', accountId: 'bank', title: 'Fatura', kind: 'expense', amountMinor: 7000,
      dueDay: 10, startsOn: '2026-01-01', endsOn: null },
    { id: 'income', accountId: 'bank', title: 'Ek gelir', kind: 'income', amountMinor: 5000,
      dueDay: 10, startsOn: '2026-01-01', endsOn: null },
  ];
  const timeline = buildCashFlowTimeline({ ...emptyInput, accounts: [account], plans }, new Date(2026, 0, 1), 3);
  const day = timeline.days.find((item) => item.date === '2026-01-10');
  assert.deepEqual(day.events.map((event) => event.sourceId), ['expense', 'income']);
  assert.equal(day.spendingTryMinor, 3000);
  assert.equal(day.hasTotalShortfall, true);
  assert.deepEqual(day.shortfallAccountIds, ['bank']);
  assert.equal(timeline.firstShortfallDate, '2026-01-10');
});

test('tek hesabın açığı toplam TL yeterliyken ayrı gösterilir', () => {
  const accounts = [
    { id: 'cash', name: 'Nakit', currency: 'TRY', purpose: 'spending',
      balanceMinor: 1000, balanceDate: '2026-01-01', balanceRecordedAt: null, remainingFlexibleMinor: null },
    { id: 'bank', name: 'Banka', currency: 'TRY', purpose: 'spending',
      balanceMinor: 10000, balanceDate: '2026-01-01', balanceRecordedAt: null, remainingFlexibleMinor: null },
  ];
  const plans = [{
    id: 'expense', accountId: 'cash', title: 'Ödeme', kind: 'expense', amountMinor: 2000,
    dueDay: 5, startsOn: '2026-01-01', endsOn: null,
  }];
  const timeline = buildCashFlowTimeline({ ...emptyInput, accounts, plans }, new Date(2026, 0, 1), 3);
  assert.equal(timeline.firstAccountShortfallDate, '2026-01-05');
  assert.equal(timeline.firstShortfallDate, null);
  const day = timeline.days.find((item) => item.date === '2026-01-05');
  assert.deepEqual(day.shortfallAccountIds, ['cash']);
  assert.equal(day.spendingTryMinor, 9000);
});

test('kartın gerçek ekstresi tahmini bastırır, değişken gider ay sonunda görünür', () => {
  const account = {
    id: 'bank', name: 'Banka', currency: 'TRY', purpose: 'spending',
    balanceMinor: 100000, balanceDate: '2026-01-15', balanceRecordedAt: null,
    remainingFlexibleMinor: 3000,
  };
  const card = {
    id: 'card', name: 'Kart', paymentAccountId: 'bank', closingDay: 15,
    paymentDay: 25, monthlySpendingEstimateMinor: 5000, startsOn: '2026-01-01',
  };
  const statement = {
    id: 'statement', cardId: 'card', statementPeriod: '2026-01', dueDate: '2026-01-25',
    actualAmountMinor: 12000, plannedPaymentMinor: 12000, paymentAccountId: 'bank',
    status: 'planned', paidOn: null, paidAt: null, paidAmountMinor: null,
  };
  const installment = {
    id: 'installment', cardId: 'card', title: 'Telefon', totalAmountMinor: 6000,
    installmentCount: 2, firstStatementPeriod: '2026-01',
  };
  const input = {
    ...emptyInput, accounts: [account], cards: [card], statements: [statement],
    installments: [installment], flexiblePlans: [
      { id: 'food', accountId: 'bank', title: 'Market', amountMinor: 8000,
        startsOn: '2026-01-01', endsOn: null },
    ],
  };
  const timeline = buildCashFlowTimeline(input, new Date(2026, 0, 15), 3);
  assert.equal(timeline.days.find((day) => day.date === '2026-01-25').events.filter((event) =>
    event.sourceKind.startsWith('card')).length, 1);
  assert.equal(timeline.days.find((day) => day.date === '2026-01-25').events[0].amountMinor, -12000);
  assert.equal(timeline.days.find((day) => day.date === '2026-01-31').events[0].sourceKind, 'flexible_remaining');
  assert.equal(timeline.monthEnds[0].spendingTryMinor, 85000);
  assert.equal(timeline.days.find((day) => day.date === '2026-02-28').events.some((event) =>
    event.sourceKind === 'flexible_budget'), true);
});

test('senaryo gelir ve taksiti yalnız kopyada uygular; gerçek ekstre olan dönem değişmez', () => {
  const account = {
    id: 'bank', name: 'Banka', currency: 'TRY', purpose: 'spending',
    balanceMinor: 100000, balanceDate: '2026-01-01', balanceRecordedAt: null,
    remainingFlexibleMinor: null,
  };
  const card = {
    id: 'card', name: 'Kart', paymentAccountId: 'bank', closingDay: 15,
    paymentDay: 25, monthlySpendingEstimateMinor: 0, startsOn: '2026-01-01',
  };
  const statement = {
    id: 'statement', cardId: 'card', statementPeriod: '2026-01', dueDate: '2026-01-25',
    actualAmountMinor: 10000, plannedPaymentMinor: 10000, paymentAccountId: 'bank',
    status: 'planned', paidOn: null, paidAt: null, paidAmountMinor: null,
  };
  const input = { ...emptyInput, accounts: [account], cards: [card], statements: [statement] };
  const result = compareCashFlowScenario(input, new Date(2026, 0, 1), 3, [
    { kind: 'income', accountId: 'bank', title: 'Ek iş', amountMinor: 2000, dueOn: '2026-01-20' },
    { kind: 'installment', cardId: 'card', title: 'Yeni ürün', totalAmountMinor: 6000,
      installmentCount: 2, firstStatementPeriod: '2026-01' },
  ]);
  assert.deepEqual(result.monthlyDeltas.map((month) => month.spendingTryDeltaMinor), [2000, -1000, -1000]);
  assert.equal(input.installments.length, 0);
  assert.equal(input.oneTimePlans.length, 0);
  assert.equal(result.scenario.days.find((day) => day.date === '2026-01-20').events[0].isScenario, true);
  assert.equal(result.scenario.days.find((day) => day.date === '2026-02-25').events[0].isScenario, true);
});
