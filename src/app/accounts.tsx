import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { createAccount, deleteAccount, deleteLatestObservedSnapshot, latestSnapshot, listAccounts, listFlexiblePlans, listPriceQuotes, listSnapshots, updateBalance } from '@/data/repository';
import { formatMoney, parseAmountMinor } from '@/domain/finance';
import { valueForeignAccountTry } from '@/domain/valuation';
import type { Account, AccountPurpose, BalanceSnapshot, Currency, FlexibleMonthlyPlan } from '@/domain/finance';
import type { PriceQuote } from '@/domain/valuation';
import { ActionButton, ActionLink, Choice, InlineDelete, Notice, PageTitle, SectionCard, palette, sharedStyles } from '@/ui/components';

type SnapshotMap = Record<string, BalanceSnapshot | null>;
type SnapshotHistoryMap = Record<string, BalanceSnapshot[]>;

export default function AccountsScreen() {
  const db = useSQLiteContext();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [ready, setReady] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotMap>({});
  const [snapshotHistory, setSnapshotHistory] = useState<SnapshotHistoryMap>({});
  const [flexiblePlans, setFlexiblePlans] = useState<FlexibleMonthlyPlan[]>([]);
  const [quotes, setQuotes] = useState<PriceQuote[]>([]);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<Currency>('TRY');
  const [purpose, setPurpose] = useState<AccountPurpose>('spending');
  const [openingBalance, setOpeningBalance] = useState('');
  const [editing, setEditing] = useState<Account | null>(null);
  const [newBalance, setNewBalance] = useState('');
  const [remainingFlexible, setRemainingFlexible] = useState('');
  const [balanceExplanation, setBalanceExplanation] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [savingAction, setSavingAction] = useState<'account' | 'balance' | null>(null);
  const needsRemainingFlexible = editing?.currency === 'TRY' && editing.purpose === 'spending'
    && flexiblePlans.some((plan) => plan.accountId === editing.id && !plan.endsOn);

  const refresh = useCallback(async () => {
    const [nextAccounts, nextFlexiblePlans, nextQuotes] = await Promise.all([listAccounts(db), listFlexiblePlans(db), listPriceQuotes(db)]);
    const nextSnapshots = await Promise.all(nextAccounts.map((account) => latestSnapshot(db, account.id)));
    const nextHistory = await Promise.all(nextAccounts.map((account) => listSnapshots(db, account.id)));
    setAccounts(nextAccounts);
    setFlexiblePlans(nextFlexiblePlans);
    setQuotes(nextQuotes);
    setSnapshots(Object.fromEntries(nextAccounts.map((account, index) => [account.id, nextSnapshots[index]])));
    setSnapshotHistory(Object.fromEntries(nextAccounts.map((account, index) => [account.id, nextHistory[index]])));
    setReady(true);
  }, [db]);

  useFocusEffect(useCallback(() => {
    refresh().catch(() => { setError('Hesaplar okunamadı.'); setReady(true); });
  }, [refresh]));

  async function saveAccount() {
    const amount = parseAmountMinor(openingBalance);
    if (!name.trim() || amount === null) {
      setError('Hesap adı ve geçerli bir bakiye girin. Örnek: 1250,50');
      return;
    }
    setSavingAction('account');
    setError('');
    try {
      await createAccount(db, { name, currency, purpose, balanceMinor: amount });
      setName('');
      setOpeningBalance('');
      await refresh();
    } catch {
      setError('Hesap kaydedilemedi. Tekrar deneyin.');
    } finally {
      setSavingAction(null);
    }
  }

  async function saveBalance() {
    if (!editing) return;
    const amount = parseAmountMinor(newBalance);
    const remaining = needsRemainingFlexible ? parseAmountMinor(remainingFlexible) : null;
    if (amount === null || (needsRemainingFlexible && (remaining === null || remaining < 0))) {
      setError(needsRemainingFlexible
        ? 'Yeni bakiye ve ayın kalanındaki değişken gider için geçerli tutarlar girin. Gider yoksa 0 yazın.'
        : 'Geçerli bir yeni bakiye girin.');
      return;
    }
    setSavingAction('balance');
    setError('');
    try {
      const snapshot = await updateBalance(db, editing, amount, remaining, balanceExplanation.trim() || null);
      setEditing(null);
      setNewBalance('');
      setRemainingFlexible('');
      setBalanceExplanation('');
      await refresh();
      const difference = snapshot.differenceMinor ?? 0;
      setNotice(`Bakiye güncellendi. Önceki tahmine göre fark: ${formatMoney(difference, editing.currency)}. Bu fark tek başına harcama olarak sınıflandırılmaz.`);
    } catch {
      setError('Bakiye güncellenemedi. Tekrar deneyin.');
    } finally {
      setSavingAction(null);
    }
  }

  return (
    <ScrollView style={sharedStyles.page} contentContainerStyle={sharedStyles.content} keyboardShouldPersistTaps="handled">
      <PageTitle eyebrow="BAKİYELER" title="Hesaplar" subtitle="Paranı hesabında bulunduğu para birimiyle takip et." />
      {!ready ? <Notice body="Hesaplar yükleniyor." /> : null}
      {error ? <Notice tone="error" body={error} /> : null}
      {notice ? <Notice body={notice} /> : null}
      <ActionLink href="/transfers" title="Hesaplar arası TL aktar" secondary />
      {ready && accounts.length === 0 ? (
        <Notice title="Henüz hesap yok" body="İlk hesabını ve güncel bakiyesini aşağıdaki formdan ekle." />
      ) : null}
      {accounts.length > 0 ? <Text style={sharedStyles.sectionTitle}>Kayıtlı hesaplar</Text> : null}
      {accounts.map((account) => {
        const snapshot = snapshots[account.id];
        const hasFlexiblePlan = flexiblePlans.some((plan) => plan.accountId === account.id && !plan.endsOn);
        const difference = snapshot?.differenceMinor;
        const quote = account.currency === 'TRY' ? undefined : quotes.find((item) => item.assetCode === account.currency);
        const tryValue = account.currency === 'TRY' ? null : valueForeignAccountTry(account, quote);
        return (
          <SectionCard key={account.id}>
            <View style={sharedStyles.row}>
              <Text style={[sharedStyles.cardTitle, styles.accountName]}>{account.name}</Text>
              <Text style={styles.badge}>{account.purpose === 'savings' ? 'Birikim' : 'Kullanım'}</Text>
            </View>
            <Text style={styles.balance}>{formatMoney(account.balanceMinor, account.currency)}</Text>
            <Text style={sharedStyles.muted}>Uygulamadaki bakiye · Son gerçek bakiye kontrolü: {account.balanceDate}</Text>
            {account.currency !== 'TRY' ? (
              <View style={styles.valuation}>
                <Text style={styles.valuationLabel}>YAKLAŞIK TL KARŞILIĞI</Text>
                <Text style={styles.valuationAmount}>{tryValue === null ? '—' : formatMoney(tryValue, 'TRY')}</Text>
                <Text style={sharedStyles.helper}>{quote
                  ? `Son başarılı fiyat alımı: ${quote.fetchedAt} · Piyasa zamanı: ${quote.quotedAt} · Kaynak: ${quote.source}`
                  : 'Fiyat henüz alınamadı. Döviz miktarı kendi para biriminde saklanıyor.'}</Text>
              </View>
            ) : null}
            {difference !== null && difference !== undefined ? (
              <View style={[styles.difference, difference < 0 ? styles.differenceNegative : styles.differencePositive]}>
                <Text style={styles.differenceLabel}>SON GÜNCELLEMEDE TAHMİNE GÖRE FARK</Text>
                <Text style={[styles.differenceAmount, difference < 0 ? styles.negativeText : styles.positiveText]}>
                  {formatMoney(difference, account.currency)}
                </Text>
              </View>
            ) : null}
            {hasFlexiblePlan && account.remainingFlexibleMinor === null ? (
              <Text style={sharedStyles.helper}>Bu ayın kalan değişken harcaması henüz belirtilmedi.</Text>
            ) : null}
            <ActionButton
              title="Bakiyeyi güncelle"
              secondary
              onPress={() => {
                setEditing(account);
                setNewBalance('');
                setRemainingFlexible(account.remainingFlexibleMinor === null ? '' : (account.remainingFlexibleMinor / 100).toFixed(2).replace('.', ','));
                setBalanceExplanation('');
                setError('');
              }}
            />
            <InlineDelete itemName="Hesabı" onDelete={async () => { await deleteAccount(db, account.id); if (editing?.id === account.id) setEditing(null); await refresh(); setNotice('Hesap silindi.'); }} disabled={savingAction !== null} detail="Hesaba bağlı plan, kart, dönüşüm veya başka kayıt varsa önce onları silmelisin." />
            {(snapshotHistory[account.id]?.length ?? 0) > 0 ? (
              <View style={styles.history}>
                <Text style={sharedStyles.cardTitle}>Bakiye geçmişi</Text>
                <Text style={sharedStyles.helper}>Bakiye girişleri ve uygulama içi işlemler burada görünür. Yalnız güvenle geri alınabilen son bakiye girişi silinir; harcama ve dönüşümleri ilgili ekrandan yönet.</Text>
                {snapshotHistory[account.id].map((entry) => (
                  <View key={entry.id} style={styles.historyItem}>
                    <Text style={styles.historyAmount}>{formatMoney(entry.actualMinor, account.currency)} · {entry.observedOn}</Text>
                    <Text style={sharedStyles.muted}>{entry.kind === 'conversion' ? 'Bozdurma veya satış sonrası bakiye' : entry.kind === 'expense' ? 'Gerçek harcama sonrası bakiye' : (entry.kind as string) === 'transfer' ? 'Hesaplar arası aktarım sonrası bakiye' : 'Girilen bakiye'}</Text>
                    {entry.kind === 'observed' && entry.explanation ? <Text style={sharedStyles.helper}>Fark açıklaması: {entry.explanation}</Text> : null}
                    {entry.kind === 'observed' ? (
                      <InlineDelete itemName="Bakiye kaydını" onDelete={async () => { await deleteLatestObservedSnapshot(db, entry.id); await refresh(); setNotice('Son bakiye girişi silindi; hesap önceki bakiyeye döndü.'); }} disabled={savingAction !== null} detail="Yalnız en son bakiye girişi, arada bozdurma veya satış yoksa geri alınabilir." />
                    ) : entry.kind === 'expense'
                      ? <ActionLink href="/plan" title="Harcamayı gider planında gör" secondary />
                      : (entry.kind as string) === 'transfer'
                        ? <ActionLink href="/transfers" title="Aktarımı hesap geçmişinde gör" secondary />
                      : <ActionLink href="/savings" title="İşlemi birikim geçmişinde gör" secondary />}
                  </View>
                ))}
              </View>
            ) : null}
          </SectionCard>
        );
      })}
      {editing ? (
        <SectionCard>
          <Text style={sharedStyles.cardTitle}>{editing.name} bakiyesini güncelle</Text>
          <Text style={sharedStyles.helper}>Girdiğin bakiye yeni başlangıç noktası olur; eski tahminle farkı ayrıca görünür.</Text>
          <Text style={sharedStyles.label}>Şu anki bakiye</Text>
          <TextInput
            accessibilityLabel="Yeni bakiye"
            value={newBalance}
            onChangeText={setNewBalance}
            keyboardType="decimal-pad"
            placeholder="Örnek: 1250,50"
            style={sharedStyles.input}
          />
          {needsRemainingFlexible ? (
            <>
              <Text style={sharedStyles.label}>Bu ayın kalanında yaklaşık değişken harcama</Text>
              <TextInput
                accessibilityLabel="Ayın kalanında beklenen değişken harcama"
                value={remainingFlexible}
                onChangeText={setRemainingFlexible}
                keyboardType="decimal-pad"
                placeholder="Örnek: 2500,00"
                style={sharedStyles.input}
              />
              <Text style={sharedStyles.helper}>Market, ulaşım gibi tarihsiz giderlerin kalan tahmini. Beklemiyorsan 0 yaz.</Text>
            </>
          ) : null}
          <Text style={sharedStyles.label}>Tahmin farkının nedeni (isteğe bağlı)</Text>
          <TextInput
            accessibilityLabel="Bakiye farkının nedeni"
            value={balanceExplanation}
            onChangeText={setBalanceExplanation}
            placeholder="Örnek: Unuttuğum market harcaması"
            style={sharedStyles.input}
          />
          <Text style={sharedStyles.helper}>Açıklama, bu bakiye güncellemesinin geçmişinde saklanır.</Text>
          <ActionButton title="Yeni bakiyeyi kaydet" onPress={saveBalance} disabled={savingAction !== null} loading={savingAction === 'balance'} />
          <ActionButton title="Vazgeç" onPress={() => { setEditing(null); setError(''); }} secondary />
        </SectionCard>
      ) : null}
      <SectionCard>
        <Text style={sharedStyles.cardTitle}>Yeni hesap ekle</Text>
        <Text style={sharedStyles.label}>Hesap adı</Text>
        <TextInput
          accessibilityLabel="Hesap adı"
          value={name}
          onChangeText={setName}
          placeholder="Örnek: Maaş hesabım"
          style={sharedStyles.input}
        />
        <Text style={sharedStyles.label}>Para birimi</Text>
        <Choice<Currency>
          value={currency}
          onChange={setCurrency}
          options={[{ value: 'TRY', label: 'TL' }, { value: 'USD', label: 'USD' }, { value: 'EUR', label: 'EUR' }]}
        />
        <Text style={sharedStyles.label}>Kullanım amacı</Text>
        <Choice<AccountPurpose>
          value={purpose}
          onChange={setPurpose}
          options={[{ value: 'spending', label: 'Günlük kullanım' }, { value: 'savings', label: 'Birikim' }]}
        />
        <Text style={sharedStyles.label}>Bugünkü bakiye</Text>
        <TextInput
          accessibilityLabel="Bugünkü bakiye"
          value={openingBalance}
          onChangeText={setOpeningBalance}
          keyboardType="decimal-pad"
          placeholder="Örnek: 1250,50"
          style={sharedStyles.input}
        />
        <ActionButton title="Hesabı kaydet" onPress={saveAccount} disabled={savingAction !== null} loading={savingAction === 'account'} />
      </SectionCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  accountName: { flexShrink: 1 },
  badge: { color: palette.primaryDark, backgroundColor: palette.primarySoft, paddingVertical: 6, paddingHorizontal: 9, borderRadius: 8, fontSize: 12, fontWeight: '700', overflow: 'hidden' },
  balance: { color: palette.ink, fontSize: 27, fontWeight: '800', fontVariant: ['tabular-nums'] },
  difference: { borderRadius: 12, padding: 12, gap: 4 },
  differencePositive: { backgroundColor: palette.positiveSoft },
  differenceNegative: { backgroundColor: palette.negativeSoft },
  differenceLabel: { color: palette.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  differenceAmount: { fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  valuation: { backgroundColor: palette.primarySoft, borderRadius: 12, padding: 12, gap: 3 },
  valuationLabel: { color: palette.primaryDark, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  valuationAmount: { color: palette.ink, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  positiveText: { color: palette.positive },
  negativeText: { color: palette.negative },
  history: { borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 12, gap: 10 },
  historyItem: { borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 10, gap: 5 },
  historyAmount: { color: palette.ink, fontSize: 15, fontWeight: '700' },
});
