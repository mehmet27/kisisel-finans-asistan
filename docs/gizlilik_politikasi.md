# Kişisel Finans Asistanı Gizlilik Politikası

**Son güncelleme:** 25 Ekim 2026

Kişisel Finans Asistanı, gelir, gider, hesap, kart ve birikimlerini kendi telefonunda takip etmen için geliştirilmiştir. Uygulama hesap açmanı istemez. Girdiğin finans kayıtları telefonundaki yerel veritabanında saklanır; uygulamanın geliştiricisine ait bir sunucuya gönderilmez.

## İşlenen bilgiler ve amaçları

- Girdiğin hesap bakiyeleri, gelirler, giderler, kartlar, döviz ve altın kayıtları, planlar ve işlem geçmişi uygulama ekranlarını ve hesaplamalarını oluşturmak için cihazında işlenir.
- Güncel döviz ve altın değerlerini göstermek için uygulama `api.frankfurter.dev` ve `api.gold-api.com` servislerine internet isteği gönderir. Bu istekler ilgili döviz veya altın kodlarını içerir; finans kayıtların, bakiyelerin ve adın gönderilmez. Servisler, internet bağlantısının gereği olarak IP adresini görebilir ve kendi politikaları uyarınca işleyebilir.
- Şifreli yedek oluşturmayı seçersen uygulama finans verilerini belirlediğin parolayla şifreleyip bir dosya oluşturur. Dosyayı hangi uygulamaya veya konuma aktaracağına telefonun paylaşım ekranında sen karar verirsin. Seçtiğin paylaşım veya bulut hizmetinin kendi gizlilik koşulları geçerlidir. Parola dosyaya yazılmaz ve geliştiriciye gönderilmez.
- Geri yüklemeyi seçersen uygulama, senin seçtiğin yedek dosyasını cihazında açar ve onayından sonra yerel kayıtların yerine koyar.

Uygulamada reklam, analiz aracı veya kullanıcı hesabı bulunmaz. Uygulama finans verilerini satmaz ve geliştiricinin erişebileceği bir uzak depoda tutmaz.

## Saklama, silme ve güvenlik

Kayıtlar, sen uygulama içinden silene, yedekten değiştirilene veya uygulamanın verileri cihazından kaldırılana kadar telefonda kalır. Android ayarlarından uygulama verilerini temizlemek veya uygulamayı kaldırmak yerel kayıtları silebilir. Önceden başka konuma kaydettiğin yedek dosyalarını ayrıca silmen gerekir.

Yedek dosyaları parola ile şifrelenir. Telefonun ekran kilidi ve cihaz güvenliği de yerel verilerin korunması için önemlidir. Yedek parolanı unutursan dosyayı geri açamayız.

## İzinler ve iletişim

İnternet erişimi yalnız fiyat sorguları için kullanılır. Yedek seçme ve paylaşma işlemlerinde Android'in dosya seçici ve paylaşım ekranları kullanılır. Uygulama banka hesabına bağlanmaz veya ödeme işlemi yapmaz.

Gizlilikle ilgili sorular ve veri talepleri için: **mehmetcelek.bm@gmail.com**.

Bu politikanın Google Play'de herkese açık bir URL'de yayımlanması yayın öncesi gereklidir.
