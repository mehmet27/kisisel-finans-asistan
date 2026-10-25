import type { AssetCode } from './valuation';

export type ConversionErrorCode =
  | 'INVALID_INPUT' | 'REQUEST_CONFLICT' | 'SOURCE_MISSING' | 'INSUFFICIENT_SOURCE'
  | 'TARGET_INVALID' | 'BALANCE_OUTDATED' | 'BALANCE_UNVERIFIED'
  | 'BALANCE_OVERFLOW' | 'STORAGE_ERROR';

export class ConversionError extends Error {
  readonly code: ConversionErrorCode;
  readonly cause?: unknown;
  readonly diagnosticCode?: string;

  constructor(code: ConversionErrorCode, message: string, cause?: unknown, diagnosticCode?: string) {
    super(message);
    this.name = 'ConversionError';
    this.code = code;
    this.cause = cause;
    this.diagnosticCode = diagnosticCode;
  }
}

export interface AssetConversion {
  id: string;
  requestId: string;
  kind: 'fx_exchange' | 'gold_sale';
  sourceAccountId: string | null;
  goldHoldingId: string | null;
  targetAccountId: string;
  sourceCode: AssetCode;
  sourceAmountMinor: number | null;
  quantityMicros: number | null;
  grossTryMinor: number;
  feeTryMinor: number;
  netTryMinor: number;
  realizedPriceTryMicros: number;
  occurredAt: string;
}

export interface ConversionPreview {
  grossTryMinor: number;
  netTryMinor: number;
  feeTryMinor: number;
  realizedPriceTryMicros: number;
}

function preview(sourceAmount: number, netTryMinor: number, feeTryMinor: number, rateNumerator: bigint): ConversionPreview {
  if (!Number.isSafeInteger(sourceAmount) || sourceAmount <= 0
    || !Number.isSafeInteger(netTryMinor) || netTryMinor <= 0
    || !Number.isSafeInteger(feeTryMinor) || feeTryMinor < 0) {
    throw new Error('Geçersiz bozdurma veya satış tutarı.');
  }
  const grossTryMinor = netTryMinor + feeTryMinor;
  if (!Number.isSafeInteger(grossTryMinor)) throw new Error('İşlem tutarı çok büyük.');
  const price = (BigInt(grossTryMinor) * rateNumerator + BigInt(sourceAmount) / 2n) / BigInt(sourceAmount);
  const realizedPriceTryMicros = Number(price);
  if (!Number.isSafeInteger(realizedPriceTryMicros) || realizedPriceTryMicros <= 0) {
    throw new Error('Gerçekleşen işlem fiyatı aralık dışında.');
  }
  return { grossTryMinor, netTryMinor, feeTryMinor, realizedPriceTryMicros };
}

export function previewFxConversion(
  sourceAmountMinor: number, netTryMinor: number, feeTryMinor: number,
): ConversionPreview {
  return preview(sourceAmountMinor, netTryMinor, feeTryMinor, 1_000_000n);
}

export function previewGoldConversion(
  quantityMicros: number, netTryMinor: number, feeTryMinor: number,
): ConversionPreview {
  return preview(quantityMicros, netTryMinor, feeTryMinor, 10_000_000_000n);
}
