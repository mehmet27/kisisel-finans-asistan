# Kişisel Finans Asistanı

Android pilotu için React Native, Expo 58, TypeScript ve yerel SQLite ile geliştirilen kişisel finans uygulaması. Ürün kapsamı ve kabul ölçütleri [ürün analizinde](docs/urun_analizi.md) yer alır.

## Çalıştırma

```bash
npm install
npm start
```

Expo Go veya Android emülatör ile açılabilir. Yerel veriler `finans.db` içinde tutulur.

## Şu anda çalışan özellikler

- TL, USD veya EUR cinsinden kullanım/birikim hesabı oluşturma ve kaynak para biriminde bakiye saklama.
- Hesap bakiyesini güncelleme, önceki aylık plana göre tahmin farkını saklama ve gösterme.
- Hesaba bağlı aylık gelir/gider planı oluşturma; ödeme gününü kısa ayların son gününe uyarlama.
- Planı gelecek aylar için durdururken önceki dönem etkisini koruma.
- TL kullanım hesabına bağlı aylık değişken gider bütçesi ve bakiye güncellemesinde ayın kalan harcama tahmini.
- Kart, gerçek ekstre, planlanan ve gerçekleşen ödeme ile taksit kaydı. Gerçek ekstre aynı dönemin kart harcama tahmininin yerine geçer; TL hesabından yalnız ekstre ödemesi düşülür.
- Harcanabilir TL için ay sonu ve 3/6/12 aylık tarihli plan tahmini.
- USD/EUR hesabının kaynak bakiyesini koruyarak yaklaşık TL değerleme ve gram altın birikimi. Fiyat kaynağı, piyasa tarihi, son başarılı kayıt ve eski fiyat durumu görünür.
- Gerçek döviz bozdurma ve gram altın satışı: kaynak miktar ile TL hedef bakiyesi tek işlemde güncellenir; net TL, masraf ve gerçekleşen birim fiyat işlem geçmişinde saklanır.
- Tarihli tek seferlik gelir ve gider planı; hesabın gelecek tahminine bir kez uygulanır ve iptal edilebilir.
- Ana ekranda uygulamanın üç adımlı kullanım özeti ve döviz/altın dahil brüt varlığın yaklaşık TL karşılığı.
- Günlük nakit akışı, ilk olası nakit açığı tarihi ve planlanan hareketlerin kaynak/varsayım ayrıntısı.
- Gelir, gider veya taksit için gerçek kayıtları değiştirmeyen geçici senaryo karşılaştırması.
- Gider kategorileri ve seçilen ay için planlanan/gerçekleşen tutar özeti. İsteğe bağlı gerçek harcama seçilen TL kullanım hesabının uygulamadaki bakiyesini azaltır; bağlı planla eşleştirildiğinde tahminde tekrar düşülmez.
- Kullanıcı kayıtlarını ekran içi onayla silme; bakiye etkili harcama ve satış işlemlerinde yalnız güvenli son hareket geri alınır.
- Parolayla şifreli SQLite yedeğini paylaşma ve içeriğini doğrulayarak geri yükleme.
- A logosuna uyumlu butonlar, açık yükleniyor/hata durumları ve azaltılmış hareket ayarına duyarlı ekran geçişleri.

Bozdurma/satıştan önce ilgili hesap bakiyelerinin aynı gün güncellenmiş olması gerekir; böylece eski bir bakiyenin gerçekleşmiş gibi ileri taşınması önlenir. Eski sürümden gelen hesapların gözlem zamanı v6 veritabanı geçişinde tamamlanır. Kısmi kart ödemesinde kalan borç görünür; aynı ekstreye ikinci ödeme kaydı henüz eklenmedi. Gerçek harcama girişinde tutarın son gözlenen bakiyeye zaten dahil edilmediğini kullanıcı doğrulamalıdır. Şifreli yedek ve geri yükleme Android cihazda uçtan uca doğrulanmalıdır. Fiyat kaynakları ve yaklaşık değerleme varsayımları [fiyat kaynakları notunda](docs/fiyat_kaynaklari.md) açıklanır.

## Yapı

- `src/app`: Expo Router ekranları.
- `src/data`: SQLite şeması, sürüm geçişi ve veri erişimi.
- `src/domain`: para ayrıştırma ve deterministik tahmin kuralları.
- `src/ui`: ortak mobil arayüz parçaları.

Finans hesaplarında tutarlar kuruş cinsinden tam sayı, gram altın miktarı gramın milyonda biri cinsinden tam sayı olarak tutulur. Döviz hesaplarının tutarı kaynak para birimindedir; TL değerleme ayrı fiyat kayıtlarından hesaplanır. Birikim ve döviz, harcanabilir TL'ye otomatik eklenmez.

## Denetimler

```bash
npm test
npm run typecheck
npm run lint
```

İlk APK pilotundan önce ürün analizindeki kabul örneklerinin tamamı uygulanmalı ve Android cihazda doğrulanmalıdır.
