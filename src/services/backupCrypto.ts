import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync, getRandomBytesAsync } from 'expo-crypto';

const MAGIC = new Uint8Array([0x4b, 0x46, 0x41, 0x42]); // KFAB
const FORMAT_VERSION = 1;
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const HEADER_BYTES = MAGIC.length + 1 + 4 + SALT_BYTES;
const SEALED_OVERHEAD_BYTES = 12 + 16; // Expo AES-GCM nonce and authentication tag.

export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

export type BackupCryptoErrorCode =
  | 'INVALID_FORMAT'
  | 'UNSUPPORTED_VERSION'
  | 'INVALID_PASSWORD_OR_CORRUPT'
  | 'TOO_LARGE'
  | 'WEAK_PASSWORD';

export class BackupCryptoError extends Error {
  readonly code: BackupCryptoErrorCode;

  constructor(code: BackupCryptoErrorCode, message: string) {
    super(message);
    this.name = 'BackupCryptoError';
    this.code = code;
  }
}

function makeHeader(salt: Uint8Array): Uint8Array {
  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC);
  header[MAGIC.length] = FORMAT_VERSION;
  new DataView(header.buffer).setUint32(MAGIC.length + 1, PBKDF2_ITERATIONS, false);
  header.set(salt, MAGIC.length + 5);
  return header;
}

function parseHeader(bytes: Uint8Array): { header: Uint8Array; salt: Uint8Array } {
  if (bytes.length > MAX_BACKUP_BYTES) {
    throw new BackupCryptoError('TOO_LARGE', 'Yedek dosyası desteklenen boyutu aşıyor.');
  }
  if (bytes.length < HEADER_BYTES + SEALED_OVERHEAD_BYTES) {
    throw new BackupCryptoError('INVALID_FORMAT', 'Yedek dosyası eksik veya geçersiz.');
  }
  if (!MAGIC.every((value, index) => bytes[index] === value)) {
    throw new BackupCryptoError('INVALID_FORMAT', 'Bu dosya Kişisel Finans Asistanı yedeği değil.');
  }
  if (bytes[MAGIC.length] !== FORMAT_VERSION) {
    throw new BackupCryptoError('UNSUPPORTED_VERSION', 'Bu yedek sürümü uygulama tarafından desteklenmiyor.');
  }
  const header = bytes.slice(0, HEADER_BYTES);
  if (new DataView(header.buffer).getUint32(MAGIC.length + 1, false) !== PBKDF2_ITERATIONS) {
    throw new BackupCryptoError('INVALID_FORMAT', 'Yedek anahtarı türetme ayarı geçersiz.');
  }
  return { header, salt: header.slice(MAGIC.length + 5) };
}

async function importPasswordKey(password: string, salt: Uint8Array): Promise<AESEncryptionKey> {
  const rawKey = await pbkdf2Async(sha256, password, salt, { c: PBKDF2_ITERATIONS, dkLen: 32 });
  try {
    return await AESEncryptionKey.import(rawKey);
  } finally {
    rawKey.fill(0);
  }
}

/** Encrypts a SQLite snapshot into a portable, password protected KFAB v1 file. */
export async function encryptBackup(plainDbBytes: Uint8Array, password: string): Promise<Uint8Array> {
  if (password.length < 12) {
    throw new BackupCryptoError('WEAK_PASSWORD', 'Yedek parolası en az 12 karakter olmalı.');
  }
  if (plainDbBytes.length + HEADER_BYTES + SEALED_OVERHEAD_BYTES > MAX_BACKUP_BYTES) {
    throw new BackupCryptoError('TOO_LARGE', 'Veritabanı yedekleme için desteklenen boyutu aşıyor.');
  }
  const salt = await getRandomBytesAsync(SALT_BYTES);
  const header = makeHeader(salt);
  const key = await importPasswordKey(password, salt);
  const sealed = await aesEncryptAsync(plainDbBytes, key, { additionalData: header });
  const combined = await sealed.combined();
  const file = new Uint8Array(header.length + combined.length);
  file.set(header);
  file.set(combined, header.length);
  return file;
}

/** Authenticates and decrypts a KFAB v1 file without changing the live database. */
export async function decryptBackup(backupBytes: Uint8Array, password: string): Promise<Uint8Array> {
  const { header, salt } = parseHeader(backupBytes);
  const key = await importPasswordKey(password, salt);
  try {
    const sealed = AESSealedData.fromCombined(backupBytes.slice(HEADER_BYTES));
    return await aesDecryptAsync(sealed, key, { additionalData: header, output: 'bytes' });
  } catch {
    throw new BackupCryptoError('INVALID_PASSWORD_OR_CORRUPT', 'Parola yanlış veya yedek dosyası bozulmuş.');
  }
}
