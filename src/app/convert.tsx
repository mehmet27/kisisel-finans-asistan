import { useCallback, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { listAccounts, listGoldHoldings, recordFxExchange, recordGoldSale } from '@/data/repository';
import { ConversionError, previewFxConversion, previewGoldConversion } from '@/domain/conversions';
import type { ConversionErrorCode, ConversionPreview } from '@/domain/conversions';
import { formatMoney, localDateString, parseAmountMinor } from '@/domain/finance';
import type { Account } from '@/domain/finance';
import { formatQuantityMicros, parseQuantityMicros } from '@/domain/valuation';
import type { GoldHolding } from '@/domain/valuation';
import { ActionButton, ActionLink, Choice, Notice, PageTitle, SectionCard, palette, sharedStyles } from '@/ui/components';

export default function ConvertScreen() {
  const { kind, id } = useLocalSearchParams<{ kind?: string; id?: string }>();
  const db = useSQLiteContext();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [holdings, setHoldings] = useState<GoldHolding[]>([]);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState<ConversionErrorCode | null>(null);
  const [diagnosticCode, setDiagnosticCode] = useState<string | null>(null);
  const [storageFailure, setStorageFailure] = useState(false);
  const [targetAccountId, setTargetAccountId] = useState<string | null>(null);
  const [sourceAmount, setSourceAmount] = useState('');
  const [netTry, setNetTry] = useState('');
  const [feeTry, setFeeTry] = useState('0');
  const savingRef = useRef(false);
  const storageFailureRef = useRef(false);
  const pendingRequestRef = useRef<{ key: string; id: string } | null>(null);

  const refresh = useCallback(async (isActive: () => boolean = () => true) => {
    const [nextAccounts, nextHoldings] = await Promise.all([listAccounts(db), listGoldHoldings(db)]);
    if (!isActive()) return;
    setAccounts(nextAccounts);
    setHoldings(nextHoldings);
    setTargetAccountId((current) => current ?? nextAccounts.find((account) => account.currency === 'TRY' && account.purpose === 'spending')?.id ?? null);
    setReady(true);
  }, [db]);

  useFocusEffect(useCallback(() => {
    let active = true;
    refresh(() => active)
      .then(() => { if (active && !storageFailureRef.current) { setError(''); setErrorCode(null); } })
      .catch(() => { if (active) { setError('Kaynak ve hedef hesaplar okunamadı.'); setReady(true); } });
    return () => { active = false; };
  }, [refresh]));

  const sourceAccount = kind === 'fx' ? accounts.find((account) => account.id === id && (account.currency === 'USD' || account.currency === 'EUR')) : undefined;
  const goldHolding = kind === 'gold' ? holdings.find((holding) => holding.id === id) : undefined;
  const sourceExists = !!sourceAccount || !!goldHolding;
  const targetAccounts = accounts.filter((account) => account.currency === 'TRY' && account.purpose === 'spending');
  const targetAccount = targetAccounts.find((account) => account.id === targetAccountId);
  const today = localDateString();
  const balancesToConfirm = [
    ...(sourceAccount && (sourceAccount.balanceDate !== today || !sourceAccount.balanceRecordedAt) ? [sourceAccount.name] : []),
    ...(targetAccount && (targetAccount.balanceDate !== today || !targetAccount.balanceRecordedAt) ? [targetAccount.name] : []),
  ];
  const parsedSource = kind === 'fx' ? parseAmountMinor(sourceAmount) : parseQuantityMicros(sourceAmount);
  const parsedNet = parseAmountMinor(netTry);
  const parsedFee = parseAmountMinor(feeTry);
  const available = sourceAccount?.balanceMinor ?? goldHolding?.quantityMicros ?? 0;
  const sourceEnough = parsedSource !== null && parsedSource > 0 && parsedSource <= available;
  let preview: ConversionPreview | null = null;
  if (sourceEnough && parsedNet !== null && parsedFee !== null) {
    try {
      preview = kind === 'fx'
        ? previewFxConversion(parsedSource, parsedNet, parsedFee)
        : previewGoldConversion(parsedSource, parsedNet, parsedFee);
    } catch {
      preview = null;
    }
  }
  const sourceLabel = sourceAccount?.name ?? goldHolding?.name ?? 'Kaynak';
  const sourceQuantity = parsedSource !== null && parsedSource > 0
    ? sourceAccount ? formatMoney(parsedSource, sourceAccount.currency) : `${formatQuantityMicros(parsedSource)} gram`
    : '—';

  function validationMessage(): string | null {
    if (!sourceExists) return 'Kaynak bulunamadı. Birikimler ekranından yeniden seç.';
    if (!targetAccount) return 'TL kullanım hesabı seç.';
    if (balancesToConfirm.length > 0) return `${balancesToConfirm.join(' ve ')} için önce bugünkü bakiyeyi Hesaplar bölümünde güncelle.`;
    if (parsedSource === null || parsedSource <= 0) return `Sıfırdan büyük geçerli bir ${kind === 'fx' ? 'döviz tutarı' : 'gram miktarı'} gir.`;
    if (!sourceEnough) return 'Satılacak miktar kayıtlı kaynak bakiyeyi aşıyor.';
    if (parsedNet === null || parsedNet <= 0) return 'Eline geçen net TL tutarını sıfırdan büyük gir.';
    if (parsedFee === null || parsedFee < 0) return 'Masrafı geçerli TL tutarıyla gir; masraf yoksa 0 yaz.';
    if (!preview) return 'Gerçekleşen tutar hesaplanamadı. Net TL ve masrafı kontrol et.';
    return null;
  }

  function reviewRecord() {
    setErrorCode(null);
    const issue = validationMessage();
    if (issue) { setError(issue); setConfirming(false); return; }
    setError('');
    setConfirming(true);
  }

  async function saveRecord() {
    if (savingRef.current || !confirming) return;
    const issue = validationMessage();
    if (issue || parsedSource === null || !targetAccountId || !preview) {
      setErrorCode(null);
      setError(issue ?? 'İşlem bilgileri değişti. Lütfen yeniden gözden geçir.');
      setConfirming(false);
      return;
    }
    const requestKey = `${kind}|${id}|${targetAccountId}|${parsedSource}|${preview.netTryMinor}|${preview.feeTryMinor}`;
    if (pendingRequestRef.current?.key !== requestKey) {
      pendingRequestRef.current = { key: requestKey, id: Crypto.randomUUID() };
    }
    const requestId = pendingRequestRef.current.id;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      if (sourceAccount) {
        await recordFxExchange(db, {
          sourceAccountId: sourceAccount.id, targetAccountId, sourceAmountMinor: parsedSource,
          netTryMinor: preview.netTryMinor, feeTryMinor: preview.feeTryMinor, requestId,
        });
      } else {
        await recordGoldSale(db, {
          goldHoldingId: goldHolding!.id, targetAccountId, quantityMicros: parsedSource,
          netTryMinor: preview.netTryMinor, feeTryMinor: preview.feeTryMinor, requestId,
        });
      }
      pendingRequestRef.current = null;
      setConfirming(false);
      setStorageFailure(false);
      storageFailureRef.current = false;
      setDiagnosticCode(null);
      setCompleted(true);
      await refresh().catch(() => {});
    } catch (cause) {
      const conversionError = cause instanceof ConversionError ? cause : null;
      const storageError = conversionError?.code === 'STORAGE_ERROR';
      setErrorCode(conversionError?.code ?? null);
      setStorageFailure(storageError);
      storageFailureRef.current = storageError;
      setDiagnosticCode(storageError
        ? (conversionError?.diagnosticCode && /^[A-Z0-9_-]{3,48}$/.test(conversionError.diagnosticCode)
          ? conversionError.diagnosticCode : 'STORAGE_UNKNOWN')
        : null);
      setError(conversionError
        ? `İşlem kaydedilmedi. ${conversionError.message}`
        : 'İşlem kaydedilemedi. Veriler değişmiş olabilir; kayıtlı bakiyeleri kontrol edip aynı bilgilerle yeniden dene.');
      if (!storageError) refresh().catch(() => {});
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <ScrollView style={sharedStyles.page} contentContainerStyle={sharedStyles.content} keyboardShouldPersistTaps="handled">
      <PageTitle eyebrow="GERÇEK İŞLEM" title={kind === 'fx' ? 'Döviz bozdur' : 'Gram altın sat'} subtitle="Gerçekleşen tutarı ve TL’nin yatacağı hesabı kaydet." />
      <Notice body="Piyasa ekranındaki yaklaşık TL değeri gerçekleşen satış tutarı değildir. Net TL’yi ve masrafı işlem belgene göre gir; bu aktarımı ayrıca gelir olarak ekleme." />
      {error && (!sourceExists || targetAccounts.length === 0 || completed) ? <Notice tone="error" body={error} /> : null}
      {!ready ? <Notice body="Kaynak ve hedef hesaplar yükleniyor." /> : null}
      {ready && !sourceExists ? (
        <SectionCard>
          <Text style={sharedStyles.cardTitle}>Kaynak bulunamadı</Text>
          <Text style={sharedStyles.helper}>Birikimler ekranından döviz hesabını veya altın kaydını seç.</Text>
          <ActionLink href="/savings" title="Birikimlere dön" />
        </SectionCard>
      ) : null}
      {ready && sourceExists && !targetAccounts.length ? (
        <SectionCard>
          <Text style={sharedStyles.cardTitle}>TL kullanım hesabı gerekiyor</Text>
          <Text style={sharedStyles.helper}>Bozdurma veya satış tutarının yatacağı bir TL kullanım hesabı ekle.</Text>
          <ActionLink href="/accounts" title="Hesap ekle" />
        </SectionCard>
      ) : null}
      {ready && balancesToConfirm.length > 0 && !completed ? (
        <SectionCard>
          <Text style={sharedStyles.cardTitle}>Önce bugünkü bakiyeyi doğrula</Text>
          <Text style={sharedStyles.helper}>{balancesToConfirm.join(' ve ')} için bugünkü bakiye doğrulaması eksik. İşlemden önce bu hesapların bakiyesini Hesaplar bölümünde yeniden gir.</Text>
          <ActionLink href="/accounts" title="Bakiyeleri güncelle" />
        </SectionCard>
      ) : null}
      {completed ? (
        <SectionCard>
          <Text style={sharedStyles.cardTitle}>İşlem kaydedildi</Text>
          <Text style={sharedStyles.helper}>Kaynak miktar azaltıldı ve net TL seçtiğin kullanım hesabına aktarıldı. İşlem Birikimler geçmişinde görünür.</Text>
          <ActionLink href="/savings" title="Birikimlere dön" />
        </SectionCard>
      ) : null}
      {ready && sourceExists && targetAccounts.length > 0 && !completed ? (
        <>
          <SectionCard>
            <Text style={sharedStyles.cardTitle}>{sourceLabel}</Text>
            <Text style={styles.available}>{sourceAccount
              ? formatMoney(sourceAccount.balanceMinor, sourceAccount.currency)
              : `${formatQuantityMicros(goldHolding!.quantityMicros)} gram`}</Text>
            <Text style={sharedStyles.muted}>Kayıtlı kaynak miktarı</Text>
            <Text style={sharedStyles.label}>{sourceAccount ? `Bozdurulacak ${sourceAccount.currency} tutarı` : 'Satılacak gram miktarı'}</Text>
            <TextInput accessibilityLabel={sourceAccount ? 'Bozdurulacak döviz tutarı' : 'Satılacak altın gramı'} value={sourceAmount} onChangeText={(value) => { setSourceAmount(value); setConfirming(false); setError(''); }} editable={!saving && !storageFailure} keyboardType="decimal-pad" placeholder={sourceAccount ? 'Örnek: 100,00' : 'Örnek: 2,500000'} style={sharedStyles.input} />
            {parsedSource !== null && parsedSource > available ? <Text style={sharedStyles.error}>Miktar kayıtlı kaynağı aşıyor.</Text> : null}
          </SectionCard>
          <SectionCard>
            <Text style={sharedStyles.cardTitle}>Gerçekleşen TL</Text>
            <Text style={sharedStyles.label}>Eline geçen net TL</Text>
            <TextInput accessibilityLabel="Gerçekleşen net TL tutarı" value={netTry} onChangeText={(value) => { setNetTry(value); setConfirming(false); setError(''); }} editable={!saving && !storageFailure} keyboardType="decimal-pad" placeholder="Örnek: 4100,00" style={sharedStyles.input} />
            <Text style={sharedStyles.label}>İşlem masrafı (TL)</Text>
            <TextInput accessibilityLabel="Bozdurma veya satış masrafı" value={feeTry} onChangeText={(value) => { setFeeTry(value); setConfirming(false); setError(''); }} editable={!saving && !storageFailure} keyboardType="decimal-pad" placeholder="Yoksa 0" style={sharedStyles.input} />
            <Text style={sharedStyles.helper}>Brüt gerçekleşen tutar, net TL ile masrafın toplamıdır. Piyasa fiyatı bu alanları doldurmaz.</Text>
            <Text style={sharedStyles.label}>Net TL’nin yatacağı kullanım hesabı</Text>
            <Choice<string> value={targetAccountId ?? targetAccounts[0].id} onChange={(value) => { setTargetAccountId(value); setConfirming(false); setError(''); }} disabled={saving || storageFailure} options={targetAccounts.map((account) => ({ value: account.id, label: account.name }))} />
          </SectionCard>
          <SectionCard>
            <Text style={sharedStyles.cardTitle}>İşlem öncesi etki</Text>
            {preview ? (
              <>
                <View style={sharedStyles.row}><Text style={styles.effectLabel}>{sourceLabel} azalır</Text><Text style={styles.effectAmount}>−{sourceQuantity}</Text></View>
                <View style={sharedStyles.row}><Text style={styles.effectLabel}>{targetAccount?.name ?? 'TL hesabı'} artar</Text><Text style={styles.effectAmount}>+{formatMoney(preview.netTryMinor, 'TRY')}</Text></View>
                <View style={styles.divider} />
                <View style={sharedStyles.row}><Text style={styles.effectLabel}>Brüt gerçekleşen TL</Text><Text style={styles.effectAmount}>{formatMoney(preview.grossTryMinor, 'TRY')}</Text></View>
                <View style={sharedStyles.row}><Text style={styles.effectLabel}>Masraf</Text><Text style={styles.effectAmount}>{formatMoney(preview.feeTryMinor, 'TRY')}</Text></View>
                <Text style={sharedStyles.helper}>Gerçekleşen birim fiyat: {new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(preview.realizedPriceTryMicros / 1_000_000)} TL / {sourceAccount?.currency ?? 'gram'}</Text>
              </>
            ) : <Text style={sharedStyles.helper}>Etkiyi görmek için geçerli kaynak miktarı, net TL ve masraf gir.</Text>}
            {balancesToConfirm.length > 0 ? <Notice tone="warning" body="İşlem için yukarıda adı geçen hesapların bugünkü bakiyesini önce doğrula. Bu bilgi olmadan kayıt yapılamaz." /> : null}
            {error ? <Notice tone="error" body={error} /> : null}
            {error && (errorCode === 'BALANCE_OUTDATED' || errorCode === 'BALANCE_UNVERIFIED') ? <ActionLink href="/accounts" title="Bakiyeleri yeniden kaydet" /> : null}
            {storageFailure ? (
              <Notice tone="warning" title={`Tanı kodu: ${diagnosticCode ?? 'STORAGE_UNKNOWN'}`} body="Kayıt durumu kesinleşmedi. Birikimler ekranındaki işlem geçmişini kontrol et. Aynı bilgilerle yeniden denersen aynı işlem kimliği kullanılır; bilgileri değiştirmeden önce geçmişi doğrula." />
            ) : null}
            {storageFailure ? <ActionLink href="/savings" title="İşlem geçmişini kontrol et" secondary /> : null}
            {confirming && preview ? (
              <View style={styles.confirmBox}>
                <Text style={styles.confirmTitle}>Son onay</Text>
                <Text style={sharedStyles.helper}>{sourceQuantity} kaynaktan düşecek. {formatMoney(preview.netTryMinor, 'TRY')} {targetAccount?.name ?? 'TL hesabına'} eklenecek. Masraf {formatMoney(preview.feeTryMinor, 'TRY')}.</Text>
                <ActionButton title={saving ? 'İşlem kaydediliyor…' : storageFailure ? 'Aynı işlemi yeniden dene' : 'İşlemi kaydet'} onPress={saveRecord} disabled={saving} loading={saving} />
                {!storageFailure ? <ActionButton title="Vazgeç" onPress={() => { setConfirming(false); setError(''); }} disabled={saving} secondary /> : null}
              </View>
            ) : <ActionButton title={storageFailure ? 'Önce işlem geçmişini kontrol et' : 'İşlemi gözden geçir'} onPress={reviewRecord} disabled={saving || storageFailure} />}
          </SectionCard>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  available: { color: palette.ink, fontSize: 25, fontWeight: '800', fontVariant: ['tabular-nums'] },
  effectLabel: { color: palette.muted, fontSize: 13, flex: 1 },
  effectAmount: { color: palette.ink, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'], textAlign: 'right', flexShrink: 1 },
  divider: { height: 1, backgroundColor: palette.border, marginVertical: 4 },
  confirmBox: { backgroundColor: palette.primarySoft, borderRadius: 14, padding: 13, gap: 10 },
  confirmTitle: { color: palette.primaryDark, fontSize: 16, fontWeight: '800' },
});
