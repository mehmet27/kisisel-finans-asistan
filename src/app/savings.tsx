import { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { createGoldHolding, deleteAccount, deleteAssetConversion, deleteGoldHolding, listAccounts, listAssetConversions, listGoldHoldings, listPriceQuotes, updateGoldHoldingQuantity } from '@/data/repository';
import { formatMoney } from '@/domain/finance';
import type { Account } from '@/domain/finance';
import type { AssetConversion } from '@/domain/conversions';
import { formatQuantityMicros, parseQuantityMicros, summarizeAssetsTry, valueForeignAccountTry, valueGoldHoldingTry } from '@/domain/valuation';
import type { AssetCode, GoldHolding, PriceQuote } from '@/domain/valuation';
import { refreshPriceQuotes } from '@/services/prices';
import { ActionButton, ActionLink, InlineDelete, Notice, PageTitle, SectionCard, palette, sharedStyles } from '@/ui/components';

const assetLabels: Record<AssetCode, string> = { USD: 'USD', EUR: 'EUR', XAU_GRAM: 'Gram altın' };

function quoteTime(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return `${day}.${month}.${year}`;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function quoteDetail(quote: PriceQuote | undefined, failed: boolean): string {
  if (!quote) return 'Fiyat henüz alınamadı. TL karşılığı hesaplanamıyor.';
  const state = failed ? 'Yenileme başarısız · son başarılı fiyat alımı' : 'Son başarılı fiyat alımı';
  return `${state}: ${quoteTime(quote.fetchedAt)} · Piyasa zamanı: ${quoteTime(quote.quotedAt)} · Kaynak: ${quote.source}`;
}

function unitPrice(quote: PriceQuote): string {
  return `${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(quote.priceTryMicros / 1_000_000)} TL`;
}

export default function SavingsScreen() {
  const db = useSQLiteContext();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [holdings, setHoldings] = useState<GoldHolding[]>([]);
  const [quotes, setQuotes] = useState<PriceQuote[]>([]);
  const [conversions, setConversions] = useState<AssetConversion[]>([]);
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingAction, setSavingAction] = useState<'gold' | 'quantity' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [priceErrors, setPriceErrors] = useState<AssetCode[]>([]);
  const [goldName, setGoldName] = useState('');
  const [goldGrams, setGoldGrams] = useState('');
  const [editingGold, setEditingGold] = useState<GoldHolding | null>(null);
  const [editingGrams, setEditingGrams] = useState('');
  const refreshRun = useRef(0);

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    const [nextAccounts, nextHoldings, nextQuotes, nextConversions] = await Promise.all([
      listAccounts(db), listGoldHoldings(db), listPriceQuotes(db), listAssetConversions(db),
    ]);
    if (!isActive()) return;
    setAccounts(nextAccounts);
    setHoldings(nextHoldings);
    setQuotes(nextQuotes);
    setConversions(nextConversions);
    setReady(true);
  }, [db]);

  const refreshPrices = useCallback(async (force = false) => {
    const run = ++refreshRun.current;
    setRefreshing(true);
    try {
      const result = await refreshPriceQuotes(db, { force });
      if (run === refreshRun.current) {
        setQuotes(result.quotes);
        setPriceErrors(result.errors.map((item) => item.assetCode));
      }
    } catch {
      if (run === refreshRun.current) setPriceErrors(['USD', 'EUR', 'XAU_GRAM']);
    } finally {
      if (run === refreshRun.current) setRefreshing(false);
    }
  }, [db]);

  useFocusEffect(useCallback(() => {
    let active = true;
    load(() => active)
      .then(() => { if (active) { setError(''); refreshPrices(); } })
      .catch(() => { if (active) { setError('Birikimler okunamadı.'); setReady(true); setRefreshing(false); } });
    return () => { active = false; refreshRun.current += 1; };
  }, [load, refreshPrices]));

  async function saveGold() {
    const grams = parseQuantityMicros(goldGrams);
    if (!goldName.trim() || grams === null || grams <= 0) {
      setError('Altın adı ve sıfırdan büyük gram miktarı gir. En fazla 6 ondalık kullanabilirsin.');
      return;
    }
    setSavingAction('gold');
    setError('');
    try {
      await createGoldHolding(db, { name: goldName, quantityMicros: grams });
      setGoldName(''); setGoldGrams('');
      await load();
    } catch {
      setError('Altın birikimi kaydedilemedi. Tekrar dene.');
    } finally {
      setSavingAction(null);
    }
  }

  async function saveGoldQuantity() {
    if (!editingGold) return;
    const grams = parseQuantityMicros(editingGrams);
    if (grams === null || grams < 0) {
      setError('Geçerli gram miktarı gir. En fazla 6 ondalık kullanabilirsin.');
      return;
    }
    setSavingAction('quantity');
    setError('');
    try {
      await updateGoldHoldingQuantity(db, editingGold.id, grams);
      setEditingGold(null); setEditingGrams('');
      await load();
    } catch {
      setError('Altın miktarı güncellenemedi. Tekrar dene.');
    } finally {
      setSavingAction(null);
    }
  }

  const foreignAccounts = accounts.filter((account) => account.currency === 'USD' || account.currency === 'EUR');
  const trySavings = accounts.filter((account) => account.currency === 'TRY' && account.purpose === 'savings');
  const summary = summarizeAssetsTry(accounts, holdings, quotes);
  const quoteByCode = (code: AssetCode) => quotes.find((quote) => quote.assetCode === code);
  const failed = (code: AssetCode) => priceErrors.includes(code);
  const neededCodes = Array.from(new Set<AssetCode>([
    ...foreignAccounts.map((account) => account.currency as AssetCode),
    ...(holdings.length ? ['XAU_GRAM' as AssetCode] : []),
  ]));
  const relevantPriceErrors = neededCodes.filter(failed);

  return (
    <ScrollView style={sharedStyles.page} contentContainerStyle={sharedStyles.content} keyboardShouldPersistTaps="handled">
      <PageTitle eyebrow="BİRİKİMLER" title="Döviz ve altın" subtitle="Kaynak miktarını ve yaklaşık TL değerini ayrı izle." />
      <Notice body="Döviz ve altın bozdurulmadıkça harcanabilir TL hesabına katılmaz. TL karşılıkları yalnız fiyat değerlemesidir; gerçekleşen satış tutarı farklı olabilir." />
      {!ready ? <Notice body="Birikimler yükleniyor." /> : null}
      {error ? <Notice tone="error" body={error} /> : null}
      {notice ? <Notice body={notice} /> : null}
      {ready && relevantPriceErrors.length > 0 ? (
        <Notice tone="warning" title="Fiyat yenilenemedi" body={`${relevantPriceErrors.map((code) => assetLabels[code]).join(', ')} için bağlantı veya fiyat servisi hatası oluştu. Çevrimdışıysan son başarılı fiyat ve zamanı gösteriliyor.`} />
      ) : null}
      {ready && summary.status === 'stale' && relevantPriceErrors.length === 0 ? (
        <Notice tone="warning" title="Fiyatlar eski" body="Gösterilen yaklaşık TL değerleri son başarılı fiyatlara dayanıyor. Yeniden deneyebilirsin." />
      ) : null}
      {ready && summary.status === 'unavailable' ? (
        <Notice tone="warning" title="Toplam değer hesaplanamıyor" body={`Eksik fiyat: ${summary.missingCodes.map((code) => assetLabels[code]).join(', ')}. Kaynak miktarların saklıdır.`} />
      ) : null}

      <SectionCard>
        <Text style={styles.eyebrow}>TOPLAM VARLIK · YAKLAŞIK TL</Text>
        <Text style={styles.total}>{ready && summary.totalTryMinor !== null ? formatMoney(summary.totalTryMinor, 'TRY') : '—'}</Text>
        <Text style={sharedStyles.helper}>
          {summary.totalTryMinor === null
            ? 'Eksik fiyat nedeniyle tüm varlıkların TL toplamı gösterilmiyor.'
            : summary.status === 'stale'
              ? `Eski fiyatlarla yaklaşık toplam · en eski fiyat ${summary.quotedAt ? quoteTime(summary.quotedAt) : 'bilinmiyor'}`
              : 'TL hesap bakiyeleri ve döviz/altın yaklaşık değerleri birlikte. Kart borcu düşülmez.'}
        </Text>
        <ActionButton title={refreshing ? 'Fiyatlar yenileniyor…' : 'Fiyatları yenile'} onPress={() => refreshPrices(true)} loading={refreshing} secondary />
        <Text style={sharedStyles.helper}>Yeni fiyat isteği en fazla dakikada bir gönderilir. Bağlantı yoksa son başarılı kayıt korunur.</Text>
      </SectionCard>

      {foreignAccounts.length === 0 && holdings.length === 0 && trySavings.length === 0 && ready ? (
        <Notice title="Henüz birikim yok" body="Döviz hesabını Hesaplar bölümünden, gram altını aşağıdaki formdan ekleyebilirsin." />
      ) : null}

      {foreignAccounts.length > 0 ? <Text style={sharedStyles.sectionTitle}>Döviz hesapları</Text> : null}
      {foreignAccounts.map((account) => {
        const quote = quoteByCode(account.currency as AssetCode);
        const value = valueForeignAccountTry(account, quote);
        return (
          <SectionCard key={account.id}>
            <Text style={sharedStyles.cardTitle}>{account.name}</Text>
            <Text style={styles.sourceAmount}>{formatMoney(account.balanceMinor, account.currency)}</Text>
            <Text style={sharedStyles.muted}>Uygulamadaki kaynak bakiye · Son gerçek bakiye kontrolü: {account.balanceDate}</Text>
            <View style={styles.valuation}>
              <Text style={styles.valuationLabel}>YAKLAŞIK TL KARŞILIĞI</Text>
              <Text style={styles.valuationAmount}>{value === null ? '—' : formatMoney(value, 'TRY')}</Text>
              {quote ? <Text style={sharedStyles.helper}>Birim fiyat: {unitPrice(quote)} / {account.currency}</Text> : null}
              <Text style={sharedStyles.helper}>{quoteDetail(quote, failed(account.currency as AssetCode))}</Text>
            </View>
            {account.balanceMinor > 0 ? (
              <ActionButton title="Bu dövizi bozdur" secondary onPress={() => router.push({ pathname: '/convert', params: { kind: 'fx', id: account.id } })} />
            ) : null}
            <InlineDelete itemName="Döviz hesabını" onDelete={async () => { await deleteAccount(db, account.id); await load(); setNotice('Döviz hesabı silindi.'); }} disabled={savingAction !== null} detail="Bağlı dönüşüm veya plan varsa önce bunları silmelisin." />
          </SectionCard>
        );
      })}

      {holdings.length > 0 ? <Text style={sharedStyles.sectionTitle}>Gram altın</Text> : null}
      {holdings.map((holding) => {
        const quote = quoteByCode('XAU_GRAM');
        const value = valueGoldHoldingTry(holding, quote);
        return (
          <SectionCard key={holding.id}>
            <Text style={sharedStyles.cardTitle}>{holding.name}</Text>
            <Text style={styles.sourceAmount}>{formatQuantityMicros(holding.quantityMicros)} gram</Text>
            <Text style={sharedStyles.muted}>Kayıtlı altın miktarı</Text>
            <View style={styles.valuation}>
              <Text style={styles.valuationLabel}>YAKLAŞIK TL KARŞILIĞI</Text>
              <Text style={styles.valuationAmount}>{value === null ? '—' : formatMoney(value, 'TRY')}</Text>
              {quote ? <Text style={sharedStyles.helper}>Birim fiyat: {unitPrice(quote)} / gram</Text> : null}
              <Text style={sharedStyles.helper}>{quoteDetail(quote, failed('XAU_GRAM'))}</Text>
            </View>
            {holding.quantityMicros > 0 ? (
              <ActionButton title="Bu altını sat" secondary onPress={() => router.push({ pathname: '/convert', params: { kind: 'gold', id: holding.id } })} />
            ) : null}
            <ActionButton title="Gram miktarını güncelle" secondary onPress={() => { setEditingGold(holding); setEditingGrams(formatQuantityMicros(holding.quantityMicros)); setError(''); }} />
            <InlineDelete itemName="Altın kaydını" onDelete={async () => { await deleteGoldHolding(db, holding.id); if (editingGold?.id === holding.id) setEditingGold(null); await load(); setNotice('Altın kaydı silindi.'); }} disabled={savingAction !== null} detail="Bağlı satış varsa önce satış kaydını silmelisin." />
          </SectionCard>
        );
      })}

      {editingGold ? (
        <SectionCard>
          <Text style={sharedStyles.cardTitle}>{editingGold.name} miktarını güncelle</Text>
          <Text style={sharedStyles.label}>Toplam gram</Text>
          <TextInput accessibilityLabel="Güncel toplam altın gramı" value={editingGrams} onChangeText={setEditingGrams} keyboardType="decimal-pad" placeholder="Örnek: 12,500000" style={sharedStyles.input} />
          <Text style={sharedStyles.helper}>Bu alan kayıtlı miktarı düzeltir. Gerçek satışta TL hesabına aktarım için yukarıdaki Sat akışını kullan.</Text>
          <ActionButton title="Miktarı kaydet" onPress={saveGoldQuantity} disabled={savingAction !== null} loading={savingAction === 'quantity'} />
          <ActionButton title="Vazgeç" secondary onPress={() => { setEditingGold(null); setEditingGrams(''); }} />
        </SectionCard>
      ) : null}

      {trySavings.length > 0 ? <Text style={sharedStyles.sectionTitle}>TL birikim hesapları</Text> : null}
      {trySavings.map((account) => (
        <SectionCard key={account.id}>
          <Text style={sharedStyles.cardTitle}>{account.name}</Text>
          <Text style={styles.sourceAmount}>{formatMoney(account.balanceMinor, 'TRY')}</Text>
          <Text style={sharedStyles.muted}>Uygulamadaki bakiye · Son gerçek bakiye kontrolü: {account.balanceDate}</Text>
          <InlineDelete itemName="Birikim hesabını" onDelete={async () => { await deleteAccount(db, account.id); await load(); setNotice('Birikim hesabı silindi.'); }} disabled={savingAction !== null} detail="Bağlı kayıt varsa önce bunları silmelisin." />
        </SectionCard>
      ))}

      {conversions.length > 0 ? <Text style={sharedStyles.sectionTitle}>Son bozdurma ve satışlar</Text> : null}
      {conversions.map((conversion) => {
        const target = accounts.find((account) => account.id === conversion.targetAccountId);
        const source = conversion.kind === 'fx_exchange'
          ? accounts.find((account) => account.id === conversion.sourceAccountId)?.name ?? conversion.sourceCode
          : holdings.find((holding) => holding.id === conversion.goldHoldingId)?.name ?? 'Gram altın';
        const quantity = conversion.kind === 'fx_exchange'
          ? formatMoney(conversion.sourceAmountMinor ?? 0, conversion.sourceCode === 'EUR' ? 'EUR' : 'USD')
          : `${formatQuantityMicros(conversion.quantityMicros ?? 0)} gram`;
        return (
          <SectionCard key={conversion.id}>
            <Text style={sharedStyles.cardTitle}>{source} · {conversion.kind === 'fx_exchange' ? 'Bozdurma' : 'Satış'}</Text>
            <Text style={sharedStyles.muted}>{quoteTime(conversion.occurredAt)} · {quantity}</Text>
            <Text style={styles.historyAmount}>+{formatMoney(conversion.netTryMinor, 'TRY')} · {target?.name ?? 'TL hesabı'}</Text>
            <Text style={sharedStyles.helper}>Masraf: {formatMoney(conversion.feeTryMinor, 'TRY')} · Brüt gerçekleşen: {formatMoney(conversion.grossTryMinor, 'TRY')}</Text>
            <InlineDelete itemName="İşlemi" onDelete={async () => { await deleteAssetConversion(db, conversion.id); await load(); setNotice('Bozdurma veya satış kaydı silindi; bakiyeler geri alındı.'); }} disabled={savingAction !== null} detail="Kaynak ve hedef bakiyeler geri alınır. İşlemden sonra yeni bakiye veya hareket varsa güvenli silme engellenir." />
          </SectionCard>
        );
      })}

      <SectionCard>
        <Text style={sharedStyles.cardTitle}>Gram altın ekle</Text>
        <Text style={sharedStyles.label}>Birikim adı</Text>
        <TextInput accessibilityLabel="Altın birikimi adı" value={goldName} onChangeText={setGoldName} placeholder="Örnek: Gram altın birikimim" style={sharedStyles.input} />
        <Text style={sharedStyles.label}>Gram miktarı</Text>
        <TextInput accessibilityLabel="Altın gram miktarı" value={goldGrams} onChangeText={setGoldGrams} keyboardType="decimal-pad" placeholder="Örnek: 12,500000" style={sharedStyles.input} />
        <Text style={sharedStyles.helper}>Miktar gram olarak saklanır. Fiyat alınamazsa TL karşılığı boş kalır.</Text>
        <ActionButton title="Altını kaydet" onPress={saveGold} disabled={savingAction !== null} loading={savingAction === 'gold'} />
      </SectionCard>
      <ActionLink href="/accounts" title="Döviz veya TL birikim hesabı ekle" secondary />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: palette.primary, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  total: { color: palette.ink, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  sourceAmount: { color: palette.ink, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  valuation: { backgroundColor: palette.primarySoft, borderRadius: 12, padding: 13, gap: 4 },
  valuationLabel: { color: palette.primaryDark, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  valuationAmount: { color: palette.ink, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  historyAmount: { color: palette.positive, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
