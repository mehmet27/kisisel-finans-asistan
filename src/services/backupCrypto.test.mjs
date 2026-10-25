import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'expo-crypto' && context.parentURL?.endsWith('/backupCrypto.ts')) {
      return nextResolve('./backupCryptoTestAdapter.mjs', context);
    }
    return nextResolve(specifier, context);
  },
});

const { encryptBackup, decryptBackup, BackupCryptoError, MAX_BACKUP_BYTES } = await import('./backupCrypto.ts');
const password = 'uzun-ve-guclu-bir-yedek-parolasi';
const database = Uint8Array.from({ length: 4096 }, (_, index) => index % 251);

test('şifreli yedek yalnız doğru parolayla aynı baytlara açılır; salt dosyalar arasında değişir', async () => {
  const first = await encryptBackup(database, password);
  const second = await encryptBackup(database, password);
  assert.notDeepEqual(first, second);
  assert.ok(first.length > database.length);
  assert.deepEqual(await decryptBackup(first, password), database);
  assert.deepEqual(await decryptBackup(second, password), database);
});

test('yanlış parola ve şifreli içerik değişikliği doğrulama hatası verir', async () => {
  const file = await encryptBackup(database, password);
  await assert.rejects(decryptBackup(file, 'yanlis-bir-parola'),
    (error) => error instanceof BackupCryptoError && error.code === 'INVALID_PASSWORD_OR_CORRUPT');
  const tampered = Uint8Array.from(file);
  tampered[tampered.length - 24] ^= 1;
  await assert.rejects(decryptBackup(tampered, password),
    (error) => error instanceof BackupCryptoError && error.code === 'INVALID_PASSWORD_OR_CORRUPT');
  const changedSalt = Uint8Array.from(file);
  changedSalt[10] ^= 1;
  await assert.rejects(decryptBackup(changedSalt, password),
    (error) => error instanceof BackupCryptoError && error.code === 'INVALID_PASSWORD_OR_CORRUPT');
});

test('dosya imzası, sürüm ve anahtar türetim ayarı doğrulanır', async () => {
  const file = await encryptBackup(database, password);
  const badMagic = Uint8Array.from(file);
  badMagic[0] ^= 1;
  await assert.rejects(decryptBackup(badMagic, password),
    (error) => error instanceof BackupCryptoError && error.code === 'INVALID_FORMAT');
  const futureVersion = Uint8Array.from(file);
  futureVersion[4] = 2;
  await assert.rejects(decryptBackup(futureVersion, password),
    (error) => error instanceof BackupCryptoError && error.code === 'UNSUPPORTED_VERSION');
  const badIterations = Uint8Array.from(file);
  badIterations[8] ^= 1;
  await assert.rejects(decryptBackup(badIterations, password),
    (error) => error instanceof BackupCryptoError && error.code === 'INVALID_FORMAT');
  await assert.rejects(decryptBackup(file.subarray(0, 15), password),
    (error) => error instanceof BackupCryptoError && error.code === 'INVALID_FORMAT');
});

test('kısa parola ve boyut sınırı şifreleme başlamadan reddedilir', async () => {
  await assert.rejects(encryptBackup(database, 'kisa'),
    (error) => error instanceof BackupCryptoError && error.code === 'WEAK_PASSWORD');
  await assert.rejects(encryptBackup(new Uint8Array(MAX_BACKUP_BYTES), password),
    (error) => error instanceof BackupCryptoError && error.code === 'TOO_LARGE');
  await assert.rejects(decryptBackup(new Uint8Array(MAX_BACKUP_BYTES + 1), password),
    (error) => error instanceof BackupCryptoError && error.code === 'TOO_LARGE');
});
