import assert from 'node:assert/strict';
import test from 'node:test';
import { previewFxConversion, previewGoldConversion } from './conversions.ts';

test('gerçekleşen FX kuru brütten türetilir, TL hesaba yalnız net tutar geçer', () => {
  const preview = previewFxConversion(10000, 495000, 5000);
  assert.deepEqual(preview, {
    grossTryMinor: 500000, netTryMinor: 495000, feeTryMinor: 5000,
    realizedPriceTryMicros: 50000000,
  });
});

test('gram altın satış fiyatı miktar mikrobiriminden türetilir', () => {
  const preview = previewGoldConversion(2500000, 1240000, 10000);
  assert.deepEqual(preview, {
    grossTryMinor: 1250000, netTryMinor: 1240000, feeTryMinor: 10000,
    realizedPriceTryMicros: 5000000000,
  });
});

test('eksi ve güvenli tam sayı dışındaki işlem tutarları reddedilir', () => {
  assert.throws(() => previewFxConversion(0, 1000, 0));
  assert.throws(() => previewGoldConversion(1000000, 1000, -1));
  assert.throws(() => previewFxConversion(100, Number.MAX_SAFE_INTEGER, 1));
  assert.throws(() => previewGoldConversion(1, Number.MAX_SAFE_INTEGER, 0));
});
