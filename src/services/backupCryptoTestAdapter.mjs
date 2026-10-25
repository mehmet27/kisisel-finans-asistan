import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';

export class AESEncryptionKey {
  static async import(bytes) { return { bytes: Uint8Array.from(bytes) }; }
}

export class AESSealedData {
  constructor(bytes) { this.bytes = bytes; }
  static fromCombined(bytes) { return new AESSealedData(Uint8Array.from(bytes)); }
  async combined() { return this.bytes; }
}

export async function getRandomBytesAsync(length) {
  return new Uint8Array(randomBytes(length));
}

export async function aesEncryptAsync(plaintext, key, { additionalData }) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key.bytes, iv);
  cipher.setAAD(additionalData);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return new AESSealedData(Uint8Array.from(Buffer.concat([iv, ciphertext, cipher.getAuthTag()])));
}

export async function aesDecryptAsync(sealed, key, { additionalData }) {
  const bytes = sealed.bytes;
  const decipher = createDecipheriv('aes-256-gcm', key.bytes, bytes.subarray(0, 12));
  decipher.setAAD(additionalData);
  decipher.setAuthTag(bytes.subarray(bytes.length - 16));
  return Uint8Array.from(Buffer.concat([
    decipher.update(bytes.subarray(12, bytes.length - 16)), decipher.final(),
  ]));
}
