import { useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { Link } from 'expo-router';
import type { Href } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

export const palette = {
  background: '#F5F9F8',
  surface: '#FFFFFF',
  ink: '#123F50',
  muted: '#536B73',
  primary: '#123F50',
  primaryDark: '#0B3443',
  primaryPressed: '#0A2C3B',
  primarySoft: '#E3F7F0',
  mint: '#77D7B9',
  mintPressed: '#C9EDE0',
  border: '#D8E7E4',
  positive: '#19745F',
  positiveSoft: '#E6F4EC',
  negative: '#A3433E',
  negativeSoft: '#FAEDEB',
  warning: '#865617',
  warningSoft: '#FBF2DC',
};

export function SectionCard({ children }: PropsWithChildren) {
  return <View style={styles.card}>{children}</View>;
}

export function ActionButton({
  title,
  onPress,
  secondary = false,
  destructive = false,
  disabled = false,
  loading = false,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  const unavailable = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: unavailable, busy: loading }}
      disabled={unavailable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.buttonSecondary,
        destructive && styles.buttonDestructive,
        pressed && !unavailable && (destructive ? styles.buttonDestructivePressed : secondary ? styles.buttonSecondaryPressed : styles.buttonPressed),
        unavailable && !loading && styles.buttonDisabled,
      ]}
    >
      <View style={styles.buttonContents}>
        {loading ? <ActivityIndicator size="small" color={secondary ? palette.primaryDark : '#FFFFFF'} /> : null}
        <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary, unavailable && !loading && styles.buttonTextDisabled]}>{title}</Text>
      </View>
    </Pressable>
  );
}

export function InlineDelete({
  itemName,
  onDelete,
  disabled = false,
  detail = 'Bu kayıt kalıcı olarak silinir.',
}: {
  itemName: string;
  onDelete: () => Promise<void>;
  disabled?: boolean;
  detail?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const workingRef = useRef(false);

  async function confirm() {
    if (workingRef.current || disabled) return;
    workingRef.current = true;
    setWorking(true);
    setError('');
    try {
      await onDelete();
      setConfirming(false);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : 'Kayıt silinemedi. Tekrar dene.');
    } finally {
      workingRef.current = false;
      setWorking(false);
    }
  }

  return (
    <View style={styles.deleteArea}>
      {error ? <Notice tone="error" body={error} /> : null}
      {confirming ? (
        <View style={styles.deleteConfirm}>
          <Text style={styles.deleteTitle}>Bu kayıt silinsin mi?</Text>
          <Text style={sharedStyles.helper}>{detail}</Text>
          <ActionButton title="Evet, sil" destructive onPress={confirm} disabled={disabled || working} loading={working} />
          <ActionButton title="Vazgeç" secondary onPress={() => { setConfirming(false); setError(''); }} disabled={working} />
        </View>
      ) : <ActionButton title={`${itemName} sil`} destructive onPress={() => { setError(''); setConfirming(true); }} disabled={disabled} />}
    </View>
  );
}

export function ActionLink({ title, href, secondary = false }: { title: string; href: Href; secondary?: boolean }) {
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={title}
        style={({ pressed }) => [styles.actionLink, secondary && styles.actionLinkSecondary, pressed && styles.actionLinkPressed]}
      >
        <Text style={styles.actionLinkText}>{title}</Text>
        <Text style={styles.actionLinkArrow} accessibilityElementsHidden importantForAccessibility="no">›</Text>
      </Pressable>
    </Link>
  );
}

export function NavRow({ title, subtitle, href }: { title: string; subtitle?: string; href: Href }) {
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={title}
        accessibilityHint={subtitle}
        style={({ pressed }) => [styles.navRow, pressed && styles.navRowPressed]}
      >
        <View style={styles.navRowMarker} />
        <View style={styles.navRowContent}>
          <Text style={styles.navRowTitle}>{title}</Text>
          {subtitle ? <Text style={styles.navRowSubtitle}>{subtitle}</Text> : null}
        </View>
        <Text style={styles.navRowArrow} accessibilityElementsHidden importantForAccessibility="no">›</Text>
      </Pressable>
    </Link>
  );
}

