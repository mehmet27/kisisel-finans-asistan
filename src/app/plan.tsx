import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  cancelOneTimePlan, createActualExpense, createCategory, createFlexiblePlan, createOneTimePlan, createPlan,
  deleteActualExpense, deleteCategory, deleteFlexiblePlan, deleteOneTimePlan, deletePlan,
  listAccounts, listActualExpenses, listCategories, listCategoryMonthlyTotals, listFlexiblePlans,
  listOneTimePlans, listPlans, stopFlexiblePlan, stopPlan,
} from '@/data/repository';
import { formatMoney, localDateString, parseAmountMinor } from '@/domain/finance';
import type { Account, FlexibleMonthlyPlan, MonthlyPlan, OneTimePlan, PlanKind } from '@/domain/finance';
import { ActionButton, ActionLink, Choice, InlineDelete, Notice, PageTitle, SectionCard, palette, sharedStyles } from '@/ui/components';

function validDate(value: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return !Number.isNaN(parsed.getTime()) && localDateString(parsed) === value;
}

type PlanAction = { kind: 'regular' | 'flexible' | 'oneTime'; id: string };
type Categories = Awaited<ReturnType<typeof listCategories>>;
type ActualExpenses = Awaited<ReturnType<typeof listActualExpenses>>;
type CategoryTotals = Awaited<ReturnType<typeof listCategoryMonthlyTotals>>;

