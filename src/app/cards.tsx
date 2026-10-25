import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  createCardStatement, createCreditCard, createInstallmentPlan, deleteCardStatement,
  deleteCreditCard, deleteInstallmentPlan, listAccounts,
  listCardStatements, listCreditCards, listInstallmentPlans, markCardStatementPaid,
} from '@/data/repository';
import { formatMoney, installmentAmountForPeriod, localDateString, parseAmountMinor } from '@/domain/finance';
import type { Account, CardStatement, CreditCard, InstallmentPlan } from '@/domain/finance';
import { ActionButton, Choice, InlineDelete, Notice, PageTitle, SectionCard, palette, sharedStyles } from '@/ui/components';

function validPeriod(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function validDate(value: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return !Number.isNaN(parsed.getTime()) && localDateString(parsed) === value;
}

export default function CardsScreen() {
  const db = useSQLiteContext();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [statements, setStatements] = useState<CardStatement[]>([]);
  const [installments, setInstallments] = useState<InstallmentPlan[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [savingAction, setSavingAction] = useState<'card' | 'statement' | 'installment' | 'payment' | null>(null);

  const [cardName, setCardName] = useState('');
  const [cardAccountId, setCardAccountId] = useState<string | null>(null);
  const [closingDay, setClosingDay] = useState('1');
  const [paymentDay, setPaymentDay] = useState('10');
  const [monthlyEstimate, setMonthlyEstimate] = useState('0');

  const [statementCardId, setStatementCardId] = useState<string | null>(null);
  const [statementPeriod, setStatementPeriod] = useState(localDateString().slice(0, 7));
  const [dueDate, setDueDate] = useState('');
  const [statementAmount, setStatementAmount] = useState('');
  const [plannedPayment, setPlannedPayment] = useState('');
  const [statementAccountId, setStatementAccountId] = useState<string | null>(null);

  const [installmentCardId, setInstallmentCardId] = useState<string | null>(null);
  const [installmentTitle, setInstallmentTitle] = useState('');
  const [installmentTotal, setInstallmentTotal] = useState('');
  const [installmentCount, setInstallmentCount] = useState('');
  const [firstPeriod, setFirstPeriod] = useState(localDateString().slice(0, 7));
  const [paying, setPaying] = useState<CardStatement | null>(null);
  const [paidAmount, setPaidAmount] = useState('');
  const [paymentConfirming, setPaymentConfirming] = useState(false);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    const [nextAccounts, nextCards, nextStatements, nextInstallments] = await Promise.all([
      listAccounts(db), listCreditCards(db), listCardStatements(db), listInstallmentPlans(db),
    ]);
    setAccounts(nextAccounts);
    setCards(nextCards);
    setStatements(nextStatements);
    setInstallments(nextInstallments);
    const firstTryAccount = nextAccounts.find((account) => account.currency === 'TRY' && account.purpose === 'spending');
    setCardAccountId((current) => current ?? firstTryAccount?.id ?? null);
    setStatementAccountId((current) => current ?? nextCards[0]?.paymentAccountId ?? firstTryAccount?.id ?? null);
    setStatementCardId((current) => nextCards.some((card) => card.id === current) ? current : nextCards[0]?.id ?? null);
    setInstallmentCardId((current) => nextCards.some((card) => card.id === current) ? current : nextCards[0]?.id ?? null);
    setReady(true);
  }, [db]);

  useFocusEffect(useCallback(() => {
    refresh().then(() => setError('')).catch(() => { setError('Kart verileri okunamadı.'); setReady(true); });
  }, [refresh]));

  async function saveCard() {
    const estimate = parseAmountMinor(monthlyEstimate);
    const closing = Number(closingDay);
    const payment = Number(paymentDay);
    if (!cardName.trim() || !cardAccountId || estimate === null || estimate < 0 ||
      !Number.isInteger(closing) || closing < 1 || closing > 31 ||
      !Number.isInteger(payment) || payment < 1 || payment > 31) {
      setError('Kart adı, TL ödeme hesabı, 1–31 arası kesim ve ödeme günleri ile geçerli aylık harcama tahmini gir.');
      return;
    }
    setSavingAction('card');
    setError('');
    try {
      await createCreditCard(db, {
        name: cardName, paymentAccountId: cardAccountId, closingDay: closing,
        paymentDay: payment, monthlySpendingEstimateMinor: estimate,
      });
      setStatementAccountId(cardAccountId);
      setCardName('');
      setMonthlyEstimate('0');
      await refresh();
    } catch {
      setError('Kart kaydedilemedi. Bilgileri kontrol edip tekrar dene.');
    } finally {
      setSavingAction(null);
    }
  }

  async function saveStatement() {
    const actual = parseAmountMinor(statementAmount);
    const planned = parseAmountMinor(plannedPayment);
    if (!statementCardId || !statementAccountId || !validPeriod(statementPeriod) || !validDate(dueDate) ||
      actual === null || actual <= 0 || planned === null || planned < 0 || planned > actual) {
      setError('Kart, YYYY-AA dönem, YYYY-AA-GG son ödeme tarihi, pozitif ekstre ve 0 ile ekstre tutarı arasında planlanan ödeme gir.');
      return;
    }
    setSavingAction('statement');
    setError('');
    try {
      await createCardStatement(db, {
        cardId: statementCardId, statementPeriod, dueDate, actualAmountMinor: actual,
        plannedPaymentMinor: planned, paymentAccountId: statementAccountId,
      });
      setStatementAmount('');
      setPlannedPayment('');
      await refresh();
    } catch {
      setError('Ekstre kaydedilemedi. Aynı kart ve dönem için ekstre olup olmadığını kontrol et.');
    } finally {
      setSavingAction(null);
    }
  }

  async function saveInstallment() {
    const total = parseAmountMinor(installmentTotal);
    const count = Number(installmentCount);
    if (!installmentCardId || !installmentTitle.trim() || total === null || total <= 0 ||
      !Number.isInteger(count) || count < 1 || count > 120 || !validPeriod(firstPeriod)) {
      setError('Taksit için kart, ad, pozitif toplam tutar, 1–120 arası adet ve YYYY-AA ilk dönem gir.');
      return;
    }
    setSavingAction('installment');
    setError('');
    try {
      await createInstallmentPlan(db, {
        cardId: installmentCardId, title: installmentTitle, totalAmountMinor: total,
        installmentCount: count, firstStatementPeriod: firstPeriod,
      });
      setInstallmentTitle('');
      setInstallmentTotal('');
      setInstallmentCount('');
      await refresh();
    } catch {
      setError('Taksit kaydedilemedi. Bilgileri kontrol edip tekrar dene.');
    } finally {
      setSavingAction(null);
    }
  }

  function confirmPayment() {
    if (!paying) return;
    const amount = parseAmountMinor(paidAmount);
    if (amount === null || amount <= 0 || amount > paying.actualAmountMinor) {
      setError('Ödenen tutar 0’dan büyük ve en fazla ekstre tutarı kadar olmalı.');
      return;
    }
    setPaymentConfirming(true);
  }

  async function savePayment() {
    if (!paying) return;
    const amount = parseAmountMinor(paidAmount);
    if (amount === null || amount <= 0 || amount > paying.actualAmountMinor) {
      setPaymentConfirming(false);
      setError('Ödenen tutar 0’dan büyük ve en fazla ekstre tutarı kadar olmalı.');
      return;
    }
    setSavingAction('payment');
    setError('');
    try {
      await markCardStatementPaid(db, paying.id, amount);
      setPaying(null);
      setPaidAmount('');
      setPaymentConfirming(false);
      await refresh();
      setNotice('Ekstre ödemesi kaydedildi.');
    } catch {
      setError('Ödeme kaydedilemedi. Tekrar dene.');
    } finally {
      setSavingAction(null);
    }
  }

  const tryAccounts = accounts.filter((account) => account.currency === 'TRY' && account.purpose === 'spending');
  const cardOptions = cards.map((card) => ({ value: card.id, label: card.name }));
  const accountOptions = tryAccounts.map((account) => ({ value: account.id, label: account.name }));
  const todayPeriod = localDateString().slice(0, 7);

  return (
    <ScrollView style={sharedStyles.page} contentContainerStyle={sharedStyles.content} keyboardShouldPersistTaps="handled">
      <PageTitle eyebrow="KART VE BORÇ" title="Kartlar ve taksitler" subtitle="Ekstreleri, ödemeleri ve aylık kart tahminini takip et." />
      <Notice body="Kart harcaması borç oluşturur. TL hesabından yalnız ekstre ödemesi düşülür; aynı harcama iki kez gider sayılmaz." />
      {!ready ? <Notice body="Kart kayıtları yükleniyor." /> : null}
      {error ? <Notice tone="error" body={error} /> : null}
      {notice ? <Notice body={notice} /> : null}
      {ready && cards.length === 0 ? <Notice title="Henüz kart yok" body="Aşağıdan kart ekleyerek ekstre ve taksit takibine başla. Kart numarası girmen gerekmiyor." /> : null}

      {cards.length > 0 ? <Text style={sharedStyles.sectionTitle}>Kartlarım</Text> : null}
      {cards.map((card) => {
        const paymentAccount = accounts.find((account) => account.id === card.paymentAccountId);
        return (
          <SectionCard key={card.id}>
            <Text style={sharedStyles.cardTitle}>{card.name}</Text>
            <Text style={sharedStyles.muted}>Kesim: ayın {card.closingDay}. günü · Ödeme: ayın {card.paymentDay}. günü</Text>
            <Text style={sharedStyles.muted}>TL ödeme hesabı: {paymentAccount?.name ?? 'Hesap bulunamadı'}</Text>
            <View style={sharedStyles.row}>
              <Text style={styles.rowLabel}>Aylık yeni harcama tahmini</Text>
              <Text style={styles.rowAmount}>{formatMoney(card.monthlySpendingEstimateMinor, 'TRY')}</Text>
            </View>
            <Text style={sharedStyles.helper}>Taksitler bu tahmine ayrıca eklenir. Gerçek ekstre girildiğinde o dönemin tahmini yerine geçer.</Text>
            <InlineDelete itemName="Kartı" onDelete={async () => { await deleteCreditCard(db, card.id); await refresh(); setNotice('Kart silindi.'); }} disabled={savingAction !== null} detail="Kartla ilişkili ekstre ve taksitler varsa önce onları silmelisin." />
          </SectionCard>
        );
      })}

      {statements.length > 0 ? <Text style={sharedStyles.sectionTitle}>Ekstreler</Text> : null}
      {statements.map((statement) => {
        const card = cards.find((item) => item.id === statement.cardId);
        const account = accounts.find((item) => item.id === statement.paymentAccountId);
        const remaining = statement.actualAmountMinor - (statement.paidAmountMinor ?? 0);
        return (
          <SectionCard key={statement.id}>
            <View style={sharedStyles.row}>
              <Text style={styles.rowTitle}>{card?.name ?? 'Kart'} · {statement.statementPeriod}</Text>
              <Text style={[styles.status, statement.status === 'paid' && styles.statusPaid]}>{statement.status === 'paid' ? (remaining > 0 ? 'Kısmi ödeme' : 'Ödendi') : 'Ödeme bekliyor'}</Text>
            </View>
            <View style={sharedStyles.row}><Text style={styles.rowLabel}>Ekstre tutarı</Text><Text style={styles.rowAmount}>{formatMoney(statement.actualAmountMinor, 'TRY')}</Text></View>
            <View style={sharedStyles.row}><Text style={styles.rowLabel}>Planlanan ödeme</Text><Text style={styles.rowAmount}>{formatMoney(statement.plannedPaymentMinor, 'TRY')}</Text></View>
            <Text style={sharedStyles.muted}>Son ödeme: {statement.dueDate} · {account?.name ?? 'Hesap bulunamadı'}</Text>
            {statement.status === 'paid' ? (
              <>
                <Text style={sharedStyles.muted}>Ödenen: {formatMoney(statement.paidAmountMinor ?? 0, 'TRY')} · {statement.paidOn}</Text>
                {remaining > 0 ? (
                  <>
                    <Text style={styles.remaining}>Kalan borç: {formatMoney(remaining, 'TRY')}</Text>
                    <Text style={sharedStyles.helper}>Bu sürümde ek ödeme ayrı kaydedilmez. Sonraki gerçek ekstreyi kalan borcu içeren güncel tutarla gir.</Text>
                  </>
                ) : null}
              </>
            ) : <ActionButton title="Ödemeyi kaydet" secondary onPress={() => { setPaying(statement); setPaidAmount((statement.plannedPaymentMinor / 100).toFixed(2).replace('.', ',')); setPaymentConfirming(false); setError(''); }} />}
            <InlineDelete itemName="Ekstreyi" onDelete={async () => { await deleteCardStatement(db, statement.id); await refresh(); setNotice('Ekstre silindi.'); }} disabled={savingAction !== null} detail="Ekstre, ödeme işareti ve bu döneme ait gerçek tutar tahminden çıkarılır." />
          </SectionCard>
        );
      })}
      {paying ? (
        <SectionCard>
          <Text style={sharedStyles.cardTitle}>Gerçekleşen ödemeyi gir</Text>
          <Text style={sharedStyles.helper}>Gerçekleşen ödeme TL hesabının tahminine yansır. Eksik ödemede kalan borç görünür; faiz otomatik hesaplanmaz.</Text>
          <Text style={sharedStyles.label}>Ödenen tutar (TL)</Text>
          <TextInput accessibilityLabel="Gerçekleşen ekstre ödeme tutarı" value={paidAmount} onChangeText={setPaidAmount} keyboardType="decimal-pad" placeholder="Örnek: 5000,00" style={sharedStyles.input} />
          {paymentConfirming ? (
            <View style={styles.confirmBox}>
              <Text style={sharedStyles.cardTitle}>{formatMoney(parseAmountMinor(paidAmount) ?? 0, 'TRY')} ödeme kaydedilsin mi?</Text>
              <Text style={sharedStyles.helper}>Bu tutar ekstreye ve ödeme hesabının tahminine yansır.</Text>
              <ActionButton title="Evet, ödemeyi kaydet" onPress={savePayment} disabled={savingAction !== null} loading={savingAction === 'payment'} />
              <ActionButton title="Geri dön" secondary onPress={() => setPaymentConfirming(false)} disabled={savingAction !== null} />
            </View>
          ) : <ActionButton title="Ödemeyi onayla" onPress={confirmPayment} disabled={savingAction !== null} />}
          <ActionButton title="Vazgeç" secondary onPress={() => { setPaying(null); setPaidAmount(''); setPaymentConfirming(false); }} disabled={savingAction !== null} />
        </SectionCard>
      ) : null}

      {installments.length > 0 ? <Text style={sharedStyles.sectionTitle}>Taksitler</Text> : null}
      {installments.map((plan) => {
        const card = cards.find((item) => item.id === plan.cardId);
        const currentAmount = installmentAmountForPeriod(plan, todayPeriod);
        return (
          <SectionCard key={plan.id}>
            <View style={sharedStyles.row}><Text style={styles.rowTitle}>{plan.title}</Text><Text style={styles.rowAmount}>{formatMoney(plan.totalAmountMinor, 'TRY')}</Text></View>
            <Text style={sharedStyles.muted}>{card?.name ?? 'Kart'} · {plan.installmentCount} taksit · İlk ekstre {plan.firstStatementPeriod}</Text>
            {currentAmount > 0 ? <Text style={sharedStyles.helper}>Bu dönemin taksiti: {formatMoney(currentAmount, 'TRY')}</Text> : null}
            <InlineDelete itemName="Taksiti" onDelete={async () => { await deleteInstallmentPlan(db, plan.id); await refresh(); setNotice('Taksit silindi.'); }} disabled={savingAction !== null} />
          </SectionCard>
        );
      })}

      <Text style={sharedStyles.sectionTitle}>Yeni kayıt</Text>
      <SectionCard>
        <Text style={sharedStyles.cardTitle}>Kart ekle</Text>
        {tryAccounts.length ? (
          <>
            <Text style={sharedStyles.label}>Kart adı</Text>
            <TextInput accessibilityLabel="Kart adı" value={cardName} onChangeText={setCardName} placeholder="Örnek: Günlük kartım" style={sharedStyles.input} />
            <Text style={sharedStyles.label}>TL ödeme hesabı</Text>
            <Choice<string> value={cardAccountId ?? tryAccounts[0].id} onChange={setCardAccountId} options={accountOptions} />
            <Text style={sharedStyles.label}>Hesap kesim günü</Text>
            <TextInput accessibilityLabel="Hesap kesim günü" value={closingDay} onChangeText={setClosingDay} keyboardType="number-pad" placeholder="1–31" style={sharedStyles.input} />
            <Text style={sharedStyles.label}>Son ödeme günü</Text>
            <TextInput accessibilityLabel="Son ödeme günü" value={paymentDay} onChangeText={setPaymentDay} keyboardType="number-pad" placeholder="1–31" style={sharedStyles.input} />
            <Text style={sharedStyles.label}>Aylık yeni kart harcaması tahmini (TL)</Text>
            <TextInput accessibilityLabel="Aylık yeni kart harcaması tahmini" value={monthlyEstimate} onChangeText={setMonthlyEstimate} keyboardType="decimal-pad" placeholder="Örnek: 3000,00" style={sharedStyles.input} />
            <Text style={sharedStyles.helper}>Taksitlerini ayrıca gireceksen bu tutara katma. Tahminin yoksa 0 yaz.</Text>
            <ActionButton title="Kartı kaydet" onPress={saveCard} disabled={savingAction !== null} loading={savingAction === 'card'} />
          </>
        ) : <Text style={sharedStyles.helper}>Kart eklemek için önce bir TL kullanım hesabı oluştur.</Text>}
      </SectionCard>

      {cards.length > 0 ? (
        <SectionCard>
          <Text style={sharedStyles.cardTitle}>Gerçek ekstre gir</Text>
          <Text style={sharedStyles.helper}>Gerçek tutar bu dönemin kart harcaması ve taksit tahmininin yerine geçer.</Text>
          <Text style={sharedStyles.label}>Kart</Text>
          <Choice<string> value={statementCardId ?? cards[0].id} onChange={(value) => {
            setStatementCardId(value);
            setStatementAccountId(cards.find((card) => card.id === value)?.paymentAccountId ?? null);
          }} options={cardOptions} />
          <Text style={sharedStyles.label}>Ekstre dönemi (YYYY-AA)</Text>
          <TextInput accessibilityLabel="Ekstre dönemi" value={statementPeriod} onChangeText={setStatementPeriod} placeholder="2026-10" style={sharedStyles.input} />
          <Text style={sharedStyles.label}>Son ödeme tarihi (YYYY-AA-GG)</Text>
          <TextInput accessibilityLabel="Ekstre son ödeme tarihi" value={dueDate} onChangeText={setDueDate} placeholder="2026-11-10" style={sharedStyles.input} />
          <Text style={sharedStyles.label}>Gerçek ekstre tutarı (TL)</Text>
          <TextInput accessibilityLabel="Gerçek ekstre tutarı" value={statementAmount} onChangeText={setStatementAmount} keyboardType="decimal-pad" placeholder="Örnek: 6500,00" style={sharedStyles.input} />
          <Text style={sharedStyles.label}>Planlanan ödeme (TL)</Text>
          <TextInput accessibilityLabel="Planlanan ekstre ödeme tutarı" value={plannedPayment} onChangeText={setPlannedPayment} keyboardType="decimal-pad" placeholder="Örnek: 6500,00" style={sharedStyles.input} />
          <Text style={sharedStyles.label}>Ödemenin çıkacağı TL hesabı</Text>
          <Choice<string> value={statementAccountId ?? tryAccounts[0].id} onChange={setStatementAccountId} options={accountOptions} />
          <ActionButton title="Ekstreyi kaydet" onPress={saveStatement} disabled={savingAction !== null} loading={savingAction === 'statement'} />
        </SectionCard>
      ) : null}

      {cards.length > 0 ? (
        <SectionCard>
          <Text style={sharedStyles.cardTitle}>Taksit ekle</Text>
          <Text style={sharedStyles.helper}>Toplam tutar taksit sayısına bölünür ve ilgili ekstre dönemlerine eklenir. Aynı taksiti aylık kart harcaması tahminine katma.</Text>
          <Text style={sharedStyles.label}>Kart</Text>
          <Choice<string> value={installmentCardId ?? cards[0].id} onChange={setInstallmentCardId} options={cardOptions} />
          <Text style={sharedStyles.label}>Taksit adı</Text>
          <TextInput accessibilityLabel="Taksit adı" value={installmentTitle} onChangeText={setInstallmentTitle} placeholder="Örnek: Bilgisayar" style={sharedStyles.input} />
          <Text style={sharedStyles.label}>Toplam tutar (TL)</Text>
          <TextInput accessibilityLabel="Taksit toplam tutarı" value={installmentTotal} onChangeText={setInstallmentTotal} keyboardType="decimal-pad" placeholder="Örnek: 12000,00" style={sharedStyles.input} />
          <Text style={sharedStyles.label}>Taksit sayısı</Text>
          <TextInput accessibilityLabel="Taksit sayısı" value={installmentCount} onChangeText={setInstallmentCount} keyboardType="number-pad" placeholder="Örnek: 6" style={sharedStyles.input} />
          <Text style={sharedStyles.label}>İlk ekstre dönemi (YYYY-AA)</Text>
          <TextInput accessibilityLabel="Taksitin ilk ekstre dönemi" value={firstPeriod} onChangeText={setFirstPeriod} placeholder="2026-10" style={sharedStyles.input} />
          <ActionButton title="Taksiti kaydet" onPress={saveInstallment} disabled={savingAction !== null} loading={savingAction === 'installment'} />
        </SectionCard>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  rowTitle: { color: palette.ink, fontSize: 16, fontWeight: '700', flex: 1 },
  rowLabel: { color: palette.muted, fontSize: 13, flex: 1 },
  rowAmount: { color: palette.ink, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right' },
  status: { color: palette.warning, backgroundColor: palette.warningSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, overflow: 'hidden', fontSize: 11, fontWeight: '700' },
  statusPaid: { color: palette.positive, backgroundColor: palette.positiveSoft },
  remaining: { color: palette.negative, fontSize: 13, fontWeight: '700' },
  confirmBox: { backgroundColor: palette.primarySoft, borderRadius: 12, padding: 12, gap: 9 },
});
