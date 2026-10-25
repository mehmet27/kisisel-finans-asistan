export type Currency = 'TRY' | 'USD' | 'EUR';
export type AccountPurpose = 'spending' | 'savings';
export type PlanKind = 'income' | 'expense';

export interface Account {
  id: string;
  name: string;
  currency: Currency;
  purpose: AccountPurpose;
  balanceMinor: number;
  balanceDate: string;
  balanceRecordedAt: string | null;
  remainingFlexibleMinor: number | null;
}

export interface MonthlyPlan {
  id: string;
  accountId: string;
  title: string;
  kind: PlanKind;
  amountMinor: number;
  dueDay: number;
  startsOn: string;
  endsOn: string | null;
  createdAt?: string;
  categoryId?: string | null;
  fulfilledMonths?: string[];
}

export interface FlexibleMonthlyPlan {
  id: string;
  accountId: string;
  title: string;
  amountMinor: number;
  startsOn: string;
  endsOn: string | null;
  categoryId?: string | null;
  actualSpentByMonth?: Record<string, number>;
}

export interface OneTimePlan {
  id: string;
  accountId: string;
  title: string;
  kind: PlanKind;
  amountMinor: number;
  dueOn: string;
  status: 'planned' | 'cancelled';
  createdAt: string;
  categoryId?: string | null;
  fulfilled?: boolean;
}

export interface Category {
  id: string;
  name: string;
  createdAt: string;
}

export interface ActualExpense {
  id: string;
  accountId: string;
  categoryId: string | null;
  amountMinor: number;
  occurredOn: string;
  planType: 'regular' | 'flexible' | 'one_time' | null;
  planId: string | null;
}

export interface CategoryMonthlyTotal {
  categoryId: string | null;
  categoryName: string;
  currency: Currency;
  plannedMinor: number;
  actualMinor: number;
}

export interface BalanceSnapshot {
  id: string;
  kind: 'observed' | 'conversion' | 'expense';
  expenseId?: string | null;
  accountId: string;
  observedOn: string;
  actualMinor: number;
  expectedMinor: number | null;
  differenceMinor: number | null;
  remainingFlexibleMinor: number | null;
}

export interface CreditCard {
  id: string;
  name: string;
  paymentAccountId: string;
  closingDay: number;
  paymentDay: number;
  monthlySpendingEstimateMinor: number;
  startsOn: string;
}

export interface CardStatement {
  id: string;
  cardId: string;
  statementPeriod: string;
  dueDate: string;
  actualAmountMinor: number;
  plannedPaymentMinor: number;
  paymentAccountId: string;
  status: 'planned' | 'paid';
  paidOn: string | null;
  paidAt: string | null;
  paidAmountMinor: number | null;
}

export interface InstallmentPlan {
  id: string;
  cardId: string;
  title: string;
  totalAmountMinor: number;
  installmentCount: number;
  firstStatementPeriod: string;
}

export interface CardPayment {
  cardId: string;
  statementPeriod: string;
  paymentAccountId: string;
  paymentDate: string;
  amountMinor: number;
  source: 'actual' | 'estimate';
}

export interface CashFlowEvent {
  date: string;
  accountId: string;
  amountMinor: number;
  title: string;
  sourceKind: 'monthly_plan' | 'one_time_plan' | 'flexible_remaining' | 'flexible_budget' | 'card_actual' | 'card_estimate';
  sourceId: string;
  assumption: string;
  isScenario: boolean;
}

export function parseAmountMinor(raw: string): number | null {
  const compact = raw.trim().replace(/\s/g, '');
  const hasThousands = /^-?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(compact);
  const normalized = (hasThousands ? compact.replace(/\./g, '') : compact).replace(',', '.');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const negative = normalized.startsWith('-');
  const [whole, fractional = ''] = (negative ? normalized.slice(1) : normalized).split('.');
  const absolute = Number(whole) * 100 + Number(fractional.padEnd(2, '0'));
  if (!Number.isSafeInteger(absolute)) return null;
  return negative ? -absolute : absolute;
}