export default function PlanScreen() {
  const db = useSQLiteContext();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [plans, setPlans] = useState<MonthlyPlan[]>([]);
  const [flexiblePlans, setFlexiblePlans] = useState<FlexibleMonthlyPlan[]>([]);
  const [oneTimePlans, setOneTimePlans] = useState<OneTimePlan[]>([]);
  const [categories, setCategories] = useState<Categories>([]);
  const [actualExpenses, setActualExpenses] = useState<ActualExpenses>([]);
  const [categoryTotals, setCategoryTotals] = useState<CategoryTotals>([]);
  const [monthInput, setMonthInput] = useState(localDateString().slice(0, 7));
  const [selectedMonth, setSelectedMonth] = useState(localDateString().slice(0, 7));
  const [categoryName, setCategoryName] = useState('');
  const [regularCategoryId, setRegularCategoryId] = useState('');
  const [flexibleCategoryId, setFlexibleCategoryId] = useState('');
  const [oneTimeCategoryId, setOneTimeCategoryId] = useState('');
  const [actualCategoryId, setActualCategoryId] = useState('');
  const [actualAccountId, setActualAccountId] = useState<string | null>(null);
  const [actualAmount, setActualAmount] = useState('');
  const [actualDate, setActualDate] = useState(localDateString());
  const [actualPlanLink, setActualPlanLink] = useState('');
  const [actualConfirming, setActualConfirming] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [kind, setKind] = useState<PlanKind>('income');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDay, setDueDay] = useState('1');
  const [flexibleAccountId, setFlexibleAccountId] = useState<string | null>(null);
  const [flexibleTitle, setFlexibleTitle] = useState('');
  const [flexibleAmount, setFlexibleAmount] = useState('');
  const [oneTimeAccountId, setOneTimeAccountId] = useState<string | null>(null);
  const [oneTimeKind, setOneTimeKind] = useState<PlanKind>('income');
  const [oneTimeTitle, setOneTimeTitle] = useState('');
  const [oneTimeAmount, setOneTimeAmount] = useState('');
  const [oneTimeDueOn, setOneTimeDueOn] = useState(localDateString());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [savingAction, setSavingAction] = useState<'regular' | 'flexible' | 'oneTime' | 'category' | 'actual' | null>(null);
  const [pendingAction, setPendingAction] = useState<PlanAction | null>(null);
  const [workingAction, setWorkingAction] = useState<PlanAction | null>(null);
  const [actionError, setActionError] = useState<{ action: PlanAction; message: string } | null>(null);
  const workingRef = useRef(false);

  const refresh = useCallback(async () => {
    const [nextAccounts, nextPlans, nextFlexiblePlans, nextOneTimePlans, nextCategories, nextActual, nextTotals] = await Promise.all([
      listAccounts(db), listPlans(db), listFlexiblePlans(db), listOneTimePlans(db),
      listCategories(db), listActualExpenses(db, selectedMonth), listCategoryMonthlyTotals(db, selectedMonth),
    ]);
    setAccounts(nextAccounts);
    setPlans(nextPlans);
    setFlexiblePlans(nextFlexiblePlans);
    setOneTimePlans(nextOneTimePlans);
    setCategories(nextCategories);
    setActualExpenses(nextActual);
    setCategoryTotals(nextTotals);
    setAccountId((current) => current ?? nextAccounts[0]?.id ?? null);
    setOneTimeAccountId((current) => current ?? nextAccounts[0]?.id ?? null);
    setFlexibleAccountId((current) => current ?? nextAccounts.find((account) => account.currency === 'TRY' && account.purpose === 'spending')?.id ?? null);
    setActualAccountId((current) => nextAccounts.some((account) => account.id === current && account.currency === 'TRY' && account.purpose === 'spending')
      ? current : nextAccounts.find((account) => account.currency === 'TRY' && account.purpose === 'spending')?.id ?? null);
    return { accounts: nextAccounts, plans: nextPlans, flexiblePlans: nextFlexiblePlans, oneTimePlans: nextOneTimePlans };
  }, [db, selectedMonth]);

  useFocusEffect(useCallback(() => {
    refresh().catch(() => setError('Aylık plan okunamadı.'));
  }, [refresh]));

  async function save() {
    const parsedAmount = parseAmountMinor(amount);
    const parsedDay = Number(dueDay);
    if (!accountId || !title.trim() || parsedAmount === null || parsedAmount <= 0 || !Number.isInteger(parsedDay) || parsedDay < 1 || parsedDay > 31) {
      setError('Hesap, ad, pozitif tutar ve 1–31 arasında bir gün girin.');
      return;
    }
    setSavingAction('regular');
    setError('');
    try {
      await createPlan(db, { accountId, title, kind, amountMinor: parsedAmount, dueDay: parsedDay, categoryId: kind === 'expense' ? regularCategoryId || null : null });
      setTitle(''); setAmount('');
      await refresh();
    } catch {
      setError('Plan kaydedilemedi. Tekrar deneyin.');
    } finally {
      setSavingAction(null);
    }
  }

  async function saveFlexible() {
    const parsedAmount = parseAmountMinor(flexibleAmount);
    if (!flexibleAccountId || !flexibleTitle.trim() || parsedAmount === null || parsedAmount <= 0) {
      setError('Değişken gider için TL kullanım hesabı, ad ve pozitif aylık tutar girin.');
      return;
    }
    setSavingAction('flexible');
    setError('');
    try {
      await createFlexiblePlan(db, { accountId: flexibleAccountId, title: flexibleTitle, amountMinor: parsedAmount, categoryId: flexibleCategoryId || null });
      setFlexibleTitle('');
      setFlexibleAmount('');
      await refresh();
    } catch {
      setError('Değişken gider kaydedilemedi. Tekrar deneyin.');
    } finally {
      setSavingAction(null);
    }
  }

  async function saveOneTime() {
    const parsedAmount = parseAmountMinor(oneTimeAmount);
    if (!oneTimeAccountId || !oneTimeTitle.trim() || parsedAmount === null || parsedAmount <= 0 || !validDate(oneTimeDueOn) || oneTimeDueOn < localDateString()) {
      setError('Tek seferlik kalem için hesap, ad, pozitif tutar ve bugün veya sonrası için geçerli YYYY-AA-GG tarihi gir.');
      return;
    }
    setSavingAction('oneTime');
    setError('');
    try {
      await createOneTimePlan(db, {
        accountId: oneTimeAccountId, title: oneTimeTitle, kind: oneTimeKind,
        amountMinor: parsedAmount, dueOn: oneTimeDueOn,
        categoryId: oneTimeKind === 'expense' ? oneTimeCategoryId || null : null,
      });
      setOneTimeTitle(''); setOneTimeAmount('');
      await refresh();
    } catch {
      setError('Tek seferlik kalem kaydedilemedi. Tekrar dene.');
    } finally {
      setSavingAction(null);
    }
  }

  async function saveCategory() {
    if (!categoryName.trim()) { setError('Kategori adı gir.'); return; }
    setSavingAction('category');
    setError('');
    try {
      await createCategory(db, { name: categoryName });
      setCategoryName('');
      await refresh();
      setNotice('Kategori eklendi. Gider kalemlerine bağlayabilirsin.');
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : 'Kategori eklenemedi. Tekrar dene.');
    } finally {
      setSavingAction(null);
    }
  }

  function confirmActualExpense() {
    const parsedAmount = parseAmountMinor(actualAmount);
    const account = accounts.find((item) => item.id === actualAccountId);
    if (!account || parsedAmount === null || parsedAmount <= 0 || !validDate(actualDate) || actualDate > localDateString()) {
      setError('Gerçek harcama için TL kullanım hesabı, pozitif tutar ve bugün veya önceki geçerli bir tarih gir.');
      return;
    }
    if (actualDate < account.balanceDate) {
      setError(`Harcama tarihi hesabın son bakiye girişinden (${account.balanceDate}) önce olamaz.`);
      return;
    }
    setError('');
    setActualConfirming(true);
  }

  async function saveActualExpense() {
    const parsedAmount = parseAmountMinor(actualAmount);
    if (!actualAccountId || parsedAmount === null || parsedAmount <= 0 || !validDate(actualDate) || actualDate > localDateString()) {
      setActualConfirming(false);
      setError('Gerçek harcama bilgilerini tekrar kontrol et.');
      return;
    }
    setSavingAction('actual');
    setError('');
    try {
      const before = (await listAccounts(db)).find((account) => account.id === actualAccountId);
      if (!before || actualDate < before.balanceDate) {
        setActualConfirming(false);
        setError('Harcama tarihi hesabın son bakiye girişinden önce olamaz. Tarihi veya hesabı kontrol et.');
        return;
      }
      const [planType, planId] = actualPlanLink ? actualPlanLink.split(':', 2) : [];
      await createActualExpense(db, {
        accountId: actualAccountId, categoryId: actualCategoryId || null, amountMinor: parsedAmount, occurredOn: actualDate,
        ...(planType && planId ? { planType: planType as 'regular' | 'flexible' | 'one_time', planId } : {}),
      });
      setActualAmount('');
      setActualConfirming(false);
      setActualPlanLink('');
      const month = actualDate.slice(0, 7);
      const updated = await refresh();
      if (month !== selectedMonth) { setMonthInput(month); setSelectedMonth(month); }
      const after = updated.accounts.find((account) => account.id === actualAccountId);
      setNotice(before && after
        ? `Gerçek harcama kaydedildi. ${before.name} bakiyesi: ${formatMoney(before.balanceMinor, 'TRY')} → ${formatMoney(after.balanceMinor, 'TRY')}.`
        : 'Gerçek harcama kaydedildi. Hesap bakiyesini Hesaplar ekranında kontrol et.');
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : 'Gerçek harcama kaydedilemedi. Tekrar dene.');
    } finally {
      setSavingAction(null);
    }
  }

  function showMonth() {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthInput)) {
      setError('Ay için YYYY-AA biçimini kullan. Örnek: 2026-10.');
      return;
    }
    setError('');
    setSelectedMonth(monthInput);
  }

  function beginAction(action: PlanAction) {
    if (workingAction || savingAction !== null) return;
    setPendingAction(action);
    setActionError(null);
  }

  async function applyAction(action: PlanAction) {
    if (workingRef.current || savingAction !== null) return;
    workingRef.current = true;
    setWorkingAction(action);
    setActionError(null);
    try {
      if (action.kind === 'regular') await stopPlan(db, action.id);
      else if (action.kind === 'flexible') await stopFlexiblePlan(db, action.id);
      else await cancelOneTimePlan(db, action.id);
      const updated = await refresh();
      const verified = action.kind === 'regular'
        ? !!updated.plans.find((plan) => plan.id === action.id)?.endsOn
        : action.kind === 'flexible'
          ? !!updated.flexiblePlans.find((plan) => plan.id === action.id)?.endsOn
          : updated.oneTimePlans.find((plan) => plan.id === action.id)?.status === 'cancelled';
      if (!verified) throw new Error('Kayıt yeniden okundu ancak durdurulduğu doğrulanamadı. Tekrar dene.');
      setPendingAction(null);
    } catch (cause) {
      setActionError({
        action,
        message: cause instanceof Error && cause.message.startsWith('Kayıt yeniden okundu')
          ? cause.message
          : 'İşlem kaydedilemedi veya plan yeniden okunamadı. Tekrar dene.',
      });
    } finally {
      workingRef.current = false;
      setWorkingAction(null);
    }
  }

  function actionControls(action: PlanAction, label: string) {
    const pending = pendingAction?.kind === action.kind && pendingAction.id === action.id;
    const working = workingAction?.kind === action.kind && workingAction.id === action.id;
    const failure = actionError?.action.kind === action.kind && actionError.action.id === action.id
      ? actionError.message : null;
    return (
      <>
        {failure ? <Notice tone="error" body={failure} /> : null}
        {pending ? (
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitle}>{action.kind === 'oneTime' ? 'Bu kalem iptal edilsin mi?' : 'Bu kalem gelecek aylarda durdurulsun mu?'}</Text>
            <Text style={sharedStyles.helper}>{action.kind === 'oneTime'
              ? 'Tek seferlik kalem tahminden çıkarılır.'
              : 'Bu ayın kalan planı korunur; gelecek aylarda tekrar etmez.'}</Text>
            <ActionButton title={working ? 'Kaydediliyor…' : action.kind === 'oneTime' ? 'Evet, iptal et' : 'Evet, durdur'} destructive onPress={() => applyAction(action)} disabled={!!workingAction || savingAction !== null} loading={working} />
            <ActionButton title="Vazgeç" secondary onPress={() => { setPendingAction(null); setActionError(null); }} disabled={!!workingAction || savingAction !== null} />
          </View>
        ) : <ActionButton title={label} destructive onPress={() => beginAction(action)} disabled={!!workingAction || savingAction !== null} />}
      </>
    );
  }

  const flexibleAccounts = accounts.filter((account) => account.currency === 'TRY' && account.purpose === 'spending');
  const actualAccount = flexibleAccounts.find((account) => account.id === actualAccountId);
  const actualPlanOptions = [
    { value: '', label: 'Serbest harcama · ek gider' },
    ...plans.filter((plan) => plan.kind === 'expense' && plan.accountId === actualAccountId && plan.startsOn <= actualDate && (!plan.endsOn || plan.endsOn >= actualDate))
      .map((plan) => ({ value: `regular:${plan.id}`, label: `Düzenli · ${plan.title}` })),
    ...flexiblePlans.filter((plan) => plan.accountId === actualAccountId && plan.startsOn <= actualDate && (!plan.endsOn || plan.endsOn >= actualDate))
      .map((plan) => ({ value: `flexible:${plan.id}`, label: `Bütçe · ${plan.title}` })),
    ...oneTimePlans.filter((plan) => plan.kind === 'expense' && plan.status === 'planned' && plan.accountId === actualAccountId && plan.dueOn.slice(0, 7) === actualDate.slice(0, 7))
      .map((plan) => ({ value: `one_time:${plan.id}`, label: `Tek seferlik · ${plan.title}` })),
  ];
  const linkedPlan = actualPlanLink ? [...plans, ...flexiblePlans, ...oneTimePlans].find((plan) => plan.id === actualPlanLink.split(':', 2)[1]) : null;
  const categoryOptions = [
    { value: '', label: 'Kategorisiz' },
    ...categories.map((category) => ({ value: category.id, label: category.name })),
  ];
  const categoryLabel = (id: string | null | undefined) => categories.find((category) => category.id === id)?.name ?? 'Kategorisiz';

  return (
    <ScrollView style={sharedStyles.page} contentContainerStyle={sharedStyles.content} keyboardShouldPersistTaps="handled">
      <PageTitle eyebrow="GELİR VE GİDER" title="Gelir ve gider planı" subtitle="Düzenli, tek seferlik ve yaklaşık değişken kalemlerini ekle." />
      <Notice body="Tarihli kalemler seçtiğin günde işlenir. Market ve ulaşım gibi değişken giderler için aylık bir bütçe girmen yeterli." />
      <ActionLink href="/forecast" title="Hesaplarda ay sonunda ne kalacağını gör" secondary />
      {error ? <Notice tone="error" body={error} /> : null}
      {notice ? <Notice body={notice} /> : null}
      <SectionCard>
        <Text style={sharedStyles.cardTitle}>Aylık gelir veya gider ekle</Text>
        <Text style={sharedStyles.helper}>Maaş için Gelir türünü seçip yattığı hesabı, tutarı ve ayın gününü gir.</Text>
        {accounts.length ? (
          <>
            <Text style={sharedStyles.label}>Türü</Text>
            <Choice<PlanKind> value={kind} onChange={setKind} options={[{ value: 'income', label: 'Gelir' }, { value: 'expense', label: 'Gider' }]} />
            <Text style={sharedStyles.label}>Hesap</Text>
            <Choice<string>
              value={accountId ?? accounts[0].id}
              onChange={setAccountId}
              options={accounts.map((account) => ({ value: account.id, label: `${account.name} (${account.currency})` }))}
            />
            <Text style={sharedStyles.label}>Adı</Text>
            <TextInput accessibilityLabel="Gelir veya gider adı" value={title} onChangeText={setTitle} placeholder="Örnek: Maaş veya kira" style={sharedStyles.input} />
            {kind === 'expense' ? (
              <>
                <Text style={sharedStyles.label}>Gider kategorisi</Text>
                <Choice<string> value={regularCategoryId} onChange={setRegularCategoryId} options={categoryOptions} />
              </>
            ) : null}
            <Text style={sharedStyles.label}>Tutar</Text>
            <TextInput accessibilityLabel="Aylık tutar" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="Örnek: 15000,00" style={sharedStyles.input} />
            <Text style={sharedStyles.label}>Ayın kaçıncı günü?</Text>
            <TextInput accessibilityLabel="Ayın günü" value={dueDay} onChangeText={setDueDay} keyboardType="number-pad" placeholder="1–31" style={sharedStyles.input} />
            <Text style={sharedStyles.helper}>Her ay tekrar eder. 31 seçilirse kısa aylarda son gün kullanılır.</Text>
            <ActionButton title="Planı kaydet" onPress={save} disabled={savingAction !== null} loading={savingAction === 'regular'} />
          </>
        ) : <Text style={sharedStyles.helper}>Önce bir hesap ekleyin.</Text>}
      </SectionCard>

      <SectionCard>
        <Text style={sharedStyles.cardTitle}>Aylık gider görünümü</Text>
        <Text style={sharedStyles.helper}>Planlanan tutarlarla girdiğin gerçek harcamaları kategori ve para birimi bazında karşılaştır.</Text>
        <Text style={sharedStyles.label}>Ay (YYYY-AA)</Text>
        <TextInput accessibilityLabel="Gider görünümü ayı" value={monthInput} onChangeText={setMonthInput} placeholder="2026-10" style={sharedStyles.input} />
        <ActionButton title="Ayı göster" secondary onPress={showMonth} disabled={savingAction !== null} />
        <Text style={styles.monthLabel}>{selectedMonth} özeti</Text>
        {categoryTotals.length ? categoryTotals.map((total) => (
          <View key={`${total.categoryId ?? 'uncategorized'}-${total.currency}`} style={styles.summaryRow}>
            <Text style={styles.summaryTitle}>{total.categoryName} · {total.currency}</Text>
            <Text style={sharedStyles.muted}>Planlanan: {formatMoney(total.plannedMinor, total.currency)}</Text>
            <Text style={sharedStyles.muted}>Gerçekleşen: {formatMoney(total.actualMinor, total.currency)}</Text>
          </View>
        )) : <Text style={sharedStyles.helper}>Bu ay için kategorili plan veya gerçek harcama kaydı yok.</Text>}
        <Text style={sharedStyles.helper}>Döviz tutarları kendi para biriminde ayrı gösterilir.</Text>
      </SectionCard>

      <SectionCard>
        <Text style={sharedStyles.cardTitle}>Gider kategorileri</Text>
        <Text style={sharedStyles.helper}>Kira, market veya ulaşım gibi sana uygun kategoriler ekle. Kategorisiz seçeneği de kullanılabilir.</Text>
        <Text style={sharedStyles.label}>Yeni kategori adı</Text>
        <TextInput accessibilityLabel="Yeni gider kategorisi adı" value={categoryName} onChangeText={setCategoryName} placeholder="Örnek: Market" style={sharedStyles.input} />
        <ActionButton title="Kategori ekle" onPress={saveCategory} disabled={savingAction !== null} loading={savingAction === 'category'} />
        {categories.map((category) => (
          <View key={category.id} style={styles.categoryRow}>
            <Text style={styles.summaryTitle}>{category.name}</Text>
            <InlineDelete itemName="Kategoriyi" onDelete={async () => {
              await deleteCategory(db, category.id);
              if (regularCategoryId === category.id) setRegularCategoryId('');
              if (flexibleCategoryId === category.id) setFlexibleCategoryId('');
              if (oneTimeCategoryId === category.id) setOneTimeCategoryId('');
              if (actualCategoryId === category.id) setActualCategoryId('');
              await refresh();
              setNotice('Kategori silindi. Bağlı giderler Kategorisiz olarak görünüyor.');
            }} disabled={savingAction !== null} detail="Bu kategoriye bağlı giderler silinmez; Kategorisiz olarak görünür." />
          </View>
        ))}
      </SectionCard>

      <SectionCard>
        <Text style={sharedStyles.cardTitle}>Gerçek harcama ekle</Text>
        <Text style={sharedStyles.helper}>Son gerçek bakiye girişinden sonra yaptığın harcamayı kaydet; zaten bakiyeye dahil edilmiş gideri tekrar girme. Tutar seçilen hesabın uygulamadaki bakiyesinden hemen düşer.</Text>
        {flexibleAccounts.length ? (
          <>
            <Text style={sharedStyles.label}>TL kullanım hesabı</Text>
            <Choice<string> value={actualAccountId ?? flexibleAccounts[0].id} onChange={(value) => { setActualAccountId(value); setActualPlanLink(''); setActualConfirming(false); }} options={flexibleAccounts.map((account) => ({ value: account.id, label: account.name }))} />
            <Text style={sharedStyles.label}>Bu harcama hangi planı karşıladı?</Text>
            <Choice<string> value={actualPlanLink} onChange={(value) => {
              setActualPlanLink(value);
              setActualConfirming(false);
              const id = value.split(':', 2)[1];
              const plan = [...plans, ...flexiblePlans, ...oneTimePlans].find((item) => item.id === id);
              if (plan) setActualCategoryId(plan.categoryId ?? '');
            }} options={actualPlanOptions} />
            <Text style={sharedStyles.helper}>Plan seçilmezse harcama ek gider olarak tahmine girer. Düzenli veya tek seferlik bir plan aynı ay yalnız bir gerçek harcamayla eşleştirilir.</Text>
            <Text style={sharedStyles.label}>Kategori</Text>
            <Choice<string> value={actualCategoryId} onChange={(value) => { setActualCategoryId(value); setActualConfirming(false); }} options={categoryOptions} disabled={!!actualPlanLink} />
            {linkedPlan ? <Text style={sharedStyles.helper}>Kategori, eşleştirilen gider planından alınır.</Text> : null}
            <Text style={sharedStyles.label}>Tutar (TL)</Text>
            <TextInput accessibilityLabel="Gerçek harcama tutarı" value={actualAmount} onChangeText={(value) => { setActualAmount(value); setActualConfirming(false); }} keyboardType="decimal-pad" placeholder="Örnek: 3500,00" style={sharedStyles.input} />
            <Text style={sharedStyles.label}>Harcama tarihi (YYYY-AA-GG)</Text>
            <TextInput accessibilityLabel="Gerçek harcama tarihi" value={actualDate} onChangeText={(value) => { setActualDate(value); setActualPlanLink(''); setActualConfirming(false); }} placeholder="2026-10-25" style={sharedStyles.input} />
            <Text style={sharedStyles.helper}>Tarih, hesabın son gerçek bakiye kontrolünden önce olamaz. Aynı gün daha önce bakiyeye dahil ettiğin harcamayı tekrar girme.</Text>
            {actualConfirming ? (
              <View style={styles.confirmBox}>
                <Text style={styles.confirmTitle}>Harcama ve bakiye değişimi onaylansın mı?</Text>
                <Text style={sharedStyles.helper}>{actualAccount?.name ?? 'Seçilen hesap'} · {formatMoney(actualAccount?.balanceMinor ?? 0, 'TRY')} → {formatMoney((actualAccount?.balanceMinor ?? 0) - (parseAmountMinor(actualAmount) ?? 0), 'TRY')}</Text>
                <Text style={sharedStyles.helper}>{actualPlanLink ? 'Seçilen gider planıyla eşleşecek.' : 'Serbest harcama olarak kaydedilecek.'}</Text>
                <ActionButton title="Evet, harcamayı kaydet" onPress={saveActualExpense} disabled={savingAction !== null} loading={savingAction === 'actual'} />
                <ActionButton title="Geri dön" secondary onPress={() => setActualConfirming(false)} disabled={savingAction !== null} />
              </View>
            ) : <ActionButton title="Gerçek harcamayı kaydet" onPress={confirmActualExpense} disabled={savingAction !== null} />}
          </>
        ) : <Text style={sharedStyles.helper}>Gerçek harcama eklemek için önce TL kullanım hesabı oluştur.</Text>}
      </SectionCard>

      {actualExpenses.length ? <Text style={sharedStyles.sectionTitle}>{selectedMonth} gerçek harcamaları</Text> : null}
      {actualExpenses.map((expense) => {
        const account = accounts.find((item) => item.id === expense.accountId);
        const matchedPlan = expense.planId ? [...plans, ...flexiblePlans, ...oneTimePlans].find((item) => item.id === expense.planId) : null;
        return (
          <SectionCard key={expense.id}>
            <View style={sharedStyles.row}>
              <Text style={styles.planTitle}>{categoryLabel(expense.categoryId)}</Text>
              <Text style={styles.planAmount}>−{formatMoney(expense.amountMinor, 'TRY')}</Text>
            </View>
            <Text style={sharedStyles.muted}>{expense.occurredOn} · {account?.name ?? 'Hesap'}</Text>
            <Text style={sharedStyles.muted}>{matchedPlan ? `Karşılanan plan: ${matchedPlan.title}` : 'Serbest harcama · ek gider'}</Text>
            <InlineDelete itemName="Gerçek harcamayı" onDelete={async () => {
              const before = (await listAccounts(db)).find((item) => item.id === expense.accountId);
              await deleteActualExpense(db, expense.id);
              const updated = await refresh();
              const after = updated.accounts.find((item) => item.id === expense.accountId);
              setNotice(before && after
                ? `Gerçek harcama silindi. ${before.name} bakiyesi: ${formatMoney(before.balanceMinor, 'TRY')} → ${formatMoney(after.balanceMinor, 'TRY')}.`
                : 'Gerçek harcama silindi.');
            }} disabled={savingAction !== null} detail="Yalnız güvenle geri alınabilen son hareket silinir; bakiye de geri yüklenir." />
          </SectionCard>
        );
      })}

      {plans.length > 0 ? <Text style={sharedStyles.sectionTitle}>Aylık düzenli kalemler</Text> : null}
      {plans.map((plan) => {
        const account = accounts.find((item) => item.id === plan.accountId);
        if (!account) return null;
        return (
          <SectionCard key={plan.id}>
            <View style={sharedStyles.row}>
              <Text style={styles.planTitle}>{plan.title}</Text>
              <Text style={styles.planAmount}>
                {plan.kind === 'expense' ? '−' : '+'}{formatMoney(plan.amountMinor, account.currency)}
              </Text>
            </View>
            <Text style={sharedStyles.muted}>Her ayın {plan.dueDay}. günü · {account.name}{plan.endsOn ? ` · Son geçerli tarih ${plan.endsOn}` : ''}</Text>
            {plan.kind === 'expense' ? <Text style={sharedStyles.muted}>Kategori: {categoryLabel(plan.categoryId)}</Text> : null}
            {plan.kind === 'expense' && plan.fulfilledMonths?.includes(selectedMonth) ? <Text style={styles.fulfilled}>Bu ay gerçek harcamayla karşılandı</Text> : null}
            {!plan.endsOn ? actionControls({ kind: 'regular', id: plan.id }, 'Gelecek aylar için durdur') : null}
            <InlineDelete itemName="Planı" onDelete={async () => { await deletePlan(db, plan.id); await refresh(); setPendingAction(null); setNotice('Plan silindi.'); }} disabled={savingAction !== null || !!workingAction} detail="Bu düzenli kalem tüm gelecek ay tahminlerinden çıkarılır." />
          </SectionCard>
        );
      })}
      {flexiblePlans.length > 0 ? <Text style={sharedStyles.sectionTitle}>Değişken gider bütçeleri</Text> : null}
      {flexiblePlans.map((plan) => {
        const account = accounts.find((item) => item.id === plan.accountId);
        if (!account) return null;
        return (
          <SectionCard key={plan.id}>
            <View style={sharedStyles.row}>
              <Text style={styles.planTitle}>{plan.title}</Text>
              <Text style={styles.planAmount}>−{formatMoney(plan.amountMinor, account.currency)}</Text>
            </View>
            <Text style={sharedStyles.muted}>Aylık yaklaşık bütçe · {account.name}{plan.endsOn ? ` · Son geçerli tarih ${plan.endsOn}` : ''}</Text>
            <Text style={sharedStyles.muted}>Kategori: {categoryLabel(plan.categoryId)}</Text>
            {(plan.actualSpentByMonth?.[selectedMonth] ?? 0) > 0 ? <Text style={styles.fulfilled}>Bu ay eşleşen gerçek harcama: {formatMoney(plan.actualSpentByMonth?.[selectedMonth] ?? 0, account.currency)}</Text> : null}
            {!plan.endsOn ? actionControls({ kind: 'flexible', id: plan.id }, 'Gelecek aylar için durdur') : null}
            <InlineDelete itemName="Bütçeyi" onDelete={async () => { await deleteFlexiblePlan(db, plan.id); await refresh(); setPendingAction(null); setNotice('Değişken gider bütçesi silindi.'); }} disabled={savingAction !== null || !!workingAction} detail="Bu bütçe tüm gelecek ay tahminlerinden çıkarılır." />
          </SectionCard>
        );
      })}
      {oneTimePlans.length > 0 ? <Text style={sharedStyles.sectionTitle}>Tek seferlik kalemler</Text> : null}
      {oneTimePlans.map((plan) => {
        const account = accounts.find((item) => item.id === plan.accountId);
        if (!account) return null;
        const statusLabel = plan.status === 'cancelled'
          ? 'İptal edildi'
          : plan.fulfilled ? 'Gerçek harcamayla karşılandı'
          : plan.dueOn < localDateString() ? 'Tarihi geçti · bakiyeyi doğrula' : 'Planlandı';
        return (
          <SectionCard key={plan.id}>
            <View style={sharedStyles.row}>
              <Text style={styles.planTitle}>{plan.title}</Text>
              <Text style={styles.planAmount}>{plan.kind === 'expense' ? '−' : '+'}{formatMoney(plan.amountMinor, account.currency)}</Text>
            </View>
            <Text style={sharedStyles.muted}>{plan.dueOn} · {account.name} · {statusLabel}</Text>
            {plan.kind === 'expense' ? <Text style={sharedStyles.muted}>Kategori: {categoryLabel(plan.categoryId)}</Text> : null}
            {plan.status === 'planned' && plan.dueOn < localDateString() ? <ActionLink href="/accounts" title="Bakiyeyi güncelle" secondary /> : null}
            {plan.status === 'planned' ? actionControls({ kind: 'oneTime', id: plan.id }, 'Tahminden çıkar') : null}
            <InlineDelete itemName="Kalemi" onDelete={async () => { await deleteOneTimePlan(db, plan.id); await refresh(); setPendingAction(null); setNotice('Tek seferlik kalem silindi.'); }} disabled={savingAction !== null || !!workingAction} />
          </SectionCard>
        );
      })}
      {plans.length === 0 && flexiblePlans.length === 0 && oneTimePlans.length === 0 ? <Notice title="Plan henüz boş" body="Önce bir gelir veya gider ekleyerek ay sonu tahminini oluşturmaya başla." /> : null}
      <SectionCard>
        <Text style={sharedStyles.cardTitle}>Yeni tek seferlik kalem</Text>
        {accounts.length ? (
          <>
            <Text style={sharedStyles.label}>Türü</Text>
            <Choice<PlanKind> value={oneTimeKind} onChange={setOneTimeKind} options={[{ value: 'income', label: 'Gelir' }, { value: 'expense', label: 'Gider' }]} />
            <Text style={sharedStyles.label}>Hesap</Text>
            <Choice<string>
              value={oneTimeAccountId ?? accounts[0].id}
              onChange={setOneTimeAccountId}
              options={accounts.map((account) => ({ value: account.id, label: `${account.name} (${account.currency})` }))}
            />
            <Text style={sharedStyles.label}>Adı</Text>
            <TextInput accessibilityLabel="Tek seferlik gelir veya gider adı" value={oneTimeTitle} onChangeText={setOneTimeTitle} placeholder="Örnek: Prim veya tamir" style={sharedStyles.input} />
            {oneTimeKind === 'expense' ? (
              <>
                <Text style={sharedStyles.label}>Gider kategorisi</Text>
                <Choice<string> value={oneTimeCategoryId} onChange={setOneTimeCategoryId} options={categoryOptions} />
              </>
            ) : null}
            <Text style={sharedStyles.label}>Tutar</Text>
            <TextInput accessibilityLabel="Tek seferlik tutar" value={oneTimeAmount} onChangeText={setOneTimeAmount} keyboardType="decimal-pad" placeholder="Örnek: 2500,00" style={sharedStyles.input} />
            <Text style={sharedStyles.label}>Tarih (YYYY-AA-GG)</Text>
            <TextInput accessibilityLabel="Tek seferlik gelir veya gider tarihi" value={oneTimeDueOn} onChangeText={setOneTimeDueOn} placeholder="2026-10-26" style={sharedStyles.input} />
            <Text style={sharedStyles.helper}>Bugün veya ileri tarih seç. Bugünkü kalem son bakiye girişinden sonra planlandıysa tahmine katılır; yeni bakiye girdiğinde tekrar işlenmez.</Text>
            <ActionButton title="Tek seferlik kalemi kaydet" onPress={saveOneTime} disabled={savingAction !== null} loading={savingAction === 'oneTime'} />
          </>
        ) : <Text style={sharedStyles.helper}>Önce bir hesap ekle.</Text>}
      </SectionCard>
      <SectionCard>
        <Text style={sharedStyles.cardTitle}>Yeni değişken gider bütçesi</Text>
        <Text style={sharedStyles.helper}>Gün seçmene gerek yok. Bu tutar gelecek tam aylarda kullanılır; bu ay için bakiyeni güncellerken kalan harcama tahminini ayrıca girersin.</Text>
        {flexibleAccounts.length ? (
          <>
            <Text style={sharedStyles.label}>TL kullanım hesabı</Text>
            <Choice<string>
              value={flexibleAccountId ?? flexibleAccounts[0].id}
              onChange={setFlexibleAccountId}
              options={flexibleAccounts.map((account) => ({ value: account.id, label: account.name }))}
            />
            <Text style={sharedStyles.label}>Gider adı</Text>
            <TextInput accessibilityLabel="Değişken gider adı" value={flexibleTitle} onChangeText={setFlexibleTitle} placeholder="Örnek: Market ve ulaşım" style={sharedStyles.input} />
            <Text style={sharedStyles.label}>Gider kategorisi</Text>
            <Choice<string> value={flexibleCategoryId} onChange={setFlexibleCategoryId} options={categoryOptions} />
            <Text style={sharedStyles.label}>Aylık yaklaşık tutar</Text>
            <TextInput accessibilityLabel="Aylık değişken gider tutarı" value={flexibleAmount} onChangeText={setFlexibleAmount} keyboardType="decimal-pad" placeholder="Örnek: 5000,00" style={sharedStyles.input} />
            <ActionButton title="Bütçeyi kaydet" onPress={saveFlexible} disabled={savingAction !== null} loading={savingAction === 'flexible'} />
          </>
        ) : <Text style={sharedStyles.helper}>Değişken gider eklemek için önce bir TL kullanım hesabı oluştur.</Text>}
      </SectionCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  planTitle: { color: palette.ink, fontSize: 17, fontWeight: '700', flex: 1 },
  planAmount: { color: palette.ink, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right' },
  confirmBox: { backgroundColor: palette.primarySoft, borderRadius: 14, padding: 13, gap: 10 },
  confirmTitle: { color: palette.ink, fontSize: 15, fontWeight: '800', lineHeight: 21 },
  monthLabel: { color: palette.ink, fontSize: 16, fontWeight: '800', marginTop: 3 },
  summaryRow: { borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 10, gap: 3 },
  summaryTitle: { color: palette.ink, fontSize: 15, fontWeight: '700' },
  categoryRow: { borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 10, gap: 8 },
  fulfilled: { color: palette.positive, fontSize: 13, fontWeight: '700' },
});
