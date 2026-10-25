import { useCallback, useState } from 'react';
import { Link, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listAccounts, listCardStatements, listCreditCards, listFlexiblePlans, listGoldHoldings, listInstallmentPlans, listOneTimePlans, listPlans, listPriceQuotes } from '@/data/repository';
import { cardPaymentsThrough, formatMoney, localDateString, projectMonths } from '@/domain/finance';
import type { Account, CardStatement, CreditCard, FlexibleMonthlyPlan, InstallmentPlan, MonthlyPlan, OneTimePlan } from '@/domain/finance';
import { formatQuantityMicros, summarizeAssetsTry, valueForeignAccountTry, valueGoldHoldingTry } from '@/domain/valuation';
import type { AssetCode, GoldHolding, PriceQuote } from '@/domain/valuation';
import { refreshPriceQuotes } from '@/services/prices';
import { ActionLink, NavRow, Notice, PageTitle, SectionCard, palette, sharedStyles } from '@/ui/components';

export default function HomeScreen() {
  const db = useSQLiteContext();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [plans, setPlans] = useState<MonthlyPlan[]>([]);
  const [flexiblePlans, setFlexiblePlans] = useState<FlexibleMonthlyPlan[]>([]);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [statements, setStatements] = useState<CardStatement[]>([]);
  const [installments, setInstallments] = useState<InstallmentPlan[]>([]);
  const [oneTimePlans, setOneTimePlans] = useState<OneTimePlan[]>([]);
  const [holdings, setHoldings] = useState<GoldHolding[]>([]);
  const [quotes, setQuotes] = useState<PriceQuote[]>([]);
  const [priceErrors, setPriceErrors] = useState<AssetCode[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useFocusEffect(useCallback(() => {
    let active = true;
    Promise.all([listAccounts(db), listPlans(db), listFlexiblePlans(db), listCreditCards(db), listCardStatements(db), listInstallmentPlans(db), listGoldHoldings(db), listPriceQuotes(db), listOneTimePlans(db)])
      .then(([nextAccounts, nextPlans, nextFlexiblePlans, nextCards, nextStatements, nextInstallments, nextHoldings, nextQuotes, nextOneTimePlans]) => {
        if (!active) return;
        setAccounts(nextAccounts);
        setPlans(nextPlans);
        setFlexiblePlans(nextFlexiblePlans);
        setCards(nextCards);
        setStatements(nextStatements);
        setInstallments(nextInstallments);
        setOneTimePlans(nextOneTimePlans);
        setHoldings(nextHoldings);
        setQuotes(nextQuotes);
        setError('');
        setReady(true);
        refreshPriceQuotes(db)
          .then((result) => {
            if (!active) return;
            setQuotes(result.quotes);
            setPriceErrors(result.errors.map((item) => item.assetCode));
          })
          .catch(() => { if (active) setPriceErrors(['USD', 'EUR', 'XAU_GRAM']); });
      })
      .catch(() => {
        if (active) { setError('Finans verileri okunamadı. Uygulamayı yeniden açmayı dene.'); setReady(true); }
      });
    return () => { active = false; };
  }, [db]));

  const spendingAccounts = accounts.filter((account) => account.currency === 'TRY' && account.purpose === 'spending');
  const currentTry = spendingAccounts.reduce((sum, account) => sum + account.balanceMinor, 0);
  const monthEnd = projectMonths(accounts, plans, new Date(), 1, flexiblePlans, cards, statements, installments, oneTimePlans)[0];
  const today = localDateString();
  const upcomingCardPayments = spendingAccounts.flatMap((account) =>
    cardPaymentsThrough(account, monthEnd.endDate, cards, statements, installments))
    .filter((payment) => payment.paymentDate >= today && !statements.some((statement) =>
      statement.cardId === payment.cardId && statement.statementPeriod === payment.statementPeriod && statement.status === 'paid'))
    .sort((left, right) => left.paymentDate.localeCompare(right.paymentDate))
    .slice(0, 3);
  const hasCurrentTry = spendingAccounts.length > 0;
  const hasPlan = plans.some((plan) => !plan.endsOn) || flexiblePlans.some((plan) => !plan.endsOn) || cards.length > 0 || oneTimePlans.some((plan) => plan.status === 'planned');
  const needsFlexibleEstimate = flexiblePlans.some((plan) =>
    !plan.endsOn && spendingAccounts.some((account) => account.id === plan.accountId && account.remainingFlexibleMinor === null));
  const savings = accounts.filter((account) => account.purpose === 'savings' || account.currency !== 'TRY');
  const assetSummary = summarizeAssetsTry(accounts, holdings, quotes);
  const savingsSummary = summarizeAssetsTry(savings, holdings, quotes);
  const neededPrices = new Set<AssetCode>([
    ...accounts.filter((account) => account.currency !== 'TRY').map((account) => account.currency as AssetCode),
    ...(holdings.length ? ['XAU_GRAM' as AssetCode] : []),
  ]);
  const hasPriceError = priceErrors.some((code) => neededPrices.has(code));

  return (
    <SafeAreaView style={sharedStyles.page} edges={['top']}>
      <ScrollView style={sharedStyles.page} contentContainerStyle={sharedStyles.content}>
        <PageTitle eyebrow="KİŞİSEL FİNANS" title="Varlıklarım" subtitle="Kayıtlı bakiyelerin ve birikimlerinin bugünkü görünümü." />
        {error ? <Notice tone="error" body={error} /> : null}

        <View style={styles.hero}>
          <Text style={styles.heroLabel}>TOPLAM VARLIK · YAKLAŞIK TL</Text>
          <Text style={styles.heroAmount} accessibilityLabel={ready && assetSummary.totalTryMinor !== null ? `Yaklaşık toplam varlık ${formatMoney(assetSummary.totalTryMinor, 'TRY')}` : 'Toplam varlık hesaplanamıyor'}>
            {ready && assetSummary.totalTryMinor !== null ? formatMoney(assetSummary.totalTryMinor, 'TRY') : '—'}
          </Text>
          <Text style={styles.heroCaption}>
            {assetSummary.totalTryMinor === null
              ? 'Döviz veya altın fiyatı eksik olduğu için toplam hesaplanamıyor.'
              : `TL hesaplar, döviz ve altın. Kart borcu düşülmez${assetSummary.status === 'stale' ? ' · eski fiyat kullanılıyor' : ''}.`}
          </Text>
        </View>

        <View style={styles.assetSplit}>
          <View style={styles.assetMetric}>
            <Text style={styles.cardEyebrow}>HARCANABİLİR TL</Text>
            <Text style={styles.metricAmount}>{ready && hasCurrentTry ? formatMoney(currentTry, 'TRY') : '—'}</Text>
            <Text style={sharedStyles.helper}>Uygulamadaki kullanım hesabı bakiyeleri</Text>
          </View>
          <View style={styles.assetMetric}>
            <Text style={styles.cardEyebrow}>BİRİKİMLER</Text>
            <Text style={styles.metricAmount}>{ready && savingsSummary.totalTryMinor !== null ? `≈ ${formatMoney(savingsSummary.totalTryMinor, 'TRY')}` : '—'}</Text>
            <Text style={sharedStyles.helper}>TL, döviz ve altın toplamı</Text>
          </View>
        </View>
        {ready && hasPriceError ? <Text style={styles.priceWarning}>Fiyat yenilenemedi; varsa son başarılı değer gösteriliyor.</Text> : null}
        <View style={styles.quickActions}>
          <ActionLink href="/accounts" title="Hesap bakiyesi" />
          <ActionLink href="/savings" title="Döviz ve altın" />
          <ActionLink href="/plan" title="Maaş geliri ekle" />
        </View>

        {savings.length > 0 || holdings.length > 0 ? (
          <SectionCard>
            <View style={sharedStyles.row}>
              <Text style={sharedStyles.cardTitle}>Birikimlerim</Text>
              <Text style={styles.count}>{savings.length + holdings.length} kayıt</Text>
            </View>
            {savings.map((account) => {
              const quote = quotes.find((item) => item.assetCode === account.currency);
              const tryValue = account.currency !== 'TRY' ? valueForeignAccountTry(account, quote) : null;
              return (
                <View key={account.id} style={styles.assetRow}>
                  <Text style={sharedStyles.muted}>{account.name} · {formatMoney(account.balanceMinor, account.currency)}</Text>
                  {account.currency !== 'TRY' ? <Text style={styles.assetAmount}>{tryValue === null ? 'Fiyat yok' : `≈ ${formatMoney(tryValue, 'TRY')}`}</Text> : null}
                </View>
              );
            })}
            {holdings.map((holding) => {
              const quote = quotes.find((item) => item.assetCode === 'XAU_GRAM');
              const tryValue = valueGoldHoldingTry(holding, quote);
              return (
                <View key={holding.id} style={styles.assetRow}>
                  <Text style={sharedStyles.muted}>{holding.name} · {formatQuantityMicros(holding.quantityMicros)} gram</Text>
                  <Text style={styles.assetAmount}>{tryValue === null ? 'Fiyat yok' : `≈ ${formatMoney(tryValue, 'TRY')}`}</Text>
                </View>
              );
            })}
            <Text style={sharedStyles.helper}>Döviz ve altın değerleri harcanabilir TL’ye katılmaz.</Text>
            <ActionLink href="/savings" title="Birikimlere git" />
          </SectionCard>
        ) : null}

        <SectionCard>
          <Text style={sharedStyles.cardTitle}>Ay sonu görünümü</Text>
          <Text style={sharedStyles.helper}>Uygulamadaki bakiyeler, gelir gider planı ve kart ödemelerine göre tahmini harcanabilir TL.</Text>
          <Text style={[styles.currentAmount, hasCurrentTry && monthEnd.spendingTryMinor < 0 && styles.negativeAmount]}>
            {ready && hasCurrentTry ? formatMoney(monthEnd.spendingTryMinor, 'TRY') : '—'}
          </Text>
          <ActionLink href="/forecast" title="Gelecek ayları gör" secondary />
        </SectionCard>

        {ready && spendingAccounts.length > 0 ? (
          <SectionCard>
            <Text style={sharedStyles.cardTitle}>Hesaplarında ay sonunda ne kalacak?</Text>
            <Text style={sharedStyles.helper}>Her hesabın uygulamadaki bakiyesi ve o hesaba bağladığın gelir, gider ve kart ödemeleriyle hesaplanır.</Text>
            {spendingAccounts.map((account) => {
              const projected = monthEnd.balances.find((balance) => balance.accountId === account.id)?.balanceMinor;
              const missingEstimate = flexiblePlans.some((plan) => plan.accountId === account.id && !plan.endsOn)
                && account.remainingFlexibleMinor === null;
              return (
                <View key={account.id} style={styles.accountForecast}>
                  <Text style={styles.accountForecastName}>{account.name}</Text>
                  <Text style={sharedStyles.muted}>Uygulamadaki bakiye: {formatMoney(account.balanceMinor, 'TRY')} · Son gerçek bakiye kontrolü: {account.balanceDate}</Text>
                  <Text style={[styles.accountForecastAmount, projected !== undefined && projected < 0 && styles.negativeAmount]}>
                    Ay sonunda kalacak: {formatMoney(projected ?? account.balanceMinor, 'TRY')}
                  </Text>
                  {missingEstimate ? <Text style={styles.priceWarning}>Bu ay kalan değişken gider henüz girilmedi; tutar eksik olabilir.</Text> : null}
                </View>
              );
            })}
            {needsFlexibleEstimate ? <ActionLink href="/accounts" title="Bu ay kalan gideri hesapta belirt" secondary /> : null}
            <ActionLink href="/forecast" title="Gelecek ayları ve hesapları gör" secondary />
          </SectionCard>
        ) : null}

        <SectionCard>
          <Text style={sharedStyles.cardTitle}>Nasıl kullanılır?</Text>
          <Link href="/accounts" style={styles.guideLink}>1 · Hesap ekle ve güncel bakiyeni gir →</Link>
          <Text style={styles.guideText}>2 · Aylık gelir/gider ile kart ve ekstre ödemelerini planla.</Text>
          <View style={styles.guideActions}>
            <Link href="/plan" style={styles.guideAction}>Plan →</Link>
            <Link href="/cards" style={styles.guideAction}>Kartlar →</Link>
          </View>
          <Link href="/accounts" style={styles.guideLink}>3 · Bakiyeni ara sıra güncelle, tahmin farkını izle →</Link>
          <Text style={sharedStyles.helper}>Günlük alışverişleri tek tek girmen gerekmez.</Text>
        </SectionCard>

        {!ready ? <Notice body="Hesaplar ve aylık plan yükleniyor." /> : null}
        {ready && accounts.length === 0 ? (
          <SectionCard>
            <Text style={sharedStyles.cardTitle}>İlk adım: hesap ekle</Text>
            <Text style={sharedStyles.helper}>Bir banka veya nakit hesabı ve güncel bakiyesini gir. Aylık planı sonra ekleyebilirsin.</Text>
            <ActionLink href="/accounts" title="Hesap ekle" />
          </SectionCard>
        ) : null}
        {ready && hasCurrentTry && !hasPlan ? (
          <Notice title="Tahmin henüz eksik" body="Gelir, gider veya kart eklenmedi. Bu yüzden ay sonu tahmini yalnızca kayıtlı bakiyeyi gösteriyor." tone="warning" />
        ) : null}
        {ready && needsFlexibleEstimate ? (
          <Notice title="Bu ayın değişken gideri eksik" body="Hesap bakiyeni güncelleyip ayın kalanında ne kadar harcayacağını girersen tahmin buna göre yenilenir." tone="warning" />
        ) : null}
        {ready && hasCurrentTry && monthEnd.spendingTryMinor < 0 ? (
          <Notice title="Ay sonunda nakit açığı olabilir" body="Planlanan TL hareketleri ve kart ödemeleri sonrası harcanabilir bakiye eksiye düşüyor. Kartların son ödeme tarihlerini Kartlar ekranında incele." tone="warning" />
        ) : null}

        {ready && cards.length > 0 ? (
          <SectionCard>
            <Text style={sharedStyles.cardTitle}>Yaklaşan kart ödemeleri</Text>
            {upcomingCardPayments.length ? upcomingCardPayments.map((payment) => {
              const card = cards.find((item) => item.id === payment.cardId);
              return (
                <View key={`${payment.cardId}-${payment.statementPeriod}`} style={styles.paymentRow}>
                  <View style={styles.paymentInfo}>
                    <Text style={styles.paymentTitle}>{card?.name ?? 'Kart'} · {payment.paymentDate}</Text>
                    <Text style={sharedStyles.muted}>{payment.source === 'actual' ? 'Gerçek ekstre · planlanan ödeme' : 'Ekstre ödeme tahmini'}</Text>
                  </View>
                  <Text style={styles.paymentAmount}>{formatMoney(payment.amountMinor, 'TRY')}</Text>
                </View>
              );
            }) : <Text style={sharedStyles.helper}>Bu ay için yaklaşan kart ödemesi görünmüyor.</Text>}
            <ActionLink href="/cards" title="Kartlar ve taksitler" />
          </SectionCard>
        ) : null}

        <Text style={sharedStyles.sectionTitle}>Devam et</Text>
        <SectionCard>
          <NavRow href="/accounts" title="Hesaplar ve bakiyeler" subtitle="Gerçek bakiyeni güncelle" />
          <View style={styles.separator} />
          <NavRow href="/plan" title="Gelir ve gider planı" subtitle="Aylık ve tek seferlik kalemler" />
          <View style={styles.separator} />
          <NavRow href="/cards" title="Kartlar ve taksitler" subtitle="Ekstreleri ve ödemeleri izle" />
          <View style={styles.separator} />
          <NavRow href="/savings" title="Döviz ve altın" subtitle="Miktar ve yaklaşık TL değeri" />
          <View style={styles.separator} />
          <NavRow href="/forecast" title="Gelecek aylar" subtitle="Nakit akışı ve tahmin" />
          <View style={styles.separator} />
          <NavRow href="/data" title="Yedek ve veri" subtitle="Şifreli yedek oluştur veya geri yükle" />
        </SectionCard>
        <Text style={styles.footnote}>Yaklaşık piyasa değeri gerçekleşen bozdurma tutarı değildir.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: palette.primaryDark, borderRadius: 22, padding: 22, gap: 12 },
  heroLabel: { color: '#BDEBE0', fontSize: 11, fontWeight: '800', letterSpacing: 0.7, lineHeight: 16 },
  heroAmount: { color: '#FFFFFF', fontSize: 35, lineHeight: 42, fontWeight: '800', fontVariant: ['tabular-nums'], flexShrink: 1 },
  heroCaption: { color: '#D3E8E5', fontSize: 13, lineHeight: 19 },
  assetSplit: { flexDirection: 'row', gap: 10 },
  assetMetric: { flex: 1, backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1, borderRadius: 16, padding: 14, gap: 6 },
  metricAmount: { color: palette.ink, fontSize: 21, lineHeight: 27, fontWeight: '800', fontVariant: ['tabular-nums'], flexShrink: 1 },
  quickActions: { gap: 8 },
  cardEyebrow: { color: palette.primary, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  currentAmount: { color: palette.ink, fontSize: 27, fontWeight: '800', fontVariant: ['tabular-nums'] },
  accountForecast: { borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 12, gap: 3 },
  accountForecastName: { color: palette.ink, fontSize: 16, fontWeight: '800' },
  accountForecastAmount: { color: palette.primary, fontSize: 19, fontWeight: '800', fontVariant: ['tabular-nums'] },
  negativeAmount: { color: palette.negative },
  guideLink: { color: palette.ink, fontSize: 14, lineHeight: 20, fontWeight: '700', minHeight: 44, paddingVertical: 10 },
  guideText: { color: palette.ink, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  guideActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  guideAction: { color: palette.primaryDark, fontSize: 13, fontWeight: '800', minHeight: 44, paddingVertical: 12 },
  separator: { height: 1, backgroundColor: palette.border, marginHorizontal: 12 },
  count: { color: palette.primary, fontSize: 12, fontWeight: '700' },
  assetRow: { gap: 2, paddingVertical: 4 },
  assetAmount: { color: palette.ink, fontSize: 14, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  priceWarning: { color: palette.warning, fontSize: 12, lineHeight: 18 },
  paymentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 5 },
  paymentInfo: { flex: 1, gap: 2 },
  paymentTitle: { color: palette.ink, fontSize: 14, fontWeight: '700' },
  paymentAmount: { color: palette.ink, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right' },
  footnote: { color: palette.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 2 },
});