export function formatMoney(minor: number, currency: Currency): string {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

export function localDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function monthEnd(year: number, monthIndex: number): string {
  return localDateString(new Date(year, monthIndex, daysInMonth(year, monthIndex)));
}

function monthNumber(period: string): number {
  const [year, month] = period.split('-').map(Number);
  return year * 12 + month - 1;
}

function periodFromMonthNumber(monthNumberValue: number): string {
  const year = Math.floor(monthNumberValue / 12);
  const month = monthNumberValue - year * 12;
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

export function installmentAmountForPeriod(plan: InstallmentPlan, statementPeriod: string): number {
  const installmentIndex = monthNumber(statementPeriod) - monthNumber(plan.firstStatementPeriod);
  if (installmentIndex < 0 || installmentIndex >= plan.installmentCount) return 0;
  const standardAmount = Math.floor(plan.totalAmountMinor / plan.installmentCount);
  return installmentIndex === plan.installmentCount - 1
    ? plan.totalAmountMinor - standardAmount * (plan.installmentCount - 1)
    : standardAmount;
}

export function cardPaymentsThrough(
  account: Account,
  throughDate: string,
  cards: CreditCard[] = [],
  statements: CardStatement[] = [],
  installments: InstallmentPlan[] = [],
): CardPayment[] {
  if (account.currency !== 'TRY' || account.purpose !== 'spending' || throughDate < account.balanceDate) return [];
  const startMonth = Math.min(
    monthNumber(account.balanceDate.slice(0, 7)) - 1,
    ...statements.map((statement) => monthNumber(statement.statementPeriod)),
  );
  const lastMonth = monthNumber(throughDate.slice(0, 7));
  const payments: CardPayment[] = [];

  for (const card of cards) {
    for (let month = startMonth; month <= lastMonth; month += 1) {
      const period = periodFromMonthNumber(month);
      const actual = statements.find((statement) => statement.cardId === card.id && statement.statementPeriod === period);
      if (actual) {
        if (actual.paymentAccountId !== account.id) continue;
        // Paid statements use the real payment date; timestamps order same-day balance observations.
        const paymentDate = actual.status === 'paid'
          ? actual.paidOn
          : (actual.dueDate <= account.balanceDate
            ? localDateString(new Date(new Date(`${account.balanceDate}T12:00:00`).getTime() + 86400000))
            : actual.dueDate);
        const paidAfterSameDayBalance = actual.status === 'paid'
          && paymentDate === account.balanceDate
          && !!actual.paidAt && !!account.balanceRecordedAt
          && actual.paidAt > account.balanceRecordedAt;
        if (!paymentDate || (paymentDate <= account.balanceDate && !paidAfterSameDayBalance)
          || paymentDate > throughDate) continue;
        payments.push({
          cardId: card.id, statementPeriod: period, paymentAccountId: account.id,
          paymentDate,
          amountMinor: actual.status === 'paid' ? (actual.paidAmountMinor ?? 0) : actual.plannedPaymentMinor,
          source: 'actual',
        });
        continue;
      }

      if (period < card.startsOn.slice(0, 7) || card.paymentAccountId !== account.id) continue;
      const installmentTotal = installments.reduce(
        (sum, plan) => sum + (plan.cardId === card.id ? installmentAmountForPeriod(plan, period) : 0), 0,
      );
      const amountMinor = card.monthlySpendingEstimateMinor + installmentTotal;
      if (amountMinor === 0) continue;
      const paymentMonth = month + (card.paymentDay <= card.closingDay ? 1 : 0);
      const paymentYear = Math.floor(paymentMonth / 12);
      const paymentMonthIndex = paymentMonth - paymentYear * 12;
      const paymentDate = localDateString(new Date(
        paymentYear, paymentMonthIndex, Math.min(card.paymentDay, daysInMonth(paymentYear, paymentMonthIndex)),
      ));
      if (paymentDate <= account.balanceDate || paymentDate > throughDate) continue;
      payments.push({
        cardId: card.id, statementPeriod: period, paymentAccountId: account.id,
        paymentDate, amountMinor, source: 'estimate',
      });
    }
  }
  return payments;
}

export function accountEventsThrough(
  account: Account,
  plans: MonthlyPlan[],
  throughDate: string,
  flexiblePlans: FlexibleMonthlyPlan[] = [],
  cards: CreditCard[] = [],
  statements: CardStatement[] = [],
  installments: InstallmentPlan[] = [],
  oneTimePlans: OneTimePlan[] = [],
): CashFlowEvent[] {
  if (throughDate < account.balanceDate) return [];
  const from = new Date(`${account.balanceDate}T12:00:00`);
  const until = new Date(`${throughDate}T12:00:00`);
  const events: CashFlowEvent[] = [];

  for (let year = from.getFullYear(), month = from.getMonth();
    year < until.getFullYear() || (year === until.getFullYear() && month <= until.getMonth());
  ) {
    for (const plan of plans) {
      if (plan.accountId !== account.id) continue;
      if (plan.fulfilledMonths?.includes(`${year}-${String(month + 1).padStart(2, '0')}`)) continue;
      const due = localDateString(new Date(year, month, Math.min(plan.dueDay, daysInMonth(year, month))));
      const afterSnapshot = due > account.balanceDate
        || (due === account.balanceDate && !!plan.createdAt && !!account.balanceRecordedAt
          && plan.createdAt > account.balanceRecordedAt);
      if (afterSnapshot && due >= plan.startsOn && (!plan.endsOn || due <= plan.endsOn) && due <= throughDate) {
        events.push({
          date: due, accountId: account.id, amountMinor: plan.kind === 'income' ? plan.amountMinor : -plan.amountMinor,
          title: plan.title, sourceKind: 'monthly_plan', sourceId: plan.id,
          assumption: 'Aylık planlanan hareket; gerçekleşme durumu bakiye güncellemesiyle doğrulanır.',
          isScenario: plan.id.startsWith('scenario:'),
        });
      }
    }

    const endOfMonth = monthEnd(year, month);
    if (endOfMonth >= account.balanceDate && endOfMonth <= throughDate) {
      const isSnapshotMonth = year === from.getFullYear() && month === from.getMonth();
      if (isSnapshotMonth) {
        // Only the amount explicitly expected to remain can be deducted after a real balance snapshot.
        if (account.remainingFlexibleMinor) events.push({
          date: endOfMonth, accountId: account.id, amountMinor: -account.remainingFlexibleMinor,
          title: 'Bu ay kalan değişken gider', sourceKind: 'flexible_remaining', sourceId: account.id,
          assumption: 'Son bakiye güncellemesinde belirtilen kalan tutar ay sonunda düşülür.', isScenario: false,
        });
      } else {
        for (const plan of flexiblePlans) {
          if (plan.accountId !== account.id) continue;
          const firstOfMonth = localDateString(new Date(year, month, 1));
          if (plan.startsOn <= firstOfMonth && (!plan.endsOn || plan.endsOn >= endOfMonth)) {
            const actualSpent = plan.actualSpentByMonth?.[firstOfMonth.slice(0, 7)] ?? 0;
            const remainingBudget = Math.max(0, plan.amountMinor - actualSpent);
            if (remainingBudget === 0) continue;
            events.push({
              date: endOfMonth, accountId: account.id, amountMinor: -remainingBudget,
              title: plan.title, sourceKind: 'flexible_budget', sourceId: plan.id,
              assumption: 'Tam ay değişken gider bütçesi ay sonunda tek tahmini çıkış olarak uygulanır.',
              isScenario: plan.id.startsWith('scenario:'),
            });
          }
        }
      }
    }
    month += 1;
    if (month === 12) { month = 0; year += 1; }
  }
  for (const plan of oneTimePlans) {
    if (plan.accountId !== account.id || plan.status !== 'planned' || plan.fulfilled || plan.dueOn > throughDate) continue;
    const afterSnapshot = plan.dueOn > account.balanceDate
      || (plan.dueOn === account.balanceDate && (plan.id.startsWith('scenario:')
        || (!!account.balanceRecordedAt && plan.createdAt > account.balanceRecordedAt)));
    if (afterSnapshot) events.push({
      date: plan.dueOn, accountId: account.id,
      amountMinor: plan.kind === 'income' ? plan.amountMinor : -plan.amountMinor,
      title: plan.title, sourceKind: 'one_time_plan', sourceId: plan.id,
      assumption: 'Tek seferlik planlanan hareket; gerçek bakiye güncellemesi sonrası tekrar uygulanmaz.',
      isScenario: plan.id.startsWith('scenario:'),
    });
  }
  for (const payment of cardPaymentsThrough(account, throughDate, cards, statements, installments)) {
    if (payment.amountMinor === 0) continue;
    const card = cards.find((item) => item.id === payment.cardId);
    const statement = statements.find((item) => item.cardId === payment.cardId
      && item.statementPeriod === payment.statementPeriod);
    const includesScenarioInstallment = payment.source === 'estimate' && installments.some((plan) =>
      plan.id.startsWith('scenario:') && plan.cardId === payment.cardId
      && installmentAmountForPeriod(plan, payment.statementPeriod) > 0);
    events.push({
      date: payment.paymentDate, accountId: account.id, amountMinor: -payment.amountMinor,
      title: `${card?.name ?? 'Kart'} · ${payment.statementPeriod} ekstresi`,
      sourceKind: payment.source === 'actual' ? 'card_actual' : 'card_estimate',
      sourceId: statement?.id ?? `${payment.cardId}:${payment.statementPeriod}`,
      assumption: payment.source === 'actual'
        ? (statement?.status === 'paid' ? 'Kaydedilen gerçek ödeme tarihi ve tutarı.' : 'Gerçek ekstre için planlanan ödeme; taksit tahmini ayrıca düşülmez.')
        : includesScenarioInstallment
          ? 'Kartın temel tahmini ve senaryo taksiti aynı ekstre ödemesinde toplanır; ikinci ödeme eklenmez.'
          : 'Kart harcama ve taksit tahmini tek ekstre ödemesi olarak uygulanır.',
      isScenario: includesScenarioInstallment,
    });
  }
  return events.sort((left, right) => left.date.localeCompare(right.date)
    || left.amountMinor - right.amountMinor || left.sourceId.localeCompare(right.sourceId));
}

export function projectAccountBalance(
  account: Account,
  plans: MonthlyPlan[],
  throughDate: string,
  flexiblePlans: FlexibleMonthlyPlan[] = [],
  cards: CreditCard[] = [],
  statements: CardStatement[] = [],
  installments: InstallmentPlan[] = [],
  oneTimePlans: OneTimePlan[] = [],
): number {
  return account.balanceMinor + accountEventsThrough(
    account, plans, throughDate, flexiblePlans, cards, statements, installments, oneTimePlans,
  ).reduce((total, event) => total + event.amountMinor, 0);
}

export interface MonthlyProjection {
  period: string;
  endDate: string;
  spendingTryMinor: number;
  balances: { accountId: string; currency: Currency; balanceMinor: number }[];
}

export function projectMonths(
  accounts: Account[],
  plans: MonthlyPlan[],
  fromDate: Date,
  count: number,
  flexiblePlans: FlexibleMonthlyPlan[] = [],
  cards: CreditCard[] = [],
  statements: CardStatement[] = [],
  installments: InstallmentPlan[] = [],
  oneTimePlans: OneTimePlan[] = [],
): MonthlyProjection[] {
  return Array.from({ length: count }, (_, index) => {
    const first = new Date(fromDate.getFullYear(), fromDate.getMonth() + index, 1);
    const endDate = monthEnd(first.getFullYear(), first.getMonth());
    const balances = accounts.map((account) => ({
      accountId: account.id,
      currency: account.currency,
      balanceMinor: projectAccountBalance(account, plans, endDate, flexiblePlans, cards, statements, installments, oneTimePlans),
    }));
    const spendingTryMinor = accounts.reduce((total, account, accountIndex) => {
      if (account.currency !== 'TRY' || account.purpose !== 'spending') return total;
      return total + balances[accountIndex].balanceMinor;
    }, 0);
    return {
      period: `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}`,
      endDate,
      spendingTryMinor,
      balances,
    };
  });
}
