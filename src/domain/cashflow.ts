import {
  accountEventsThrough, localDateString, monthEnd, projectAccountBalance,
} from './finance';
import type {
  Account, CardStatement, CashFlowEvent, CreditCard, Currency, FlexibleMonthlyPlan,
  InstallmentPlan, MonthlyPlan, MonthlyProjection, OneTimePlan, PlanKind,
} from './finance';

export type { CashFlowEvent } from './finance';

export interface CashFlowInput {
  accounts: Account[];
  plans: MonthlyPlan[];
  flexiblePlans: FlexibleMonthlyPlan[];
  cards: CreditCard[];
  statements: CardStatement[];
  installments: InstallmentPlan[];
  oneTimePlans: OneTimePlan[];
}

export interface DailyCashFlow {
  date: string;
  events: CashFlowEvent[];
  spendingTryMinor: number;
  balances: { accountId: string; currency: Currency; balanceMinor: number }[];
  shortfallAccountIds: string[];
  hasTotalShortfall: boolean;
}

export interface CashFlowTimeline {
  startDate: string;
  endDate: string;
  days: DailyCashFlow[];
  monthEnds: MonthlyProjection[];
  firstShortfallDate: string | null;
  firstAccountShortfallDate: string | null;
  assumptions: string[];
}

export type ScenarioChange =
  | { kind: PlanKind; accountId: string; title: string; amountMinor: number; dueOn: string }
  | { kind: 'installment'; cardId: string; title: string; totalAmountMinor: number;
      installmentCount: number; firstStatementPeriod: string };

export interface ScenarioComparison {
  base: CashFlowTimeline;
  scenario: CashFlowTimeline;
  monthlyDeltas: { period: string; spendingTryDeltaMinor: number }[];
}

function moveDay(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return localDateString(value);
}

function spendingBalance(accounts: Account[], balances: Map<string, number>): number {
  return accounts.reduce((total, account) =>
    total + (account.currency === 'TRY' && account.purpose === 'spending'
      ? (balances.get(account.id) ?? 0) : 0), 0);
}

function negativeSpendingAccountIds(accounts: Account[], balances: Map<string, number>): string[] {
  return accounts.filter((account) => account.currency === 'TRY' && account.purpose === 'spending'
    && (balances.get(account.id) ?? 0) < 0).map((account) => account.id);
}

export function buildCashFlowTimeline(
  input: CashFlowInput, fromDate: Date, months: 3 | 6 | 12,
): CashFlowTimeline {
  if (![3, 6, 12].includes(months) || !Number.isFinite(fromDate.getTime())) {
    throw new Error('Geçersiz nakit akışı dönemi.');
  }
  const startDate = localDateString(fromDate);
  const endDate = monthEnd(fromDate.getFullYear(), fromDate.getMonth() + months - 1);
  const openingDate = moveDay(startDate, -1);
  const balances = new Map(input.accounts.map((account) => [account.id, projectAccountBalance(
    account, input.plans, openingDate, input.flexiblePlans, input.cards,
    input.statements, input.installments, input.oneTimePlans,
  )]));
  const events = input.accounts.flatMap((account) => accountEventsThrough(
    account, input.plans, endDate, input.flexiblePlans, input.cards,
    input.statements, input.installments, input.oneTimePlans,
  )).filter((event) => event.date >= startDate)
    // Exact times are unknown. Show the conservative within-day order: outgoing before incoming.
    .sort((left, right) => left.date.localeCompare(right.date)
      || left.amountMinor - right.amountMinor || left.sourceId.localeCompare(right.sourceId));

  let eventIndex = 0;
  let firstShortfallDate: string | null = null;
  let firstAccountShortfallDate: string | null = null;
  const days: DailyCashFlow[] = [];
  const monthEnds: MonthlyProjection[] = [];
  for (let date = startDate; date <= endDate; date = moveDay(date, 1)) {
    const shortfallIds = new Set(negativeSpendingAccountIds(input.accounts, balances));
    let hasTotalShortfall = spendingBalance(input.accounts, balances) < 0;
    const dayEvents: CashFlowEvent[] = [];
    while (eventIndex < events.length && events[eventIndex].date === date) {
      const event = events[eventIndex++];
      dayEvents.push(event);
      balances.set(event.accountId, (balances.get(event.accountId) ?? 0) + event.amountMinor);
      for (const id of negativeSpendingAccountIds(input.accounts, balances)) shortfallIds.add(id);
      if (spendingBalance(input.accounts, balances) < 0) hasTotalShortfall = true;
    }
    const spendingTryMinor = spendingBalance(input.accounts, balances);
    if (!firstShortfallDate && hasTotalShortfall) firstShortfallDate = date;
    if (!firstAccountShortfallDate && shortfallIds.size > 0) firstAccountShortfallDate = date;
    const closingBalances = input.accounts.map((account) => ({
      accountId: account.id, currency: account.currency, balanceMinor: balances.get(account.id) ?? account.balanceMinor,
    }));
    days.push({
      date, events: dayEvents, spendingTryMinor, balances: closingBalances,
      shortfallAccountIds: [...shortfallIds], hasTotalShortfall,
    });
    if (date === monthEnd(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1)) {
      monthEnds.push({ period: date.slice(0, 7), endDate: date, spendingTryMinor, balances: closingBalances });
    }
  }
  const assumptions = [
    'Aynı gün saat bilinmediğinde çıkışlar girişlerden önce uygulanır; gün içi açık ihtiyatlı tahmindir.',
    'Kart harcaması ve taksitler yalnız tahmini ekstre ödemesinde TL çıkışı yaratır; gerçek ekstre bu tahmini bastırır.',
    'Değişken giderler kalan ayda bildirilen tutar, tam gelecek aylarda bütçe olarak ay sonunda uygulanır.',
  ];
  if (input.flexiblePlans.some((plan) => input.accounts.some((account) =>
    account.id === plan.accountId && account.remainingFlexibleMinor === null))) {
    assumptions.push('Bu ay kalan değişken gider tutarı belirtilmeyen hesaplarda ilgili gider tahmine katılmadı.');
  }
  return { startDate, endDate, days, monthEnds, firstShortfallDate, firstAccountShortfallDate, assumptions };
}

