# Bağımlılık güvenliği durumu

**Kontrol tarihi:** 25 Ekim 2026

`npx expo install --fix` proje bağımlılıklarının Expo SDK 58 ile uyumlu ve güncel olduğunu doğruladı. Kararlı Expo sürümü `58.0.19`, kullanılan CLI sürümü `58.1.15`.

`npm audit --omit=dev --audit-level=high` beş yüksek önem dereceli bulgu raporluyor:

- `node-forge@1.4.0`: Expo CLI ve kod imzalama sertifikası araçlarının bağımlılığı. Npm'de mevcut en yeni sürüm `1.4.0`; ilgili güvenlik bildirimi bu sürümü de etkiliyor.
- `zod@3.25.76`: Expo CLI'nin `^3.25.76` bağımlılığı. Bildirimin düzeltilmiş sürümü Zod 4 ailesinde; ana sürümü zorlayarak değiştirmek Expo CLI uyumluluğunu bozabilir.

`npm audit fix --force` Expo'yu `44.0.6` sürümüne düşürmeyi öneriyor. Bu proje Expo 58 API'lerini kullandığı için söz konusu düşürme uygulanmadı. Bulgular Expo'nun geliştirme/CLI bağımlılık zincirinde; uygulamanın kendi finans verisi modelleriyle ilgili bir bulgu raporlanmadı.

**Yayın kapısı:** Expo veya ilgili paketler uyumlu yamaları yayımladığında bağımlılıkları güncelle, `npm audit`, `npm test`, `npm run typecheck`, `npm run lint` ve Android derlemesini tekrar çalıştır. Pilot APK dağıtımından önce güvenlik durumu yeniden değerlendirilmeli.
