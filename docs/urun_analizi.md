# Kişisel Finans Asistanı — ürün analizi ve ilk pilot kapsamı

**Sürüm:** 2.1 taslak
**Tarih:** 25 Ekim 2026
**Dayanak:** `kisisel_finans_asistani_urun_analizi.pdf` ve ürün görüşmesinde alınan kararlar

## 1. Ürün tanımı

Uygulama, kullanıcının hesaplarındaki parayı, aylık gelir ve gider planını, borç ödemelerini ve birikimlerini bir araya getirir. Temel sorusu şudur: **“Bugün elimde ne var; yaklaşan ödemelerden sonra bu ay ve gelecek aylarda ne kalacak?”**

Kullanıcı aylık planını kurar, hesap bakiyelerini ara sıra günceller ve tahmin ile gerçek bakiye arasındaki farkı görür. İsterse yaptığı gerçek harcamaları tek tek kaydedebilir; her alışverişi yazması zorunlu değildir. Her tahmin, kullanılan bakiyeyi, beklenen hareketleri, fiyatları ve varsayımları açıklamalıdır. İlk PDF tarihsel başlangıç belgesidir; güncel kararlar bu Markdown sürümündedir.

İlk pilot APK olarak çevredeki küçük bir kullanıcı grubuna elle dağıtılır. Geri bildirimlerden sonra Google Play, daha sonra iOS hedeflenir. Pilot tek kullanıcılıdır; aynı bütçeyi iki telefondan ortak düzenleme ve cihazlar arası senkronizasyon kapsam dışıdır.

## 2. Kesinleşen ürün kararları

| Konu | İlk pilot kararı |
| --- | --- |
| Platform | Android APK; iOS'a taşınabilir mobil kod tabanı |
| Veri saklama | Finans kayıtları kullanıcının telefonunda; hesap açma ve merkezi finans verisi yok |
| Hesaplar | Banka, nakit, TL birikim ve döviz hesapları ayrı izlenir |
| Para birimi | TL hesapları ve kaynak para biriminde tutulan döviz hesapları; TL karşılığı ayrıca gösterilir |
| Birikimler | Döviz ve altın; güncel fiyat servisinden otomatik TL değerleme |
| Gelir ve gider | Tekrarlayan ve tek seferlik gelirler; tarihi belli ödemeler ve aylık değişken gider tahminleri |
| Gerçek harcama | Kullanıcı isterse harcamayı kategori ve hesapla kaydeder; tutar uygulamadaki bakiyeden hemen düşer. Her alışverişin girilmesi zorunlu değildir |
| Kategoriler | Gider girerken kategori seçilir; aylık planlanan ve gerçekleşen tutarlar ayrı gösterilir |
| Kayıt silme | Kullanıcı girdiği kayıtları tek tek silebilir; bakiye etkili işlemler yalnız güvenle geri alınabiliyorsa silinir |
| Kredi kartı | Ekstre, ödeme tarihi, planlanan ödeme ve taksit; tek tek kart alışverişi yok |
| Bakiye güncelleme | Kullanıcı hesap bakiyelerini ara sıra girer; tahmin farkı görünür; kalan değişken harcama tahmini sorulur |
| Ana çıktı | Bugünkü harcanabilir TL, tahmini ay sonu TL bakiyesi, toplam varlığın TL karşılığı ve 3/6/12 aylık görünüm |
| Senaryo | Yeni gelir, gider veya taksitin gelecekteki bakiyelere etkisini deneme |
| AI | İlk pilotta yok; hesaplar deterministik kurallarla yapılır |

### Kapsam dışı

Banka bağlantısı, otomatik işlem çekme, fon/hisse/kripto takibi, yatırım veya kredi işlemi, iki cihaz arasında senkronizasyon, ortak aile hesabı, birikim hedefi ve AI sohbeti ilk pilotta yer almaz. Kullanıcı aile giderlerini kendi bütçesine yine ekleyebilir.

## 3. Kullanıcı akışı ve ekranlar