export function Choice<T extends string | number>({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.choiceRow}>
      {options.map((option) => (
        <Pressable
          key={String(option.value)}
          accessibilityRole="button"
          accessibilityState={{ selected: option.value === value, disabled }}
          accessibilityLabel={option.label}
          disabled={disabled}
          onPress={() => onChange(option.value)}
          style={({ pressed }) => [styles.choice, option.value === value && styles.choiceSelected, pressed && !disabled && (option.value === value ? styles.choiceSelectedPressed : styles.choicePressed), disabled && styles.choiceDisabled]}
        >
          <Text style={[styles.choiceText, option.value === value && styles.choiceTextSelected]}>
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function PageTitle({ title, subtitle, eyebrow }: { title: string; subtitle?: string; eyebrow?: string }) {
  return (
    <View style={styles.heading}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Notice({
  title,
  body,
  tone = 'neutral',
}: {
  title?: string;
  body: string;
  tone?: 'neutral' | 'warning' | 'error';
}) {
  return (
    <View style={[styles.notice, tone === 'warning' && styles.noticeWarning, tone === 'error' && styles.noticeError]}>
      {title ? <Text style={styles.noticeTitle}>{title}</Text> : null}
      <Text style={styles.noticeBody}>{body}</Text>
    </View>
  );
}

export const sharedStyles = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.background },
  content: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 44, gap: 16 },
  label: { color: palette.ink, fontSize: 14, fontWeight: '700', marginBottom: 4 },
  input: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 16,
    color: palette.ink,
  },
  helper: { color: palette.muted, fontSize: 13, lineHeight: 19 },
  error: { color: palette.negative, fontSize: 13, lineHeight: 19 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  cardTitle: { color: palette.ink, fontSize: 17, fontWeight: '700' },
  amount: { color: palette.ink, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  muted: { color: palette.muted, fontSize: 13, lineHeight: 19 },
  sectionTitle: { color: palette.ink, fontSize: 18, fontWeight: '800', marginTop: 5 },
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: 18,
    padding: 18,
    gap: 10,
    borderWidth: 1,
    borderColor: palette.border,
  },
  button: {
    backgroundColor: palette.primary,
    borderRadius: 14,
    minHeight: 52,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSecondary: { backgroundColor: palette.primarySoft, borderColor: '#ADD8CA' },
  buttonDestructive: { backgroundColor: palette.negative, borderColor: palette.negative },
  buttonPressed: { backgroundColor: palette.primaryPressed, borderColor: palette.primaryPressed },
  buttonSecondaryPressed: { backgroundColor: palette.mintPressed, borderColor: '#76BAA5' },
  buttonDestructivePressed: { backgroundColor: '#7F302F', borderColor: '#7F302F' },
  buttonDisabled: { backgroundColor: '#E0E8E8', borderColor: '#D4DFDF' },
  buttonContents: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  buttonTextSecondary: { color: palette.primaryDark },
  buttonTextDisabled: { color: '#526A72' },
  deleteArea: { gap: 8 },
  deleteConfirm: { backgroundColor: palette.negativeSoft, borderRadius: 12, padding: 12, gap: 9 },
  deleteTitle: { color: palette.ink, fontSize: 15, fontWeight: '800' },
  actionLink: { minHeight: 48, borderRadius: 12, backgroundColor: palette.primarySoft, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  actionLinkSecondary: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  actionLinkPressed: { backgroundColor: palette.mintPressed },
  actionLinkText: { color: palette.primaryDark, fontSize: 14, fontWeight: '800', flex: 1 },
  actionLinkArrow: { color: palette.primaryDark, fontSize: 25, fontWeight: '500', lineHeight: 25 },
  navRow: { minHeight: 60, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 11 },
  navRowPressed: { backgroundColor: palette.primarySoft },
  navRowMarker: { width: 5, height: 30, borderRadius: 3, backgroundColor: palette.mint },
  navRowContent: { flex: 1, gap: 2 },
  navRowTitle: { color: palette.ink, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  navRowSubtitle: { color: palette.muted, fontSize: 12, lineHeight: 16 },
  navRowArrow: { color: palette.primary, fontSize: 27, lineHeight: 29 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    borderRadius: 12,
    minHeight: 48,
    paddingVertical: 11,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    justifyContent: 'center',
  },
  choicePressed: { borderColor: '#9ABBB2', backgroundColor: '#F1F9F6' },
  choiceSelected: { borderColor: '#5EA892', backgroundColor: '#D5F2E8' },
  choiceSelectedPressed: { borderColor: palette.primary, backgroundColor: palette.mintPressed },
  choiceDisabled: { opacity: 0.6 },
  choiceText: { color: palette.ink, fontSize: 14, fontWeight: '700' },
  choiceTextSelected: { color: palette.primaryDark, fontWeight: '800' },
  heading: { gap: 4, marginBottom: 1 },
  eyebrow: { color: palette.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: palette.ink, fontSize: 28, lineHeight: 34, fontWeight: '800' },
  subtitle: { color: palette.muted, fontSize: 14, lineHeight: 20 },
  notice: { padding: 14, gap: 4, borderRadius: 12, backgroundColor: palette.primarySoft },
  noticeWarning: { backgroundColor: palette.warningSoft },
  noticeError: { backgroundColor: palette.negativeSoft },
  noticeTitle: { color: palette.ink, fontSize: 14, fontWeight: '700' },
  noticeBody: { color: palette.ink, fontSize: 13, lineHeight: 19 },
});
