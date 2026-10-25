import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { listAccounts, listCardStatements, listCreditCards, listFlexiblePlans, listInstallmentPlans, listOneTimePlans, listPlans } from '@/data/repository';
import { buildCashFlowTimeline } from '@/domain/cashflow';
import { cardPaymentsThrough, formatMoney, projectMonths } from '@/domain/finance';
import type { Account, CardStatement, CreditCard, FlexibleMonthlyPlan, InstallmentPlan, MonthlyPlan, OneTimePlan } from '@/domain/finance';
import { ActionLink, Choice, Notice, PageTitle, SectionCard, palette, sharedStyles } from '@/ui/components';

export default function ForecastScreen() {
  const db = useSQLiteContext();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [plans, setPlans] = useState<MonthlyPlan[]>([]);
  const [flexiblePlans, setFlexiblePlans] = useState<FlexibleMonthlyPlan[]>([]);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [statements, setStatements] = useState<CardStatement[]>([]);
  const [installments, setInstallments] = useState<InstallmentPlan[]>([]);
  const [oneTimePlans, setOneTimePlans] = useState<OneTimePlan[]>([]);
  const [months, setMonths] = useState<3 | 6 | 12>(3);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useFocusEffect(useCallback(() => {
    let active = true;
    Promise.all([listAccounts(db), listPlans(db), listFlexiblePlans(db), listCreditCards(db), listCardStatements(db), listInstallmentPlans(db), listOneTimePlans(db)])
      .then(([nextAccounts, nextPlans, nextFlexiblePlans, nextCards, nextStatements, nextInstallments, nextOneTimePlans]) => {
        if (active) {
          setAccounts(nextAccounts); setPlans(nextPlans); setFlexiblePlans(nextFlexiblePlans);
          setCards(nextCards); setStatements(nextStatements); setInstallments(nextInstallments);
          setOneTimePlans(nextOneTimePlans);
          setError(''); setReady(true);
        }
      })
      .catch(() => { if (active) { setError('Tahmin verileri okunamadı.'); setReady(true); } });
    return () => { active = false; };
  }, [db]));

  const projections = projectMonths(accounts, plans, new Date(), months, flexiblePlans, cards, statements, installments, oneTimePlans);
  const spendingAccounts = accounts.filter((account) => account.currency === 'TRY' && account.purpose === 'spending');
  const missingFlexibleEstimate = flexiblePlans.some((plan) =>
    !plan.endsOn && spendingAccounts.some((account) => account.id === plan.accountId && account.remainingFlexibleMinor === null));
  const hasActivePlan = plans.some((plan) => !plan.endsOn) || flexiblePlans.some((plan) => !plan.endsOn) || cards.length > 0 || oneTimePlans.some((plan) => plan.status === 'planned');
  const firstShortfallDate = useMemo(() => {
    if (!ready || !accounts.some((account) => account.currency === 'TRY' && account.purpose === 'spending')) return null;
    return buildCashFlowTimeline({ accounts, plans, flexiblePlans, cards, statements, installments, oneTimePlans }, new Date(), months).firstShortfallDate;
  }, [ready, accounts, plans, flexiblePlans, cards, statements, installments, oneTimePlans, months]);
  return (
    <ScrollView style={sharedStyles.page} contentContainerStyle={sharedStyles.content}>
      <PageTitle eyebrow="AY SONU GÖRÜNÜMÜ" title="Gelecek aylar" subtitle="Uygulamadaki güncel bakiyelerden başlayan aylık tahmin." />
      <Notice body="Düzenli ve tek seferlik kalemler ile kart ödemeleri tarihlerinde, değişken gider bütçeleri tam gelecek aylarda ay sonunda hesaba katılır. Gerçek ekstre girilen dönemlerde kart tahmini yerine geçer." />
      {error ? <Notice tone="error" body={error} /> : null}
      {!ready ? <Notice body="Tahmin verileri yükleniyor." /> : null}
      {ready && spendingAccounts.length === 0 ? (
        <SectionCard>
          <Text style={sharedStyles.cardTitle}>TL kullanım hesabı ekle</Text>
          <Text style={sharedStyles.helper}>Ay sonu harcanabilir TL tahmini için bir TL kullanım hesabı gerekiyor.</Text>
          <ActionLink href="/accounts" title="Hesaplara git" />
        </SectionCard>
      ) : null}
      {ready && spendingAccounts.length > 0 && !hasActivePlan ? (
        <Notice title="Plan eksik" body="Gelir, gider veya kart eklenene kadar tahmin yalnızca kayıtlı bakiyeden oluşur." tone="warning" />
      ) : null}
      {ready && missingFlexibleEstimate ? (
        <Notice title="Bu ayın tahmini eksik" body="Kalan değişken gider tahmini girilmediği için bu ayın değeri bu harcamaları içermiyor. Bakiyeni güncelleyip kalan tutarı gir." tone="warning" />
      ) : null}
      <Choice<3 | 6 | 12>
        value={months}
        onChange={setMonths}
        options={[{ value: 3, label: '3 ay' }, { value: 6, label: '6 ay' }, { value: 12, label: '12 ay' }]}
      />
      {firstShortfallDate ? (
        <Notice tone="warning" title={`İlk günlük TL açığı: ${firstShortfallDate}`} body="Ay sonu pozitif görünse bile ödeme gününde geçici açık olabilir. Ayrıntı için günlük nakit akışını aç." />
      ) : null}
      {ready && spendingAccounts.length > 0 ? (
        <SectionCard>
          <Text style={sharedStyles.cardTitle}>Daha ayrıntılı bak</Text>
          <Text style={sharedStyles.helper}>Ödeme günlerindeki olası nakit açığını gör veya yeni bir hareketin etkisini geçici olarak dene.</Text>
          <ActionLink href="/cashflow" title="Günlük nakit akışını aç" />
          <ActionLink href="/scenario" title="Geçici senaryo dene" secondary />
        </SectionCard>
      ) : null}
      {ready && spendingAccounts.length > 0 ? projections.map((month, index) => {
        const cardPayments = spendingAccounts.flatMap((account) =>
          cardPaymentsThrough(account, month.endDate, cards, statements, installments))
          .filter((payment) => payment.paymentDate.startsWith(month.period));
        const cardPaymentTotal = cardPayments.reduce((sum, payment) => sum + payment.amountMinor, 0);
        return (
        <SectionCard key={month.period}>
          <Text style={styles.period}>{new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(`${month.period}-01T12:00:00`))}</Text>
          <Text style={styles.total}>{formatMoney(month.spendingTryMinor, 'TRY')}</Text>
          <Text style={sharedStyles.muted}>Ay sonu tahmini harcanabilir TL{index === 0 && missingFlexibleEstimate ? ' · eksik' : ''}</Text>
          {index === 0 && missingFlexibleEstimate ? <Text style={styles.warning}>Kalan değişken gider tahmini bu tutardan düşülmedi.</Text> : null}
          {cards.length > 0 ? (
            <View style={styles.cardImpact}>
              <Text style={styles.cardImpactLabel}>Bu ay hesaba katılan kart ödemesi</Text>
              <Text style={styles.cardImpactAmount}>{formatMoney(cardPaymentTotal, 'TRY')}</Text>
              <Text style={sharedStyles.helper}>Gerçek ekstre varsa planlanan tutar; diğer dönemlerde kart harcaması ve taksit tahmini.</Text>
            </View>
          ) : null}
          <View style={styles.divider} />
          {accounts.map((account) => {
            const balance = month.balances.find((item) => item.accountId === account.id);
            return (
              <View key={account.id} style={[sharedStyles.row, styles.accountRow]}>
                <Text style={styles.accountName}>{account.name}</Text>
                <Text style={styles.accountBalance}>{formatMoney(balance?.balanceMinor ?? 0, account.currency)}</Text>
              </View>
            );
          })}
        </SectionCard>
      ); }) : null}
      {ready && accounts.some((account) => account.currency !== 'TRY') ? (
        <Text style={sharedStyles.helper}>Döviz hesapları kendi para birimlerinde görünür. Kur dönüşümü henüz tahmine katılmıyor.</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  period: { color: palette.primary, fontSize: 13, fontWeight: '800', textTransform: 'capitalize' },
  total: { color: palette.ink, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  warning: { color: palette.warning, fontSize: 12, lineHeight: 18, fontWeight: '600' },
  cardImpact: { backgroundColor: palette.primarySoft, borderRadius: 12, padding: 12, gap: 3 },
  cardImpactLabel: { color: palette.primaryDark, fontSize: 12, fontWeight: '700' },
  cardImpactAmount: { color: palette.ink, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  divider: { height: 1, backgroundColor: palette.border, marginVertical: 3 },
  accountRow: { paddingVertical: 3 },
  accountName: { color: palette.muted, fontSize: 13, flex: 1 },
  accountBalance: { color: palette.ink, fontSize: 13, fontWeight: '700', flexShrink: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
