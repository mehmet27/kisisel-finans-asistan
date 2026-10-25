# Döviz ve altın değerleme kaynakları

**Doğrulama tarihi:** 25 Ekim 2026

| Veri | Kaynak | Uygulamadaki anlamı |
| --- | --- | --- |
| EUR/TRY ve EUR/USD | [Frankfurter ECB sağlayıcısı](https://api.frankfurter.dev/v2/rates?base=EUR&quotes=TRY,USD&providers=ECB) | ECB referans kurlarıyla yaklaşık TL değerleme. USD/TRY, iki kurun oranından türetilir. |
| XAU/USD | [Gold API](https://api.gold-api.com/price/XAU) | ABD doları cinsinden troy ons spot altın fiyatı. 1 troy ons = 31,1034768 gram alınarak yaklaşık gram değeri türetilir. |

Frankfurter'ın [lisans ve atıf açıklaması](https://frankfurter.dev/license/) ve Gold API'nin [kullanım koşulları](https://gold-api.com/terms) doğrulandı. Gold API koşulları mobil/ticari kullanıma izin veriyor; saniyede birden çok istekle servisi zorlamak yasak. Bu nedenle uygulama fiyatları önbelleğe almalı ve elle yenilemeyi sınırlamalıdır.

ECB kurları hafta sonu ve tatillerde güncellenmez. Altın fiyatının zamanı ayrı olabilir. Ekran, her iki kaynağın adını ve son başarılı fiyat tarihlerini göstermeli; fiyat alınamazsa son kayıtlı değeri tarihini belirterek göstermelidir. Döviz ve altın miktarları telefonun yerel veritabanında kalır; fiyat istekleri finans kayıtlarını içermez.

Altın sonucu **spot altının yaklaşık TL/gram değeri**dir. Türkiye'deki kuyumcu, banka, ürün saflığı, alış/satış makası ve işlem masrafını temsil etmez. Bozdurma veya satışta gerçekleşen tutar ayrıca kaydedilmelidir.
