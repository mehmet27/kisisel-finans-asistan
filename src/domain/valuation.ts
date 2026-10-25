import type { Account } from './finance';

export type AssetCode = 'USD' | 'EUR' | 'XAU_GRAM';

export interface GoldHolding {
  id: string;
  name: string;
  quantityMicros: number;
}

export interface PriceQuote {
  assetCode: AssetCode;
  priceTryMicros: number;
  quotedAt: string;
  source: string;
  sourceUrl: string;
  fetchedAt: string;
}

export interface AssetValuationSummary {
  totalTryMinor: number | null;
  status: 'current' | 'stale' | 'unavailable';
  missingCodes: AssetCode[];
  quotedAt: string | null;
}

const MICROS = 1_000_000n;
const GOLD_VALUE_DENOMINATOR = 10_000_000_000n;

function roundedDivide(numerator: bigint, denominator: bigint): bigint {
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  return sign * ((absolute + denominator / 2n) / denominator);
}

function safeNumber(value: bigint): number | null {
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : null;
}

export function parseQuantityMicros(raw: string): number | null {
  const compact = raw.trim().replace(/\s/g, '');
  const normalized = compact.includes(',') ? compact.replace(/\./g, '').replace(',', '.') : compact;
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return safeNumber(BigInt(whole) * MICROS + BigInt(fraction.padEnd(6, '0') || '0'));
}

export function formatQuantityMicros(value: number): string {
  if (!Number.isSafeInteger(value)) throw new Error('Geçersiz gram miktarı.');
  const sign = value < 0 ? '-' : '';
  const absolute = BigInt(Math.abs(value));
  const whole = Number(absolute / MICROS);
  const fraction = String(absolute % MICROS).padStart(6, '0').replace(/0+$/, '');
  return `${sign}${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(whole)}${fraction ? `,${fraction}` : ''}`;
}

export function valueForeignAccountTry(account: Account, quote: PriceQuote | undefined): number | null {
  if (account.currency === 'TRY') return account.balanceMinor;
  if (account.balanceMinor === 0) return 0;
  if (!quote || quote.assetCode !== account.currency) return null;
  return safeNumber(roundedDivide(BigInt(account.balanceMinor) * BigInt(quote.priceTryMicros), MICROS));
}

export function valueGoldHoldingTry(holding: GoldHolding, quote: PriceQuote | undefined): number | null {
  if (holding.quantityMicros === 0) return 0;
  if (!quote || quote.assetCode !== 'XAU_GRAM') return null;
  return safeNumber(roundedDivide(
    BigInt(holding.quantityMicros) * BigInt(quote.priceTryMicros), GOLD_VALUE_DENOMINATOR,
  ));
}

function quoteTimestamp(quote: PriceQuote): number {
  const date = quote.quotedAt.length === 10 ? `${quote.quotedAt}T00:00:00.000Z` : quote.quotedAt;
  return Date.parse(date);
}

export function summarizeAssetsTry(
  accounts: Account[], holdings: GoldHolding[], quotes: PriceQuote[], now: Date = new Date(),
): AssetValuationSummary {
  let total = 0n;
  const required = new Set<AssetCode>();
  for (const account of accounts) {
    if (account.currency !== 'TRY' && account.balanceMinor !== 0) required.add(account.currency);
  }
  if (holdings.some((holding) => holding.quantityMicros !== 0)) required.add('XAU_GRAM');
  const selected = [...required].map((code) => quotes.find((quote) => quote.assetCode === code));
  const missingCodes = [...required].filter((_, index) => !selected[index]);
  if (missingCodes.length > 0) return { totalTryMinor: null, status: 'unavailable', missingCodes, quotedAt: null };

  for (const account of accounts) {
    const amount = account.currency === 'TRY'
      ? account.balanceMinor
      : valueForeignAccountTry(account, quotes.find((quote) => quote.assetCode === account.currency));
    if (amount === null) return { totalTryMinor: null, status: 'unavailable', missingCodes: [account.currency as AssetCode], quotedAt: null };
    total += BigInt(amount);
  }
  for (const holding of holdings) {
    const amount = valueGoldHoldingTry(holding, quotes.find((quote) => quote.assetCode === 'XAU_GRAM'));
    if (amount === null) return { totalTryMinor: null, status: 'unavailable', missingCodes: ['XAU_GRAM'], quotedAt: null };
    total += BigInt(amount);
  }
  const used = selected.filter((quote): quote is PriceQuote => !!quote);
  const oldest = used.reduce<PriceQuote | null>((candidate, quote) =>
    !candidate || quoteTimestamp(quote) < quoteTimestamp(candidate) ? quote : candidate, null);
  const stale = used.some((quote) => {
    const age = now.getTime() - quoteTimestamp(quote);
    const maxAge = quote.assetCode === 'XAU_GRAM' ? 60 * 60 * 1000 : 36 * 60 * 60 * 1000;
    return !Number.isFinite(age) || age < -5 * 60 * 1000 || age > maxAge;
  });
  return {
    totalTryMinor: safeNumber(total),
    status: safeNumber(total) === null ? 'unavailable' : stale ? 'stale' : 'current',
    missingCodes: [], quotedAt: oldest?.quotedAt ?? null,
  };
}
