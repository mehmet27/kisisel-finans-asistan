import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatQuantityMicros, parseQuantityMicros, summarizeAssetsTry,
  valueForeignAccountTry, valueGoldHoldingTry,
} from './valuation.ts';

test('gram miktarı en fazla altı ondalıkla tam sayıya çevrilir', () => {
  assert.equal(parseQuantityMicros('1,000001'), 1000001);
  assert.equal(parseQuantityMicros('1.234,56'), 1234560000);
  assert.equal(parseQuantityMicros('0,0000001'), null);
  assert.equal(formatQuantityMicros(1234560000), '1.234,56');
});

test('kur değişimi kaynak USD ve harcanabilir TL bakiyesini değiştirmez', () => {
  const tryAccount = { id: 'bank', currency: 'TRY', purpose: 'spending', balanceMinor: 50000 };
  const usdAccount = { id: 'usd', currency: 'USD', purpose: 'savings', balanceMinor: 25050 };
  const firstQuote = { assetCode: 'USD', priceTryMicros: 40000000, quotedAt: '2026-10-25', fetchedAt: '2026-10-25T10:00:00Z' };
  const secondQuote = { ...firstQuote, priceTryMicros: 50000000 };
  assert.equal(valueForeignAccountTry(usdAccount, firstQuote), 1002000);
  assert.equal(valueForeignAccountTry(usdAccount, secondQuote), 1252500);
  assert.equal(usdAccount.balanceMinor, 25050);
  assert.equal(tryAccount.balanceMinor, 50000);
  const first = summarizeAssetsTry([tryAccount, usdAccount], [], [firstQuote], new Date('2026-10-25T11:00:00Z'));
  const second = summarizeAssetsTry([tryAccount, usdAccount], [], [secondQuote], new Date('2026-10-25T11:00:00Z'));
  assert.equal(second.totalTryMinor - first.totalTryMinor, 250500);
});

test('altın gram değeri tam sayı kuruşla hesaplanır; eksik ve eski fiyat belirtilir', () => {
  const gold = { id: 'gold', name: 'Gram altın', quantityMicros: 12500000 };
  const quote = {
    assetCode: 'XAU_GRAM', priceTryMicros: 6000000000,
    quotedAt: '2026-10-25T10:00:00Z', fetchedAt: '2026-10-25T10:00:01Z',
  };
  assert.equal(valueGoldHoldingTry(gold, quote), 7500000);
  assert.deepEqual(summarizeAssetsTry([], [gold], [], new Date('2026-10-25T10:00:00Z')),
    { totalTryMinor: null, status: 'unavailable', missingCodes: ['XAU_GRAM'], quotedAt: null });
  const stale = summarizeAssetsTry([], [gold], [quote], new Date('2026-10-25T12:00:00Z'));
  assert.equal(stale.totalTryMinor, 7500000);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.quotedAt, quote.quotedAt);
});