1. **İlk kurulum:** Hesap ekle, bugünkü bakiyeyi gir, gelirleri ve en az bir düzenli gideri tanımla. Kart ve birikim ekleme sonraki adımda yapılabilir. Boş tahmin yerine eksik veri uyarısı gösterilir.
2. **Ana ekran:** “Varlıklarım” başlığı altında brüt toplam varlığın yaklaşık TL karşılığı, kullanım hesapları ve birikimler görünür. Hesap bazında ay sonunda kalacak tutar ve toplam tahmin de görünür. Yaklaşan ödemeler ve olası nakit açığı ayrıca sunulur.
3. **Hesaplar:** Banka, nakit, TL birikim ve döviz hesapları ayrı listelenir. Döviz hesabında kaynak miktar ve TL karşılığı birlikte gösterilir. Bakiye güncelleme buradan başlar.
4. **Plan ve giderler:** Tek seferlik veya tekrarlayan gelirler, sabit giderler ve aylık değişken gider bütçeleri yönetilir. Gider için kategori seçilir; kullanıcı gerçek harcamayı hesap ve tarihle kaydedebilir. Aylık kategori özetinde planlanan ile gerçekleşen ayrı görünür.
5. **Kartlar ve taksitler:** Kart ekstresi, hesap kesim tarihi, son ödeme tarihi, planlanan ödeme, aylık kart harcaması tahmini ve taksitler gösterilir. Ödenmiş/ödenmemiş durumu izlenir.
6. **Birikimler:** Döviz ve altın miktarı, kendi birimi, güncel birim fiyatı, TL karşılığı, fiyat kaynağı ve son güncelleme zamanı gösterilir. Bozdurma/satış gerçek bir hesap transferi olarak kaydedilir.
7. **Nakit akışı:** Hesap ve toplam düzeyinde 3/6/12 aylık görünüm; aylık özetin yanında ay içinde eksiye düşülen tarihler. Gerçek bakiye ile tahmin açıkça ayrılır.
8. **Senaryo:** Yeni bir gelir, gider veya taksit geçici olarak eklenir; temel plan ile senaryo karşılaştırılır. Kullanıcı açıkça kaydetmedikçe gerçek plan değişmez.
9. **Yedek ve veri:** Yerel verinin parolayla şifreli dışa aktarılması, dosyanın ön izlemeden sonra geri yüklenmesi ve güvenli kayıt silme işlemleri.

## 4. Finansal hesaplama kuralları

### 4.1 Bakiye ve nakit akışı

- Her hesap, kendi para biriminde bir **bakiye anlık görüntüsü** ile başlar. Görüntünün tutarı ve tarihi saklanır.
- Gelecek bakiye, son görüntüden sonra beklenen tarihli gelirler, ödemeler ve transferler uygulanarak hesaplanır. Ödenmiş hareketler tekrar düşülmez. Kapanış bakiyesi sonraki aya taşınır.
- Tahmin motoru hareketleri gün sırasıyla işler; yalnız ay sonuna bakmak yerine ödeme tarihinde oluşan TL nakit açığını da gösterir.
- **Harcanabilir TL**, TL cinsinden kullanılabilir banka/nakit bakiyeleri ve planlanmış TL hareketleri üzerinden hesaplanır. Birikim olarak ayrılmış hesaplar ve bozulmamış döviz/altın, kendiliğinden TL ödemelerini karşılamış sayılmaz.
- **Toplam varlığın TL karşılığı**, TL varlıkları ile döviz ve altının güncel fiyatla yaklaşık TL değerinin toplamıdır. Kart borcu veya başka bir borç düşülüyorsa ekranda bunun “net varlık” olduğu açıkça belirtilir; brüt varlıkla karıştırılmaz.

### 4.2 Bakiye güncellemesi ve tahmin farkı

