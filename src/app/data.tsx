import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { deserializeDatabaseAsync, useSQLiteContext } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { prepareBackupSource, restoreBackupSource, serializeBackupDatabase } from '@/data/backupCore';
import type { BackupPreview } from '@/data/backupCore';
import { decryptBackup, encryptBackup } from '@/services/backupCrypto';
import { ActionButton, Notice, PageTitle, SectionCard, palette, sharedStyles } from '@/ui/components';

const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function DataScreen() {
  const db = useSQLiteContext();
  const sourceRef = useRef<SQLiteDatabase | null>(null);
  const [backupPassword, setBackupPassword] = useState('');
  const [backupConfirmation, setBackupConfirmation] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [selectedFile, setSelectedFile] = useState<{ uri: string; name: string; size?: number } | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [busy, setBusy] = useState<'backup' | 'open' | 'restore' | 'pick' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => () => { sourceRef.current?.closeAsync().catch(() => {}); }, []);

  async function clearSource() {
    const source = sourceRef.current;
    sourceRef.current = null;
    setPreview(null);
    setConfirmRestore(false);
    if (source) await source.closeAsync();
  }

  async function createBackup() {
    if (busy) return;
    if (backupPassword.length < 12) { setError('Yedek parolası en az 12 karakter olmalı.'); return; }
    if (backupPassword !== backupConfirmation) { setError('Yedek parolaları eşleşmiyor.'); return; }
    setBusy('backup'); setError(''); setNotice('');
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('Bu cihazda dosya paylaşımı kullanılamıyor.');
      const databaseBytes = await serializeBackupDatabase(db);
      const encrypted = await encryptBackup(databaseBytes, backupPassword);
      const file = new File(Paths.cache, `kisisel-finans-yedek-${Date.now()}.kfa`);
      file.create();
      await file.write(encrypted);
      await Sharing.shareAsync(file.uri, { mimeType: 'application/octet-stream', dialogTitle: 'Şifreli finans yedeğini kaydet' });
      setBackupPassword(''); setBackupConfirmation('');
      setNotice('Paylaşım ekranı kapandı. Yedek dosyasını kaydettiğin konumda doğrula ve parolanı güvenli bir yerde tut.');
    } catch (cause) {
      setError(errorMessage(cause, 'Şifreli yedek oluşturulamadı.'));
    } finally { setBusy(null); }
  }

  async function pickBackup() {
    if (busy) return;
    setBusy('pick'); setError(''); setNotice('');
    try {
      await clearSource();
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: '*/*' });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset || (asset.size !== undefined && asset.size > MAX_BACKUP_BYTES)) {
        throw new Error('Yedek dosyası 50 MB sınırını aşıyor.');
      }
      setSelectedFile({ uri: asset.uri, name: asset.name, size: asset.size });
      setRestorePassword('');
    } catch (cause) {
      setError(errorMessage(cause, 'Yedek dosyası seçilemedi.'));
    } finally { setBusy(null); }
  }

  async function openBackup() {
    if (busy || !selectedFile) return;
    if (!restorePassword) { setError('Yedek parolasını gir.'); return; }
    setBusy('open'); setError(''); setNotice('');
    let source: SQLiteDatabase | null = null;
    try {
      await clearSource();
      const file = new File(selectedFile.uri);
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Yedek dosyası 50 MB sınırını aşıyor.');
      const encrypted = await file.bytes();
      if (encrypted.length > MAX_BACKUP_BYTES) throw new Error('Yedek dosyası 50 MB sınırını aşıyor.');
      const databaseBytes = await decryptBackup(encrypted, restorePassword);
      source = await deserializeDatabaseAsync(databaseBytes);
      const nextPreview = await prepareBackupSource(source);
      sourceRef.current = source;
      source = null;
      setPreview(nextPreview);
    } catch (cause) {
      setError(errorMessage(cause, 'Yedek açılamadı. Parolayı ve dosyayı kontrol et.'));
    } finally {
      await source?.closeAsync().catch(() => {});
      setBusy(null);
    }
  }

  async function applyRestore() {
    if (busy || !sourceRef.current || !preview || !confirmRestore) return;
    setBusy('restore'); setError(''); setNotice('');
    try {
      await restoreBackupSource(db, sourceRef.current);
      await clearSource();
      setSelectedFile(null); setRestorePassword('');
      router.replace('/');
    } catch (cause) {
      setError(errorMessage(cause, 'Geri yükleme uygulanamadı; mevcut veriler korundu.'));
    } finally { setBusy(null); }
  }

  return (
    <ScrollView style={sharedStyles.page} contentContainerStyle={sharedStyles.content} keyboardShouldPersistTaps="handled">
      <PageTitle eyebrow="VERİLERİN" title="Yedek ve geri yükleme" subtitle="Finans kayıtların telefonunda saklanır. Şifreli yedeği kendin güvenli bir konuma kaydedebilirsin." />
      <ActionButton title="Gizlilik politikası" secondary onPress={() => router.push('/privacy')} />
      {error ? <Notice tone="error" body={error} /> : null}
      {notice ? <Notice body={notice} /> : null}

      <SectionCard>
        <Text style={sharedStyles.cardTitle}>Şifreli yedek oluştur</Text>
        <Text style={sharedStyles.helper}>Yedek; hesaplarını, planlarını, kartlarını, birikimlerini ve harcamalarını içerir. Parola dosyaya yazılmaz; unutursan yedeği açamazsın.</Text>
        <Text style={sharedStyles.label}>Yedek parolası (en az 12 karakter)</Text>
        <TextInput accessibilityLabel="Yedek parolası" value={backupPassword} onChangeText={setBackupPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} style={sharedStyles.input} />
        <Text style={sharedStyles.label}>Parolayı tekrar gir</Text>
        <TextInput accessibilityLabel="Yedek parolası tekrar" value={backupConfirmation} onChangeText={setBackupConfirmation} secureTextEntry autoCapitalize="none" autoCorrect={false} style={sharedStyles.input} />
        <ActionButton title="Yedeği oluştur ve paylaş" onPress={createBackup} disabled={busy !== null} loading={busy === 'backup'} />
      </SectionCard>

      <SectionCard>
        <Text style={sharedStyles.cardTitle}>Yedeği geri yükle</Text>
        <Text style={sharedStyles.helper}>Dosya önce açılır ve kontrol edilir. İçeriği görüp onaylayana kadar telefondaki kayıtlar değişmez.</Text>
        <ActionButton title="Şifreli yedek dosyası seç" onPress={pickBackup} disabled={busy !== null} loading={busy === 'pick'} secondary />
        {selectedFile ? <Text style={styles.fileName}>Seçilen dosya: {selectedFile.name}</Text> : null}
        {selectedFile ? (
          <>
            <Text style={sharedStyles.label}>Yedek parolası</Text>
            <TextInput accessibilityLabel="Geri yükleme parolası" value={restorePassword} onChangeText={(value) => { setRestorePassword(value); setPreview(null); setConfirmRestore(false); }} secureTextEntry autoCapitalize="none" autoCorrect={false} style={sharedStyles.input} />
            <ActionButton title="Yedeği aç ve kontrol et" onPress={openBackup} disabled={busy !== null} loading={busy === 'open'} />
          </>
        ) : null}
        {preview ? (
          <View style={styles.preview}>
            <Text style={styles.previewTitle}>Yedekteki kayıtlar</Text>
            <Text style={sharedStyles.helper}>{preview.accountCount} hesap · {preview.planCount} plan · {preview.cardCount} kart · {preview.goldCount} altın · {preview.expenseCount} gerçek harcama</Text>
            <Text style={styles.warning}>Geri yükleme, telefondaki mevcut finans kayıtlarının yerini bu yedekteki kayıtlarla değiştirir.</Text>
            {confirmRestore ? (
              <>
                <ActionButton title="Evet, mevcut verileri yedekle değiştir" destructive onPress={applyRestore} disabled={busy !== null} loading={busy === 'restore'} />
                <ActionButton title="Vazgeç" secondary onPress={() => setConfirmRestore(false)} disabled={busy !== null} />
              </>
            ) : <ActionButton title="Geri yüklemeyi başlat" destructive onPress={() => setConfirmRestore(true)} disabled={busy !== null} />}
          </View>
        ) : null}
      </SectionCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fileName: { color: palette.ink, fontSize: 13, fontWeight: '700' },
  preview: { backgroundColor: palette.primarySoft, padding: 14, borderRadius: 14, gap: 10 },
  previewTitle: { color: palette.ink, fontSize: 16, fontWeight: '800' },
  warning: { color: palette.warning, fontSize: 13, lineHeight: 19, fontWeight: '700' },
});
