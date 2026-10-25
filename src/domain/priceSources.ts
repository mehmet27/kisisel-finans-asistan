import type { PriceQuote } from './valuation';

export const FX_URL = 'https://api.frankfurter.dev/v2/rates?base=EUR&quotes=TRY,USD&providers=ECB';
export const GOLD_URL = 'https://api.gold-api.com/price/XAU';
const TROY_OUNCE_GRAMS_TIMES_TEN_MILLION = 311_034_768n;

function decimalMicros(raw: unknown): number {
  const value = String(raw);
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error('Fiyat biçimi geçersiz.');
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0') || '0');
  const number = Number(result);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error('Fiyat aralık dışında.');
  return number;
}

function roundedDivide(numerator: bigint, denominator: bigint): number {
  const result = Number((numerator + denominator / 2n) / denominator);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error('Türetilen fiyat aralık dışında.');
  return result;
}

export function parseEcbFxRates(raw: unknown): { date: string; eurTryMicros: number; eurUsdMicros: number } {
  if (!Array.isArray(raw)) throw new Error('Kur yanıtı geçersiz.');
  const tryRow = raw.find((row) => row?.base === 'EUR' && row?.quote === 'TRY');
  const usdRow = raw.find((row) => row?.base === 'EUR' && row?.quote === 'USD');
  if (!tryRow || !usdRow || tryRow.date !== usdRow.date || !/^\d{4}-\d{2}-\d{2}$/.test(tryRow.date)) {
    throw new Error('ECB TRY/USD referans kurları eksik veya tarihleri farklı.');
  }
  return { date: tryRow.date, eurTryMicros: decimalMicros(tryRow.rate), eurUsdMicros: decimalMicros(usdRow.rate) };
}

export function parseGoldUsdPerOunce(raw: unknown): { priceUsdMicros: number; quotedAt: string } {
  const row = raw as { symbol?: unknown; currency?: unknown; price?: unknown; updatedAt?: unknown } | null;
  if (!row || row.symbol !== 'XAU' || row.currency !== 'USD'
    || typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))) {
    throw new Error('Altın fiyatı yanıtı geçersiz.');
  }
  return { priceUsdMicros: decimalMicros(row.price), quotedAt: row.updatedAt };
}

export function buildPriceQuotes(
  fx: ReturnType<typeof parseEcbFxRates>, gold: ReturnType<typeof parseGoldUsdPerOunce> | null,
  fetchedAt: string,
): PriceQuote[] {
  const usdTryMicros = roundedDivide(BigInt(fx.eurTryMicros) * 1_000_000n, BigInt(fx.eurUsdMicros));
  const base: PriceQuote[] = [
    { assetCode: 'EUR', priceTryMicros: fx.eurTryMicros, quotedAt: fx.date,
      source: 'ECB via Frankfurter', sourceUrl: FX_URL, fetchedAt },
    { assetCode: 'USD', priceTryMicros: usdTryMicros, quotedAt: fx.date,
      source: 'ECB çapraz kur, Frankfurter', sourceUrl: FX_URL, fetchedAt },
  ];
  if (gold) {
    const priceTryMicros = roundedDivide(
      BigInt(gold.priceUsdMicros) * BigInt(usdTryMicros) * 10n,
      TROY_OUNCE_GRAMS_TIMES_TEN_MILLION,
    );
    base.push({
      assetCode: 'XAU_GRAM', priceTryMicros,
      quotedAt: gold.quotedAt.slice(0, 10) < fx.date ? gold.quotedAt : fx.date,
      source: `Gold API USD/ons (${gold.quotedAt}) × ECB USD/TRY (${fx.date}); 31,1034768 g/ons`,
      sourceUrl: GOLD_URL, fetchedAt,
    });
  }
  return base;
}