export function compareCashFlowScenario(
  input: CashFlowInput, fromDate: Date, months: 3 | 6 | 12, changes: ScenarioChange[],
): ScenarioComparison {
  const startDate = localDateString(fromDate);
  const scenarioInput: CashFlowInput = {
    ...input, oneTimePlans: [...input.oneTimePlans], installments: [...input.installments],
  };
  changes.forEach((change, index) => {
    if (!change.title.trim()) throw new Error('Senaryo başlığı boş olamaz.');
    if (change.kind === 'installment') {
      if (!input.cards.some((card) => card.id === change.cardId)
        || !Number.isSafeInteger(change.totalAmountMinor) || change.totalAmountMinor <= 0
        || !Number.isInteger(change.installmentCount) || change.installmentCount < 1 || change.installmentCount > 120
        || !/^\d{4}-(0[1-9]|1[0-2])$/.test(change.firstStatementPeriod)
        || change.firstStatementPeriod < startDate.slice(0, 7)) {
        throw new Error('Geçersiz senaryo taksiti.');
      }
      scenarioInput.installments.push({
        id: `scenario:${index}`, cardId: change.cardId, title: change.title.trim(),
        totalAmountMinor: change.totalAmountMinor, installmentCount: change.installmentCount,
        firstStatementPeriod: change.firstStatementPeriod,
      });
    } else {
      if (!input.accounts.some((account) => account.id === change.accountId)
        || !Number.isSafeInteger(change.amountMinor) || change.amountMinor <= 0
        || !/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(change.dueOn)
        || localDateString(new Date(`${change.dueOn}T12:00:00`)) !== change.dueOn
        || change.dueOn < startDate) {
        throw new Error('Geçersiz senaryo gelir/gideri.');
      }
      scenarioInput.oneTimePlans.push({
        id: `scenario:${index}`, accountId: change.accountId, title: change.title.trim(),
        kind: change.kind, amountMinor: change.amountMinor, dueOn: change.dueOn,
        status: 'planned', createdAt: fromDate.toISOString(),
      });
    }
  });
  const base = buildCashFlowTimeline(input, fromDate, months);
  const scenario = buildCashFlowTimeline(scenarioInput, fromDate, months);
  scenario.assumptions.push('Senaryo hareketleri geçicidir; kayıtlı plan ve bakiyeler değiştirilmedi.');
  return {
    base, scenario,
    monthlyDeltas: scenario.monthEnds.map((month, index) => ({
      period: month.period,
      spendingTryDeltaMinor: month.spendingTryMinor - base.monthEnds[index].spendingTryMinor,
    })),
  };
}
