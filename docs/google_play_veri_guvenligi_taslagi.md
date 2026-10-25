# Google Play Data safety yanıt taslağı

**Durum:** Başvuru öncesi doğrulama taslağı. Son yanıt, üretim AAB'sindeki SDK ve ağ trafiği kontrol edilerek Play Console'un güncel soru metnine göre verilmeli.

| Veri / akış | Uygulamadaki davranış | Forma etkisi |
| --- | --- | --- |
| Hesap adı, bakiye, gelir, gider, kart ve birikim kayıtları | SQLite'ta yalnız cihazda tutulur | Geliştirici sunucusuna iletilmediği sürece Google'ın “collected” tanımına girmez. |
| Döviz/altın fiyat isteği | Frankfurter/ECB ve Gold API'ye gerekli varlık kodu gider | Finans tutarları gitmez. Servisler ağ isteğinin IP adresini görebilir. Üretim AAB ağ trafiğiyle doğrula. |
| Şifreli yedek | Kullanıcı başlatır; parola ile şifrelenen dosyanın alıcısını Android paylaşım ekranında kullanıcı seçer | Kullanıcı başlatmalı paylaşım ve yalnız kullanıcının çözebildiği şifreleme istisnalarının güncel Play metnine uyduğunu kontrol et. |
| Yedekten geri yükleme | Seçilen dosya cihazda çözülür ve yerel veritabanına yazılır | Geliştiriciye veri aktarımı yok. |
| Reklam ve analiz | SDK bulunmuyor | Bu amaçlarla veri işleme beyanı beklenmez; bağımlılık ve ağ denetimiyle doğrula. |

## Forma cevap vermeden önce

1. Üretim AAB bağımlılıklarını ve çalışma zamanı ağ isteklerini incele. İnternet erişimi yalnız fiyat sağlayıcılarında kullanılmalı.
2. Ağ isteğinde fiyat sağlayıcılarının görebileceği IP adresi ve varlık kodunu, Play'in “collected” ve “shared” tanımlarıyla eşleştir. Kesin form cevabını belirsizlik kalmadan seç.
3. Gizlilik politikasının herkese açık URL'sini ve uygulama içi erişimini doğrula.
4. Yerel veri silme adımını ve başka yere kaydedilmiş yedeklerin ayrı silinmesi gerektiğini açıkla.

[Resmi Data safety yönergesi](https://support.google.com/googleplay/android-developer/answer/10787469)