- Kullanıcı yeni bakiyeyi girdiğinde uygulama aynı tarih için önceki tahmini bakiye ile yeni gerçek bakiyeyi karşılaştırır. Fark; hesap, tarih aralığı ve para birimiyle görünür.
- Fark otomatik olarak “harcama” diye sınıflandırılmaz. Girilmemiş gelir, transfer, ödeme, değişken gider veya başlangıç tahminindeki hata olabilir. Kullanıcı açıklama ekleyebilir.
- Gerçek harcama kaydedildiğinde seçilen kullanım hesabının uygulamadaki bakiyesi atomik olarak azalır; son **gerçek bakiye gözlemi** tarihi değişmez. Gözlemden önce yapılmış gider tekrar girilmez. Kullanıcı bakiyeyi sonra yeniden gözlediğinde bu gözlem yeni başlangıç olur.
- Gerçek harcama bir düzenli veya tek seferlik gider planını karşıladıysa ilgili dönemin planı tahminde ikinci kez düşülmez. Değişken bütçeye bağlandıysa bu ay için bildirilen kalan tahmin uygun biçimde azaltılır. Bağlantısız harcama ek giderdir.
- Yeni görüntü, ilgili hesabın ileriye dönük tahmini için başlangıç noktası olur. Eski görüntüden önceki plan hareketleri yeniden uygulanmaz.
- Günlük gider girilmediği için kullanıcıya, bakiye güncellerken **“Bu ayın kalanında yaklaşık ne kadar değişken harcama yapacaksın?”** sorusu sorulur. Önceki plana göre öneri sunulabilir; seçilen tutar ve bunun tahmin olduğu gösterilir. Tutar, mevcut plandaki kaynak hesaplara dağıtılır; kullanıcı dağılımı değiştirebilir. Kartla yapılacak harcama bu TL nakit çıkışı tahminine katılmaz, kart ekstre akışında izlenir.
- Döviz/altın TL değerindeki yalnızca kur veya fiyat kaynaklı değişim, hesapta açıklanamayan nakit hareketi ya da yeni gelir sayılmaz. Kaynak miktar ile TL değerleme farkı ayrı izlenir.

### 4.3 Gelir, gider, transfer ve kart

- Gelir kaynak tutarı ve para birimiyle saklanır; seçilen hesaba yatar. Döviz gelirinin TL karşılığı fiyat zamanına bağlı bir değerlemedir. Kullanıcı dövizi bozdurmadıysa TL nakit akışına para girmiş sayılmaz.
- Düzenli ödemelerde tutar, sıklık, ödeme tarihi, kaynak hesap ve durum saklanır. Aylık değişken giderlerde kategori, aylık tahmin ve ödeme yöntemi saklanır.
- Hesaplar arası transfer toplam varlığı değiştirmez. Döviz bozdurma veya altın satışı kaynak miktarı, gerçekleşen kur/fiyat, masraf ve elde edilen TL ile kaydedilir; tahmini piyasa fiyatı gerçekleşen tutarın yerine geçmez.
- Kart harcaması ve kart ekstresi ödemesi iki ayrı etki yaratır: ilki kart borcunu, ikincisi TL hesabından nakit çıkışını etkiler. Aynı alışveriş iki kez gider sayılmaz.
- Aylık kart harcaması tahmini, hesap kesim ve ödeme günlerine göre gelecek ekstreye yaklaşık dağıtılır. Gerçek ekstre geldiğinde kullanıcı tutarı günceller. Kart taksitleri ekstre tahminiyle çakışmayacak şekilde tek kaynaktan üretilir.
- Eksik ekstre ödemesinde kalan borç izlenir. Faiz ve vergi, doğrulanmış oranlar ve açık kullanıcı varsayımı olmadan kesin rakam gibi hesaplanmaz.

### 4.4 Döviz ve altın fiyatı

- Döviz ve altının kaynak miktarı hiçbir zaman TL değerine dönüştürülerek kaybedilmez. Fiyat servisi yalnız değerleme üretir.
- Her değerlemede varlık kodu/türü, fiyat, para birimi, fiyat kaynağı ve zaman damgası tutulur. Ekrandaki TL tutarı **yaklaşık değer** olarak etiketlenir. Alış/satış makası ve kurumun gerçek işlem kuru farklı olabilir.
- Fiyat alınamazsa son başarılı fiyat ve tarihi gösterilir; sessizce “güncel” denmez. Kullanıcının finans kayıtları fiyat servisine gönderilmez; yalnız gereken varlık kodları sorgulanır.
- Gelecek ayların döviz/altın TL karşılığı bugünkü fiyatla hesaplanıyorsa bu varsayım belirtilir. Senaryoda farklı kur/fiyat varsayımı denenebilir; kesin getiri öngörüsü sunulmaz.
- İlk destek kataloğu için USD, EUR ve Türkiye'de yaygın altın türleri hedeflenir. Kesin altın türleri ve fiyat kaynağı, servis kapsamı doğrulandıktan sonra geliştirme görevine bağlanır.

