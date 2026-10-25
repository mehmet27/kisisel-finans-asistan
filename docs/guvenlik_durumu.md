# Bağımlılık güvenliği durumu

**Kontrol tarihi:** 25 Ekim 2026

`npx expo install --fix` proje bağımlılıklarının Expo SDK 58 ile uyumlu ve güncel olduğunu doğruladı. Kararlı Expo sürümü `58.0.19`, kullanılan CLI sürümü `58.1.15`.

`npm audit --omit=dev --audit-level=high` 25 Ekim 2026'da tekrar çalıştırıldı ve beş yüksek önem dereceli bulgu raporladı. Bu sayıya Expo ve `@expo/cli` için türetilmiş zincir bulguları da dahildir:

- `node-forge@1.4.0`: Expo CLI ve kod imzalama sertifikası araçlarının bağımlılığı. Npm'de mevcut en yeni sürüm `1.4.0`; ilgili güvenlik bildirimi bu sürümü de etkiliyor.
- `zod@3.25.76`: Expo CLI'nin `^3.25.76` bağımlılığı. Bildirimin düzeltilmiş sürümü Zod 4 ailesinde; ana sürümü zorlayarak değiştirmek Expo CLI uyumluluğunu bozabilir.

`npm audit fix --force` Expo'yu `44.0.6` sürümüne düşürmeyi öneriyor. Bu proje Expo 58 API'lerini kullandığı için söz konusu düşürme uygulanmadı. Bulgular Expo'nun geliştirme/CLI bağımlılık zincirinde; uygulamanın kendi finans verisi modelleriyle ilgili bir bulgu raporlanmadı.

**Yayın değerlendirmesi:** Bulguların ikisi `node-forge` ve `zod` üzerinden Expo araç zincirine uzanıyor. Güncel Expo SDK ile uyumlu düzeltme yayımlandığında bağımlılıkları güncelle ve güvenlik taramasını tekrar çalıştır. Bu bulguların üretim AAB içindeki çalıştırılabilir koda girip girmediği ayrıca incelenmeden “uygulamada açık yok” sonucuna varılamaz. `npm audit fix --force` önerisi uygulanmamalıdır; Expo 44'e düşüş mevcut API'leri bozacaktır.
