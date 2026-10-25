# Google Play yayın kontrolü

**Hazırlık tarihi:** 25 Ekim 2026. Bu liste Play Console'daki son başvuru ekranına göre tekrar doğrulanmalıdır.

## Projede hazırlananlar

- Android üretim profili AAB üretir; sürüm ve `versionCode` yerel proje dosyalarından okunur.
- Expo SDK 58 varsayılan Android `targetSdkVersion` değeri 36'dır. Üretilen AAB'nin Play Console App Bundle Explorer ekranında API 36 olarak göründüğünü doğrula.
- [Gizlilik politikası](gizlilik_politikasi.md), [mağaza metni](google_play_magaza_metni.md), 512×512 Play ikonu ve 1024×500 tanıtım görseli hazırlandı.
- Finans verisi yerel SQLite'ta tutulur. Fiyat istekleri Frankfurter/ECB ve Gold API'ye varlık kodlarıyla yapılır. Seçilen şifreli yedek dosyası Android paylaşım ekranıyla kullanıcı tarafından aktarılır.

## Play Console'da tamamlanacaklar

1. Gizlilik politikasını herkese açık, oturum gerektirmeyen bir URL'de yayımla. Play Console'a URL'yi ve destek adresi olarak `mehmetcelek.bm@gmail.com` adresini gir.
2. En az iki gerçek Android ekran görüntüsü çek. Ekranlarda örnek veri kullan; gerçek banka/gelir bilgisi kullanma. Hazırlanmış ikon ve tanıtım görselini mağaza girişine yükle.
3. **Data safety** formunu gerçek AAB'nin ağ trafiği ve kullanılan SDK'lara göre doldur. Yerel finans kayıtları sunucuya gönderilmediği sürece “collected” olarak beyan edilmez. Fiyat servisi istekleri ve kullanıcı başlatmalı yedek paylaşımı açıklamada yer almalıdır. Google Play'in güncel istisna tanımlarını başvuru sırasında doğrula.
4. **Financial features declaration** formunda bütçe/kişisel finans takip işlevlerini doğru seç; banka bağlantısı, ödeme veya yatırım tavsiyesi sunulduğunu işaretleme.
5. Uygulama içerik derecelendirmesi, hedef kitle, reklam durumu, ülke ve fiyat dağıtım ayarlarını doldur. Reklam SDK'sı bulunmaz.
6. Google Play App Signing'i etkinleştir ve üretilen AAB'yi önce dahili test kanalına yükle. Mevcut Play uygulaması varsa paket adı ve imzalama anahtarı sürekliliğini kontrol et.
7. Geliştirici hesabı 13 Kasım 2023 sonrası açılmış kişisel hesapsa üretim erişimi öncesinde en az 12 testçinin 14 gün kesintisiz katıldığı kapalı test ve üretim erişimi başvurusu gerekir. Hesap türünü ve açılış tarihini Play Console'da doğrula.
8. Pilot APK aynı paket adıyla dağıtıldığı için pilot sürümden Play sürümüne doğrudan güncellemeyi aynı telefonda dene. Play App Signing farklı imza kullanırsa kullanıcı önce şifreli yedek almalı, sonra pilot APK'yı kaldırıp Play sürümünü yüklemeli ve yedeği geri yüklemelidir. Bu geçiş fiziksel cihazda doğrulanmadan pilot kullanıcılara kaldırma talimatı verme.

## Fiziksel Android kabul testi

- Yeni kurulumda hesap, gelir ve gider ekleyip ay sonu tahminini gör.
- Gerçek harcama gir; seçilen hesabın bakiyesi düşsün. Planla eşleştirme aynı harcamayı iki kez düşürmesin.
- Döviz ve altın satışı sonrası kaynak miktar ile TL hedef hesabı doğru değişsin.
- TL hesap transferi, bakiye farkı açıklaması ve aynı ekstreye birden çok kısmi ödeme işlemini dene.
- Şifreli yedek dosyasını dışa aktar, ikinci kurulumda aç ve geri yükle. Yanlış parola/bozuk dosya mevcut verileri değiştirmesin.
- Çevrimdışı iken eski fiyat tarihi ve uyarı doğru gösterilsin; internet açılınca fiyat güncellensin.
- Ekran okuyucu, küçük ekran, geri gezinme ve işlem sırasında uygulamayı yeniden açma davranışlarını dene.

## Kaynaklar

- [Google Play target API şartı](https://support.google.com/googleplay/android-developer/answer/11926878)
- [Yeni kişisel hesaplar için test şartı](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469)
- [Finans özellikleri beyanı](https://support.google.com/googleplay/android-developer/answer/13849271)
- [Google Play görsel ölçüleri](https://support.google.com/googleplay/android-developer/answer/1078870)
- [Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756)
- [Expo SDK 58 sürüm tablosu](https://docs.expo.dev/versions/v58.0.0/)
- [Gold API kullanım koşulları](https://gold-api.com/terms)
- [Frankfurter lisans açıklaması](https://frankfurter.dev/license/)