## 5. Veri ve teknik mimari

### İlk pilot

- **Mobil:** React Native + TypeScript ile Android APK; aynı uygulama mantığı iOS için kullanılabilir.
- **Yerel veri:** SQLite, sürümlü şema geçişleri ve veri erişim katmanı. Finans kuralları ekrandan ve depolama kodundan ayrı bir hesaplama modülünde tutulur.
- **Kimlikler ve zaman:** Kayıtlarda kalıcı benzersiz kimlik, oluşturulma/değiştirilme zamanı, işlem tarihi ve para birimi bulunur. Gelecekte senkronizasyon için kayıt sözleşmeleri sürümlenir.
- **Para hesabı:** Tam sayı kuruş veya hassas ondalık türü kullanılır; JavaScript kayan nokta değeri doğrudan finansal sonuç için kullanılmaz. Döviz/altın miktarı ve birim fiyatında ayrı hassasiyet kuralları tanımlanır.
- **Fiyat katmanı:** Döviz ve altın için kaynak adaptörleri, önbellek, zaman damgası ve hata durumu. Gizli API anahtarı APK içine konmaz. Seçilen sağlayıcı anahtar gerektirirse yalnız fiyat verisi sunan küçük bir ara servis kullanılır; kullanıcının finans kayıtları bu servise gönderilmez.
- **Yedek:** Kullanıcı verisini dışa aktarma ve geri alma ilk pilotun parçasıdır. Dışa aktarılan finans verisi için şifreli taşınabilir yedek biçimi ve geri yükleme doğrulaması uygulanır.

### Sonraki aşamaya hazırlık

Merkezi hesap, bulut yedeği veya iki cihaz arasında kullanım gerekirse kimlik doğrulama, sunucu veri modeli, senkronizasyon ve çakışma çözümü ayrı bir aşamada eklenir. Bu aşamada Java 21/Spring Boot ve PostgreSQL değerlendirilebilir. İlk pilotta çalışmayan bir backend'i kurmak gerekmiyor; hesaplama kuralları ve veri sözleşmeleri bağımsız tutulduğu için uygulama ekranları yeniden yazılmadan sunucu eklenebilir. Yine de senkronizasyonun kendisi yeni geliştirme işidir.

## 6. Güvenlik ve kullanıcı kontrolü

- Banka şifresi, kart numarası, kimlik numarası veya gereksiz kişisel bilgi toplanmaz. Banka bağlantısı yoktur.
- Yerel veri uygulamanın özel alanında tutulur. Dışa aktarılan yedek şifreli olur; yanlış veya bozuk yedek yüklemesi mevcut veriyi bozmaz.
- Kullanıcı tüm yerel veriyi silebilir. Hesap bakiyesi ve varlık miktarı fiyat servisine ya da analitik servisine gönderilmez.
- Tekil kayıt silmede hesap, kart ve birikim bağımlılıkları kontrol edilir. Gerçek harcama, bozdurma ve satış gibi bakiyeyi değiştiren kayıtlar yalnız sonraki bakiye/işlem zinciri bozulmadan tersine çevrilebiliyorsa silinir.
- Fiyat ve finans tahminlerinde kullanılan kaynak, tarih ve varsayım görünürdür. Uygulama yatırım tavsiyesi veya kesin getiri vaadi sunmaz.
- Yayın öncesinde gizlilik metni, kullanılan fiyat servisinin lisansı/koşulları ve mağaza gereklilikleri ayrıca incelenir.

## 7. Pilot doğrulama ve kabul ölçütleri

