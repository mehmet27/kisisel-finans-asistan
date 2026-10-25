import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { deleteTryTransfer, listAccounts, listTryTransfers, recordTryTransfer } from '@/data/repository';
import { formatMoney, parseAmountMinor } from '@/domain/finance';
import type { Account } from '@/domain/finance';
import { ActionButton, ActionLink, Choice, InlineDelete, Notice, PageTitle, SectionCard, palette, sharedStyles } from '@/ui/components';

type Transfers = Awaited<ReturnType<typeof listTryTransfers>>;

export default function TransfersScreen() {
  const db = useSQLiteContext();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transfers, setTransfers] = useState<Transfers>([]);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const requestId = useRef<string | null>(null);
  const working = useRef(false);

  const refresh = useCallback(async () => {
    const [nextAccounts, nextTransfers] = await Promise.all([listAccounts(db), listTryTransfers(db)]);
    setAccounts(nextAccounts);
    setTransfers(nextTransfers);
    const nextTry = nextAccounts.filter((account) => account.currency === 'TRY');
    setSourceId((current) => nextTry.some((account) => account.id === current) ? current : nextTry[0]?.id ?? null);
    setTargetId((current) => nextTry.some((account) => account.id === current) ? current : nextTry[1]?.id ?? null);
    setReady(true);
    return nextAccounts;
  }, [db]);

  useFocusEffect(useCallback(() => {
    refresh().catch(() => { setError('Aktarım kayıtları okunamadı.'); setReady(true); });
  }, [refresh]));

  function resetConfirmation() {
    setConfirming(false);
    requestId.current = null;
  }

  function beginTransfer() {
    const parsed = parseAmountMinor(amount);
    const source = accounts.find((account) => account.id === sourceId);
    const target = accounts.find((account) => account.id === targetId);
    if (!source || !target || source.id === target.id || parsed === null || parsed <= 0) {
      setError('İki farklı TL kullanım hesabı ve sıfırdan büyük aktarım tutarı seç.');
      return;
    }
    if (parsed > source.balanceMinor) {
      setError('Aktarım tutarı kaynak hesabın uygulamadaki bakiyesini aşıyor.');
      return;
    }
    setError('');
    requestId.current ??= `transfer-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    setConfirming(true);
  }

  async function saveTransfer() {
    const parsed = parseAmountMinor(amount);
    if (working.current || !sourceId || !targetId || sourceId === targetId || parsed === null || parsed <= 0 || !requestId.current) return;
    working.current = true;
    setSaving(true);
    setError('');
    try {
      const before = await listAccounts(db);
      await recordTryTransfer(db, { sourceAccountId: sourceId, targetAccountId: targetId, amountMinor: parsed, requestId: requestId.current });
      const after = await refresh();
      const sourceBefore = before.find((account) => account.id === sourceId);
      const sourceAfter = after.find((account) => account.id === sourceId);
      const targetBefore = before.find((account) => account.id === targetId);
      const targetAfter = after.find((account) => account.id === targetId);
      setNotice(sourceBefore && sourceAfter && targetBefore && targetAfter
        ? `Aktarım kaydedildi. ${sourceBefore.name}: ${formatMoney(sourceBefore.balanceMinor, 'TRY')} → ${formatMoney(sourceAfter.balanceMinor, 'TRY')}; ${targetBefore.name}: ${formatMoney(targetBefore.balanceMinor, 'TRY')} → ${formatMoney(targetAfter.balanceMinor, 'TRY')}.`
        : 'Aktarım kaydedildi. Hesap bakiyelerini kontrol et.');
      setAmount('');
      resetConfirmation();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : 'Aktarım kaydedilemedi. Tekrar dene.');
    } finally {
      working.current = false;
      setSaving(false);
    }
  }

  const tryAccounts = accounts.filter((account) => account.currency === 'TRY');
  const source = tryAccounts.find((account) => account.id === sourceId);
  const target = tryAccounts.find((account) => account.id === targetId);
  const parsed = parseAmountMinor(amount);
  const options = tryAccounts.map((account) => ({ value: account.id, label: `${account.name} (${account.purpose === 'savings' ? 'birikim' : 'kullanım'}) · ${formatMoney(account.balanceMinor, 'TRY')}` }));

  return (
    <ScrollView style={sharedStyles.page} contentContainerStyle={sharedStyles.content} keyboardShouldPersistTaps="handled">
      <PageTitle eyebrow="HESAPLAR" title="TL aktarımı" subtitle="Kendi TL hesapların arasında para taşı." />
      <Notice body="Aktarım toplam varlığını değiştirmez. Kaynak hesap azalır, hedef hesap aynı tutarda artar." />
      {!ready ? <Notice body="Hesaplar ve aktarımlar yükleniyor." /> : null}
      {error ? <Notice tone="error" body={error} /> : null}
      {notice ? <Notice body={notice} /> : null}
      {ready && tryAccounts.length < 2 ? (
        <SectionCard>
          <Text style={sharedStyles.cardTitle}>İki TL hesabı gerekli</Text>
          <Text style={sharedStyles.helper}>Aktarım yapmak için kullanım veya birikim amaçlı iki ayrı TL hesabı oluştur.</Text>
          <ActionLink href="/accounts" title="Hesaplara git" />
        </SectionCard>
      ) : null}
      {tryAccounts.length >= 2 ? (
        <SectionCard>
          <Text style={sharedStyles.cardTitle}>Yeni aktarım</Text>
          <Text style={sharedStyles.label}>Kaynak hesap</Text>
          <Choice<string> value={sourceId ?? tryAccounts[0].id} onChange={(value) => { setSourceId(value); resetConfirmation(); }} options={options} disabled={saving} />
          <Text style={sharedStyles.label}>Hedef hesap</Text>
          <Choice<string> value={targetId ?? tryAccounts[1].id} onChange={(value) => { setTargetId(value); resetConfirmation(); }} options={options} disabled={saving} />
          <Text style={sharedStyles.label}>Tutar (TL)</Text>
          <TextInput accessibilityLabel="Aktarım tutarı" value={amount} onChangeText={(value) => { setAmount(value); resetConfirmation(); }} keyboardType="decimal-pad" placeholder="Örnek: 2500,00" style={sharedStyles.input} />
          {confirming ? (
            <View style={styles.confirmBox}>
              <Text style={sharedStyles.cardTitle}>Aktarım onaylansın mı?</Text>
              <Text style={sharedStyles.helper}>{source?.name}: {formatMoney(source?.balanceMinor ?? 0, 'TRY')} → {formatMoney((source?.balanceMinor ?? 0) - (parsed ?? 0), 'TRY')}</Text>
              <Text style={sharedStyles.helper}>{target?.name}: {formatMoney(target?.balanceMinor ?? 0, 'TRY')} → {formatMoney((target?.balanceMinor ?? 0) + (parsed ?? 0), 'TRY')}</Text>
              <ActionButton title="Evet, aktar" onPress={saveTransfer} disabled={saving} loading={saving} />
              <ActionButton title="Geri dön" secondary onPress={() => setConfirming(false)} disabled={saving} />
            </View>
          ) : <ActionButton title="Aktarımı gözden geçir" onPress={beginTransfer} disabled={saving} />}
        </SectionCard>
      ) : null}
      {transfers.length ? <Text style={sharedStyles.sectionTitle}>Aktarım geçmişi</Text> : null}
      {transfers.map((transfer) => {
        const from = accounts.find((account) => account.id === transfer.sourceAccountId);
        const to = accounts.find((account) => account.id === transfer.targetAccountId);
        const occurred = new Date(transfer.occurredAt);
        return (
          <SectionCard key={transfer.id}>
            <Text style={sharedStyles.cardTitle}>{from?.name ?? 'Kaynak hesap'} → {to?.name ?? 'Hedef hesap'}</Text>
            <Text style={styles.transferAmount}>{formatMoney(transfer.amountMinor, 'TRY')}</Text>
            <Text style={sharedStyles.muted}>{Number.isNaN(occurred.getTime()) ? transfer.occurredAt : new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(occurred)}</Text>
            <InlineDelete itemName="Aktarımı" onDelete={async () => {
              await deleteTryTransfer(db, transfer.id);
              await refresh();
              setNotice('Aktarım geri alındı; iki hesabın bakiyesi yenilendi.');
            }} disabled={saving} detail="Yalnız her iki hesapta da daha sonra bakiye girişi veya işlem yoksa aktarım güvenle geri alınabilir." />
          </SectionCard>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  confirmBox: { backgroundColor: palette.primarySoft, borderRadius: 14, padding: 13, gap: 10 },
  transferAmount: { color: palette.ink, fontSize: 21, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
