import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  listAccounts, listCardStatements, listCreditCards, listFlexiblePlans,
  listInstallmentPlans, listOneTimePlans, listPlans,
} from '@/data/repository';
import { compareCashFlowScenario } from '@/domain/cashflow';
import type { CashFlowInput, ScenarioChange, ScenarioComparison } from '@/domain/cashflow';
import { formatMoney, localDateString, parseAmountMinor } from '@/domain/finance';
import { ActionButton, ActionLink, Choice, Notice, PageTitle, SectionCard, palette, sharedStyles } from '@/ui/components';

type ScenarioKind = ScenarioChange['kind'];

function validDate(value: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return !Number.isNaN(parsed.getTime()) && localDateString(parsed) === value;
}

function readableMonth(value: string): string {
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(`${value}-01T12:00:00`));
}

export default function ScenarioScreen() {
  const db = useSQLiteContext();
  const [input, setInput] = useState<CashFlowInput | null>(null);
  const [months, setMonths] = useState<3 | 6 | 12>(3);
  const [kind, setKind] = useState<ScenarioKind>('income');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [dueOn, setDueOn] = useState(localDateString());
  const [installmentCount, setInstallmentCount] = useState('');
  const [firstPeriod, setFirstPeriod] = useState(localDateString().slice(0, 7));
  const [comparison, setComparison] = useState<ScenarioComparison | null>(null);
  const [selectedMonthIndex, setSelectedMonthIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useFocusEffect(useCallback(() => {
    let active = true;
    setComparison(null);
    setSelectedMonthIndex(0);
    Promise.all([
      listAccounts(db), listPlans(db), listFlexiblePlans(db), listCreditCards(db),
      listCardStatements(db), listInstallmentPlans(db), listOneTimePlans(db),
    ]).then(([accounts, plans, flexiblePlans, cards, statements, installments, oneTimePlans]) => {
      if (!active) return;
      setInput({ accounts, plans, flexiblePlans, cards, statements, installments, oneTimePlans });
      setAccountId((current) => current ?? accounts[0]?.id ?? null);
      setCardId((current) => current ?? cards[0]?.id ?? null);
      setReady(true);
      setError('');
    }).catch(() => { if (active) { setReady(true); setError('Senaryo verileri okunamadı. Tekrar açmayı dene.'); } });
    return () => { active = false; };
  }, [db]));

  function resetResult() {
    setComparison(null);
    setSelectedMonthIndex(0);
    setError('');
  }

  function calculate() {
    if (!input || !title.trim()) {
      setError('Senaryo adı ve hesap veya kart bilgisi gir.');
      return;
    }
    const parsedAmount = parseAmountMinor(amount);
    if (parsedAmount === null || parsedAmount <= 0) {
      setError('Sıfırdan büyük geçerli bir tutar gir.');
      return;
    }
    let change: ScenarioChange;
    if (kind === 'installment') {
      const count = Number(installmentCount);
      if (!cardId || !Number.isInteger(count) || count < 1 || count > 120
        || !/^\d{4}-(0[1-9]|1[0-2])$/.test(firstPeriod)
        || firstPeriod < localDateString().slice(0, 7)) {
        setError('Kart, 1–120 arası taksit sayısı ve bu ay veya sonrasına ait YYYY-AA dönemi gir.');
        return;
      }
      change = { kind: 'installment', cardId, title, totalAmountMinor: parsedAmount, installmentCount: count, firstStatementPeriod: firstPeriod };
    } else {
      if (!accountId || !validDate(dueOn) || dueOn < localDateString()) {
        setError('Hesap ve bugün veya sonrasına ait YYYY-AA-GG tarihi gir.');
        return;
      }
      change = { kind, accountId, title, amountMinor: parsedAmount, dueOn };
    }
    try {
      setComparison(compareCashFlowScenario(input, new Date(), months, [change]));
      setSelectedMonthIndex(0);
      setError('');
    } catch {
      setComparison(null);
      setError('Senaryo hesaplanamadı. Tarih, hesap ve tutarı kontrol et.');
    }
  }

  const selectedAccount = input?.accounts.find((account) => account.id === accountId);
  const selectedMonth = comparison?.monthlyDeltas[selectedMonthIndex];
  const baseMonth = comparison?.base.monthEnds[selectedMonthIndex];
  const scenarioMonth = comparison?.scenario.monthEnds[selectedMonthIndex];
  const hasAccount = (input?.accounts.length ?? 0) > 0;
  const hasCard = (input?.cards.length ?? 0) > 0;

  return (
    <ScrollView style={sharedStyles.page} contentContainerStyle={sharedStyles.content} keyboardShouldPersistTaps="handled">
      <PageTitle eyebrow="GEÇİCİ DENEME" title="Senaryo" subtitle="Yeni bir hareketin gelecek aylara etkisini gör." />
      <Notice body="Bu deneme kayıtlı planı veya bakiyeyi değiştirmez. Ekranı kapatınca senaryo silinir; sonuç gerçek ödeme sözü değildir." />
      {!ready ? <Notice body="Senaryo verileri yükleniyor." /> : null}
      {error ? <Notice tone="error" body={error} /> : null}
      {ready && !hasAccount ? (
        <SectionCard>
          <Text style={sharedStyles.cardTitle}>Önce hesap ekle</Text>
          <Text style={sharedStyles.helper}>Gelir ve gider denemesi için bir hesap gerekiyor.</Text>
          <ActionLink href="/accounts" title="Hesaplara git" />
        </SectionCard>
      ) : null}

      {ready && hasAccount ? (
        <SectionCard>
          <Text style={sharedStyles.cardTitle}>Neyi denemek istiyorsun?</Text>
          <Text style={sharedStyles.label}>Hareket türü</Text>
          <Choice<ScenarioKind> value={kind} onChange={(value) => { setKind(value); resetResult(); }} options={[{ value: 'income', label: 'Yeni gelir' }, { value: 'expense', label: 'Yeni gider' }, { value: 'installment', label: 'Yeni taksit' }]} />
          {kind === 'installment' && !hasCard ? (
            <Notice tone="warning" body="Taksit denemesi için önce bir kart ekle." />
          ) : null}
          <Text style={sharedStyles.label}>Adı</Text>
          <TextInput accessibilityLabel="Senaryo adı" value={title} onChangeText={(value) => { setTitle(value); resetResult(); }} placeholder={kind === 'installment' ? 'Örnek: Yeni bilgisayar' : 'Örnek: Prim veya yeni gider'} style={sharedStyles.input} />
          {kind === 'installment' ? (
            <>
              {hasCard ? (
                <>
                  <Text style={sharedStyles.label}>Kart</Text>
                  <Choice<string> value={cardId ?? input!.cards[0].id} onChange={(value) => { setCardId(value); resetResult(); }} options={input!.cards.map((card) => ({ value: card.id, label: card.name }))} />
                </>
              ) : <ActionLink href="/cards" title="Kart ekle" />}
              <Text style={sharedStyles.label}>Toplam taksit tutarı (TL)</Text>
              <TextInput accessibilityLabel="Senaryo toplam taksit tutarı" value={amount} onChangeText={(value) => { setAmount(value); resetResult(); }} keyboardType="decimal-pad" placeholder="Örnek: 12000,00" style={sharedStyles.input} />
              <Text style={sharedStyles.label}>Taksit sayısı</Text>
              <TextInput accessibilityLabel="Senaryo taksit sayısı" value={installmentCount} onChangeText={(value) => { setInstallmentCount(value); resetResult(); }} keyboardType="number-pad" placeholder="Örnek: 6" style={sharedStyles.input} />
              <Text style={sharedStyles.label}>İlk ekstre dönemi (YYYY-AA)</Text>
              <TextInput accessibilityLabel="Senaryo ilk ekstre dönemi" value={firstPeriod} onChangeText={(value) => { setFirstPeriod(value); resetResult(); }} placeholder="2026-10" style={sharedStyles.input} />
              <Text style={sharedStyles.helper}>Taksit, kartın mevcut tahminiyle aynı ekstre ödemesinde toplanır. Gerçek ekstre varsa o dönemin tutarı esas alınır.</Text>
            </>
          ) : (
            <>
              <Text style={sharedStyles.label}>Hesap</Text>
              <Choice<string> value={accountId ?? input!.accounts[0].id} onChange={(value) => { setAccountId(value); resetResult(); }} options={input!.accounts.map((account) => ({ value: account.id, label: `${account.name} (${account.currency})` }))} />
              <Text style={sharedStyles.label}>Tutar ({selectedAccount?.currency ?? 'TL'})</Text>
              <TextInput accessibilityLabel="Senaryo gelir veya gider tutarı" value={amount} onChangeText={(value) => { setAmount(value); resetResult(); }} keyboardType="decimal-pad" placeholder="Örnek: 2500,00" style={sharedStyles.input} />
              <Text style={sharedStyles.label}>Tarih (YYYY-AA-GG)</Text>
              <TextInput accessibilityLabel="Senaryo hareket tarihi" value={dueOn} onChangeText={(value) => { setDueOn(value); resetResult(); }} placeholder="2026-10-26" style={sharedStyles.input} />
              <Text style={sharedStyles.helper}>Döviz hesabındaki deneme kaynak para biriminde kalır; bozdurulmadıkça harcanabilir TL artmaz.</Text>
            </>
          )}
          <Text style={sharedStyles.label}>Görünüm süresi</Text>
          <Choice<3 | 6 | 12> value={months} onChange={(value) => { setMonths(value); resetResult(); }} options={[{ value: 3, label: '3 ay' }, { value: 6, label: '6 ay' }, { value: 12, label: '12 ay' }]} />
          <ActionButton title="Temel planla karşılaştır" onPress={calculate} disabled={kind === 'installment' && !hasCard} />
        </SectionCard>
      ) : null}

      {comparison ? (
        <>
          <SectionCard>
            <Text style={sharedStyles.cardTitle}>Ay sonu TL farkı</Text>
            <Text style={sharedStyles.helper}>Her satır senaryo eklendiğinde harcanabilir TL’nin temel plana göre değişimini gösterir.</Text>
            {comparison.monthlyDeltas.map((month, index) => (
              <Pressable key={month.period} accessibilityRole="button" accessibilityLabel={`${readableMonth(month.period)} farkı ${formatMoney(month.spendingTryDeltaMinor, 'TRY')}`} accessibilityState={{ selected: index === selectedMonthIndex }} onPress={() => setSelectedMonthIndex(index)} style={({ pressed }) => [styles.monthRow, index === selectedMonthIndex && styles.monthRowSelected, pressed && styles.monthRowPressed]}>
                <Text style={styles.monthLabel}>{readableMonth(month.period)}</Text>
                <Text style={[styles.delta, month.spendingTryDeltaMinor < 0 && styles.negative]}>{month.spendingTryDeltaMinor > 0 ? '+' : ''}{formatMoney(month.spendingTryDeltaMinor, 'TRY')}</Text>
              </Pressable>
            ))}
          </SectionCard>
          {selectedMonth && baseMonth && scenarioMonth ? (
            <SectionCard>
              <Text style={sharedStyles.cardTitle}>{readableMonth(selectedMonth.period)} ayrıntısı</Text>
              <View style={sharedStyles.row}><Text style={styles.detailLabel}>Temel plan</Text><Text style={styles.detailAmount}>{formatMoney(baseMonth.spendingTryMinor, 'TRY')}</Text></View>
              <View style={sharedStyles.row}><Text style={styles.detailLabel}>Senaryo ile</Text><Text style={styles.detailAmount}>{formatMoney(scenarioMonth.spendingTryMinor, 'TRY')}</Text></View>
              <View style={sharedStyles.row}><Text style={styles.detailLabel}>Fark</Text><Text style={[styles.detailAmount, selectedMonth.spendingTryDeltaMinor < 0 && styles.negative]}>{formatMoney(selectedMonth.spendingTryDeltaMinor, 'TRY')}</Text></View>
              <Text style={sharedStyles.helper}>İlk toplam nakit açığı: temel planda {comparison.base.firstShortfallDate ?? 'yok'}, senaryoda {comparison.scenario.firstShortfallDate ?? 'yok'}.</Text>
            </SectionCard>
          ) : null}
          <Notice body="Senaryo geçicidir. Bu ekrandan ayrılınca gerçek plan ve bakiye aynı kalır." />
        </>
      ) : null}
      <ActionLink href="/forecast" title="Gelecek aylara dön" secondary />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  monthRow: { minHeight: 48, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  monthRowSelected: { backgroundColor: palette.primarySoft },
  monthRowPressed: { backgroundColor: palette.mintPressed },
  monthLabel: { color: palette.ink, fontSize: 14, fontWeight: '700', textTransform: 'capitalize', flex: 1 },
  delta: { color: palette.positive, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'], flexShrink: 1 },
  negative: { color: palette.negative },
  detailLabel: { color: palette.muted, fontSize: 14, flex: 1 },
  detailAmount: { color: palette.ink, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'], flexShrink: 1 },
});