Pilot 5–10 kişiyle başlar. Görüşmelerde kullanıcıların ana ekrandaki üç tutarı doğru ayırt edip etmediği, bakiye güncellemenin yükü, kart ve döviz davranışının anlaşılması, tahmin farkına verilen tepki ölçülür.

İlk APK, aşağıdaki örneklerin her birini doğru ve açıklanabilir biçimde göstermelidir:

1. Kullanıcı TL hesap bakiyesi, maaş tarihi ve kira girer; ay sonu tahmini ve kira günündeki bakiye görünür.
2. Kullanıcı ara tarihte bakiyeyi günceller; fark görünür, kalan değişken harcama sorulur ve geçmiş ödemeler tekrar düşülmez.
3. Kart harcama tahmini ve ekstre ödemesi, banka bakiyesinden aynı tutarı iki kez eksiltmez.
4. USD veya altın miktarının fiyatla TL karşılığı değişir; kaynak miktar ve TL harcanabilir bakiye değişmez.
5. Kullanıcı döviz bozdurur; kaynak döviz azalır, gerçekleşen TL ilgili hesaba eklenir.
6. Senaryo sonucu temel planla karşılaştırılır; senaryoyu kapatmak gerçek kayıtları değiştirmez.
7. Şifreli yedek dışa aktarılır ve başka bir kurulumda geri yüklenir; toplamlar aynı kalır.
8. Giderlere kategori atanır; seçilen ayda planlanan ve gerçekten kaydedilen tutarlar ayrı görünür. Bir gerçek harcama seçilen hesabı azaltır ve bağlı planı ikinci kez düşürmez.
9. Kullanıcı son gerçek harcamayı siler; bakiye geri döner. Araya yeni bakiye gözlemi veya başka işlem girdiyse güvensiz geri alma engellenir.

Pilotun ürün ölçütleri: ilk anlamlı tahmine ulaşma süresi, ilk kurulum tamamlama oranı, 7/30 günlük kullanım, tahmin ile güncellenmiş bakiye farkı, fiyat verisi erişilebilirliği ve kullanıcıların hesaplama açıklamasını anlayabilmesi. Sayısal başarı eşikleri, ilk kullanıcı testlerinden sonra belirlenir.

## 8. Uygulama sırası

1. Ekran akışını ve hesaplama örneklerini tıklanabilir prototipte doğrula.
2. Yerel hesap/veri modelini, para hassasiyeti kurallarını ve hesaplama motorunu oluştur.
3. İlk kurulum, hesaplar, gelir/gider planı ve ana ekranı geliştir.
4. Bakiye güncellemesi, tahmin farkı, kart/ekstre ve taksit akışını ekle.
5. Döviz/altın fiyat kaynaklarını doğrula; birikimler ve bozdurma akışını ekle.
6. 3/6/12 aylık görünüm, nakit açığı uyarısı ve basit senaryo denemelerini tamamla.
7. Şifreli yedek/geri yükleme, erişilebilirlik ve hesaplama doğrulamasını tamamlayıp APK pilotuna geç.

## 9. Geliştirmeden önce doğrulanacak teknik seçimler

Bu başlıklar ürün kapsamını değiştirmez; sağlayıcı ve uygulama ayrıntısı seçimi gerektirir:

- Döviz ve altın için güncel, güvenilir, kullanım koşulları uygun fiyat kaynakları; destekledikleri para birimi ve altın türleri; fiyat gecikmesi ve alış/satış fiyatının anlamı.
- Fiyat servisinin gizli anahtar gerektirip gerektirmediği ve yalnız fiyat verisi için ara servis ihtiyacı.
- Android/iOS'ta yerel verinin korunması, şifreli yedek biçimi ve SQLite kütüphanesinin uygunluğu.
- Kart dönemi boyunca toplu aylık harcama tahmininin ekstreye dağıtım kuralı ve eksik ödeme sonrası faiz kapsamı. Pilot arayüzünde yaklaşık tahmin açıkça işaretlenecektir.

Pazar/rakip değerlendirmesi ve ticari model, ilk PDF'deki gibi hipotez düzeyindedir. Google Play ve abonelik kararı, pilot kullanım verilerinden sonra ayrıca verilir.
