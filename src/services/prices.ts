import type { SQLiteDatabase } from 'expo-sqlite';
import { listAccounts, listGoldHoldings, listPriceQuotes, savePriceQuotes } from '../data/repository';
import { FX_URL, GOLD_URL, buildPriceQuotes, parseEcbFxRates, parseGoldUsdPerOunce } from '../domain/priceSources';
import type { AssetCode, PriceQuote } from '../domain/valuation';

const CACHE_MS = 60 * 60 * 1000;
const MIN_REFRESH_MS = 60 * 1000;
let lastNetworkAttemptMs = 0;
let lastNetworkErrors: PriceRefreshResult['errors'] = [];
let inFlightRefresh: Promise<PriceRefreshResult> | null = null;

export interface PriceRefreshResult {
  quotes: PriceQuote[];
  errors: { assetCode: AssetCode; message: string }[];
}

async function fetchJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetcher(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function recent(quote: PriceQuote | undefined, now: Date, maxAge: number): boolean {
  if (!quote) return false;
  const age = now.getTime() - Date.parse(quote.fetchedAt);
  return age >= 0 && age < maxAge;
}

async function refreshPriceQuotesOnce(
  db: SQLiteDatabase,
  options: { force?: boolean; fetcher?: typeof fetch; now?: Date } = {},
): Promise<PriceRefreshResult> {
  const now = options.now ?? new Date();
  const fetcher = options.fetcher ?? fetch;
  const [accounts, holdings, cached] = await Promise.all([
    listAccounts(db), listGoldHoldings(db), listPriceQuotes(db),
  ]);
  const required = new Set<AssetCode>();
  for (const account of accounts) {
    if (account.currency !== 'TRY' && account.balanceMinor !== 0) required.add(account.currency);
  }
  const needGold = holdings.some((holding) => holding.quantityMicros > 0);
  if (needGold) required.add('XAU_GRAM');
  if (required.size === 0) return { quotes: cached, errors: [] };
  const cachedFor = (code: AssetCode) => cached.find((quote) => quote.assetCode === code);
  const shouldRefresh = [...required].some((code) =>
    !recent(cachedFor(code), now, options.force ? MIN_REFRESH_MS : CACHE_MS));
  if (!shouldRefresh) return { quotes: cached, errors: [] };
  const sinceLastAttempt = now.getTime() - lastNetworkAttemptMs;
  if (sinceLastAttempt >= 0 && sinceLastAttempt < MIN_REFRESH_MS) {
    return { quotes: cached, errors: lastNetworkErrors };
  }
  lastNetworkAttemptMs = now.getTime();

  const errors: PriceRefreshResult['errors'] = [];
  const fetchedAt = now.toISOString();
  try {
    // The request contains only currency codes; account balances and gold quantities stay on device.
    const fx = parseEcbFxRates(await fetchJson(FX_URL, fetcher));
    let gold: ReturnType<typeof parseGoldUsdPerOunce> | null = null;
    if (needGold && !recent(cachedFor('XAU_GRAM'), now, options.force ? MIN_REFRESH_MS : CACHE_MS)) {
      try {
        gold = parseGoldUsdPerOunce(await fetchJson(GOLD_URL, fetcher));
      } catch (error) {
        errors.push({ assetCode: 'XAU_GRAM', message: error instanceof Error ? error.message : 'Altın fiyatı alınamadı.' });
      }
    }
    const quotes = buildPriceQuotes(fx, gold, fetchedAt).filter((quote) =>
      required.has(quote.assetCode) || (needGold && quote.assetCode === 'USD'));
    await savePriceQuotes(db, quotes);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Döviz kuru alınamadı.';
    for (const code of required) errors.push({ assetCode: code, message });
  }
  lastNetworkErrors = errors;
  return { quotes: await listPriceQuotes(db), errors };
}

export async function refreshPriceQuotes(
  db: SQLiteDatabase,
  options: { force?: boolean; fetcher?: typeof fetch; now?: Date } = {},
): Promise<PriceRefreshResult> {
  if (inFlightRefresh) return inFlightRefresh;
  const task = refreshPriceQuotesOnce(db, options);
  inFlightRefresh = task;
  try {
    return await task;
  } finally {
    if (inFlightRefresh === task) inFlightRefresh = null;
  }
}
