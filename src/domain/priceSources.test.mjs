import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPriceQuotes, parseEcbFxRates, parseGoldUsdPerOunce } from './priceSources.ts';

test('ECB çapraz USD kuru ve USD/ons altın fiyatı gram TL fiyatına dönüşür', () => {
  const fx = parseEcbFxRates([
    { date: '2026-10-23', base: 'EUR', quote: 'TRY', rate: 55 },
    { date: '2026-10-23', base: 'EUR', quote: 'USD', rate: 1.1 },
  ]);
  const gold = parseGoldUsdPerOunce({ symbol: 'XAU', currency: 'USD', price: 4000, updatedAt: '2026-10-25T10:00:00Z' });
  const quotes = buildPriceQuotes(fx, gold, '2026-10-25T10:01:00Z');
  assert.equal(quotes.find((quote) => quote.assetCode === 'USD').priceTryMicros, 50000000);
  assert.equal(quotes.find((quote) => quote.assetCode === 'EUR').priceTryMicros, 55000000);
  assert.equal(quotes.find((quote) => quote.assetCode === 'XAU_GRAM').priceTryMicros, 6430149314);
  assert.equal(quotes.find((quote) => quote.assetCode === 'XAU_GRAM').quotedAt, '2026-10-23');
});

test('eksik veya uyumsuz fiyat yanıtı kabul edilmez', () => {
  assert.throws(() => parseEcbFxRates([{ date: '2026-10-23', base: 'EUR', quote: 'TRY', rate: 55 }]));
  assert.throws(() => parseEcbFxRates([
    { date: '2026-10-23', base: 'EUR', quote: 'TRY', rate: 55 },
    { date: '2026-10-22', base: 'EUR', quote: 'USD', rate: 1.1 },
  ]));
  assert.throws(() => parseGoldUsdPerOunce({ symbol: 'XAU', currency: 'EUR', price: 4000, updatedAt: '2026-10-25T10:00:00Z' }));
});
