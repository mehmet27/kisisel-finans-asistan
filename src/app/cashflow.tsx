import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  listAccounts, listCardStatements, listCreditCards, listFlexiblePlans,
  listInstallmentPlans, listOneTimePlans, listPlans,
} from '@/data/repository';
import { buildCashFlowTimeline } from '@/domain/cashflow';
import type { CashFlowInput } from '@/domain/cashflow';
import { formatMoney } from '@/domain/finance';
import { ActionButton, ActionLink, Choice, Notice, PageTitle, SectionCard, palette, sharedStyles } from '@/ui/components';

function readableDate(value: string): string {
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

function readableMonth(value: string): string {
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(`${value}-01T12:00:00`));
}

export default function CashFlowScreen() {
  const db = useSQLiteContext();
  const [input, setInput] = useState<CashFlowInput | null>(null);
  const [months, setMonths] = useState<3 | 6 | 12>(3);
  const [monthIndex, setMonthIndex] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(7);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useFocusEffect(useCallback(() => {
    let active = true;
    Promise.all([
      listAccounts(db), listPlans(db), listFlexiblePlans(db), listCreditCards(db),
      listCardStatements(db), listInstallmentPlans(db), listOneTimePlans(db),
    ]).then(([accounts, plans, flexiblePlans, cards, statements, installments, oneTimePlans]) => {
      if (!active) return;
      setInput({ accounts, plans, flexiblePlans, cards, statements, installments, oneTimePlans });
      setReady(true);
      setError('');
    }).catch(() => { if (active) { setReady(true); setError('Nakit akışı okunamadı. Tekrar açmayı dene.'); } });
    return () => { active = false; };
  }, [db]));

  const timeline = useMemo(() => input ? buildCashFlowTimeline(input, new Date(), months) : null, [input, months]);
  const selectedMonth = timeline?.monthEnds[monthIndex];
  const selectedPeriod = selectedMonth?.period;
  const activityDays = timeline?.days.filter((day) => day.date.startsWith(selectedPeriod ?? '')
    && (day.events.length > 0 || day.hasTotalShortfall || day.shortfallAccountIds.length > 0)) ?? [];
  const detailDay = activityDays.find((day) => day.date === selectedDate) ?? activityDays[0];
  const spendingAccounts = input?.accounts.filter((account) => account.currency === 'TRY' && account.purpose === 'spending') ?? [];

  function selectMonth(index: number) {
    setMonthIndex(index);
    setSelectedDate(null);
    setVisibleCount(7);
  }

  return (
    <ScrollView style={sharedStyles.page} contentContainerStyle={sharedStyles.content}>
      <PageTitle eyebrow="GÜNLÜK NAKİT AKIŞI" title="Ödeme günleri" subtitle="Ay sonundan önce oluşabilecek TL açığını gör." />
      {!ready ? <Notice body="Nakit akışı yükleniyor." /> : null}
      {error ? <Notice tone="error" body={error} /> : null}
      {ready && spendingAccounts.length === 0 ? (
        <SectionCard>
          <Text style={sharedStyles.cardTitle}>TL kullanım hesabı ekle</Text>
          <Text style={sharedStyles.helper}>Günlük TL akışını görmek için önce bir TL kullanım hesabı gerekiyor.</Text>
          <ActionLink href="/accounts" title="Hesaplara git" />
        </SectionCard>
      ) : null}
      {timeline && spendingAccounts.length > 0 ? (
        <>
          {timeline.firstShortfallDate ? (
            <Notice tone="warning" title={`İlk toplam TL açığı: ${readableDate(timeline.firstShortfallDate)}`} body="Gün içindeki planlı çıkışlar, o günün girişlerinden önce uygulanmış olabilir. Bu tarih ihtiyatlı tahmindir." />
          ) : <Notice title="Toplam TL açığı görünmüyor" body="Seçilen dönemde gün içi toplam kullanım bakiyesi eksiye düşmüyor." />}
          {timeline.firstAccountShortfallDate && timeline.firstAccountShortfallDate !== timeline.firstShortfallDate ? (
            <Notice tone="warning" title={`İlk hesap bazlı açık: ${readableDate(timeline.firstAccountShortfallDate)}`} body="Bir TL kullanım hesabı eksiye düşerken diğer hesaplarda para olabilir. Hesaplar arası otomatik transfer varsayılmıyor." />
          ) : null}

          <Choice<3 | 6 | 12> value={months} onChange={(value) => { setMonths(value); selectMonth(0); }} options={[{ value: 3, label: '3 ay' }, { value: 6, label: '6 ay' }, { value: 12, label: '12 ay' }]} />
          <SectionCard>
            <Text style={styles.monthTitle}>{selectedPeriod ? readableMonth(selectedPeriod) : 'Dönem'}</Text>
            <Text style={styles.monthAmount}>{selectedMonth ? formatMoney(selectedMonth.spendingTryMinor, 'TRY') : '—'}</Text>
            <Text style={sharedStyles.muted}>Ay sonu tahmini harcanabilir TL</Text>
            <View style={styles.monthControls}>
              <View style={styles.monthControl}><ActionButton title="← Önceki ay" onPress={() => selectMonth(monthIndex - 1)} disabled={monthIndex === 0} secondary /></View>
              <View style={styles.monthControl}><ActionButton title="Sonraki ay →" onPress={() => selectMonth(monthIndex + 1)} disabled={monthIndex >= months - 1} secondary /></View>
            </View>
          </SectionCard>

          <SectionCard>
            <Text style={sharedStyles.cardTitle}>Bu ayın hareketli günleri</Text>
            <Text style={sharedStyles.helper}>Ödeme veya gelir olan ve açık yaşanan günleri gösteriyoruz. Bir güne dokunarak ayrıntıyı aç.</Text>
            {activityDays.length === 0 ? <Text style={sharedStyles.helper}>Bu ay için planlanan hareket veya nakit açığı yok.</Text> : null}
            {activityDays.slice(0, visibleCount).map((day) => (
              <Pressable
                key={day.date}
                accessibilityRole="button"
                accessibilityLabel={`${readableDate(day.date)}, ${day.events.length} hareket, gün sonu ${formatMoney(day.spendingTryMinor, 'TRY')}`}
                accessibilityState={{ selected: day.date === detailDay?.date }}
                onPress={() => setSelectedDate(day.date)}
                style={({ pressed }) => [styles.dayRow, day.date === detailDay?.date && styles.dayRowSelected, pressed && styles.dayRowPressed]}
              >
                <View style={styles.dayInfo}>
                  <Text style={styles.dayDate}>{readableDate(day.date)}</Text>
                  <Text style={styles.dayMeta}>{day.events.length} hareket{day.hasTotalShortfall ? ' · toplam TL açığı' : day.shortfallAccountIds.length ? ' · hesap bazlı açık' : ''}</Text>
                </View>
                <Text style={styles.dayAmount}>{formatMoney(day.spendingTryMinor, 'TRY')}</Text>
              </Pressable>
            ))}
            {visibleCount < activityDays.length ? <ActionButton title="Daha fazla gün göster" onPress={() => setVisibleCount((count) => count + 7)} secondary /> : null}
          </SectionCard>

          {detailDay ? (
            <SectionCard>
              <Text style={sharedStyles.cardTitle}>{readableDate(detailDay.date)} ayrıntısı</Text>
              {detailDay.hasTotalShortfall ? <Text style={styles.warning}>Bu gün toplam TL, en az bir anda eksiye düştü.</Text> : null}
              {detailDay.shortfallAccountIds.length > 0 ? (
                <Text style={styles.warning}>Hesap bazlı açık: {detailDay.shortfallAccountIds.map((id) => input?.accounts.find((account) => account.id === id)?.name ?? 'Hesap').join(', ')}</Text>
              ) : null}
              {detailDay.events.map((event, index) => {
                const account = input?.accounts.find((item) => item.id === event.accountId);
                return (
                  <View key={`${event.sourceKind}-${event.sourceId}-${index}`} style={styles.eventRow}>
                    <View style={styles.eventInfo}>
                      <Text style={styles.eventTitle}>{event.title}</Text>
                      <Text style={sharedStyles.muted}>{account?.name ?? 'Hesap'} · {event.assumption}</Text>
                    </View>
                    <Text style={[styles.eventAmount, event.amountMinor < 0 && styles.negative]}>
                      {event.amountMinor > 0 ? '+' : '−'}{formatMoney(Math.abs(event.amountMinor), account?.currency ?? 'TRY')}
                    </Text>
                  </View>
                );
              })}
              <Text style={sharedStyles.helper}>Gün sonu harcanabilir TL: {formatMoney(detailDay.spendingTryMinor, 'TRY')}</Text>
            </SectionCard>
          ) : null}

          <SectionCard>
            <Text style={sharedStyles.cardTitle}>Tahmin varsayımları</Text>
            {timeline.assumptions.map((assumption) => <Text key={assumption} style={sharedStyles.helper}>• {assumption}</Text>)}
            <ActionLink href="/scenario" title="Geçici senaryo dene" />
          </SectionCard>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  monthTitle: { color: palette.primary, fontSize: 15, fontWeight: '800', textTransform: 'capitalize' },
  monthAmount: { color: palette.ink, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  monthControls: { flexDirection: 'row', gap: 9 },
  monthControl: { flex: 1 },
  dayRow: { minHeight: 58, borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, paddingHorizontal: 11, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 9 },
  dayRowSelected: { borderColor: palette.primary, backgroundColor: palette.primarySoft },
  dayRowPressed: { backgroundColor: palette.mintPressed },
  dayInfo: { flex: 1, gap: 2 },
  dayDate: { color: palette.ink, fontSize: 14, fontWeight: '800' },
  dayMeta: { color: palette.muted, fontSize: 12, lineHeight: 16 },
  dayAmount: { color: palette.ink, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right' },
  warning: { color: palette.warning, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  eventRow: { borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 10, flexDirection: 'row', gap: 8 },
  eventInfo: { flex: 1, gap: 2 },
  eventTitle: { color: palette.ink, fontSize: 14, fontWeight: '700' },
  eventAmount: { color: palette.positive, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right' },
  negative: { color: palette.negative },
});
