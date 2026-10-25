# Ürün analizi ile pilot uygulama arasındaki farklar

**İnceleme tarihi:** 25 Ekim 2026; kategori ve yedek geliştirmesi sonrası güncellendi
**Kaynak:** [Ürün analizi v2](urun_analizi.md), mevcut Expo uygulaması ve pilot kullanıcı geri bildirimleri.

## Önce netleştirilecek ürün kararı

Kullanıcılar giderleri kategoriye göre görmek istiyor. Bakiye farkı, market veya ulaşım gibi kategorilere güvenilir biçimde dağıtılamaz. Bu nedenle kategori ekranında **planlanan gider** ile ayrıca girilen **gerçekleşen harcama** ayrı gösteriliyor. Gerçek harcama hesabın uygulamadaki bakiyesini azaltıyor; bağlı planla eşleştirilebiliyor. Bu akışın gerçek Android cihazda doğrulanması gerekiyor.

## Öncelikli eksikler

| Öncelik | Dokümandaki hedef / yeni geri bildirim | Bugünkü durum | Tamamlanma ölçütü |
| --- | --- | --- | --- |
| 1 | Şifreli yerel yedek dışa aktarma ve geri yükleme (§3, §5, kabul örneği 7) | Kod ve testler eklendi; cihazda dosya paylaşma/seçme ve geri yükleme henüz denenmedi. | Başka kurulumda yedek geri yüklenir; yanlış parola/bozuk dosya mevcut veriyi değiştirmez. |
| 1 | Gider kategorileri ve “nereye ne kadar harcadım?” geri bildirimi | Kategori, isteğe bağlı gerçek harcama ve planlanan/gerçekleşen aylık özet eklendi; cihaz testi bekliyor. | Her gider girişinde kategori seçilir; eski kayıtlar “Kategorisiz” görünür; ay ve para birimi bazında doğru toplam alınır. |
| 1 | Kullanıcının kayıtlarını düzeltmesi ve silebilmesi | Tek tek silme eklendi; düzenleme çoğu kayıt için yok. Cihaz testi bekliyor. | Hesap, plan, kart, ekstre, taksit, altın, bakiye, harcama ve dönüşüm kayıtlarında güvenli silme cihazda doğrulanır; yanlış tutar/tarih kayıtları silip yeniden girmeden düzenlenebilir. |
| 1 | Pilot kabul örneklerinin fiziksel cihaz doğrulaması (§7) | Birim test ve Android paketleme var; gerçek cihazda bütün akışların kayıt altına alınmış kabul sonucu yok. | Maaş/kira, bakiye farkı, kart, FX/altın, senaryo, silme ve yedek örnekleri cihazda geçer. |
| 2 | İlk kurulum yönlendirmesi (§3) | Ana ekranda kullanım açıklaması ve boş durumlar var; adım adım kurulum yok. | Yeni kullanıcı hesap, bakiye, gelir ve gider ekleyip ilk ay sonu tahminine kolayca ulaşır; eksik adım açıkça görünür. |
| 2 | Tahmin farkına açıklama ekleme (§4.2) | Fark tutarı görünür; kullanıcı nedenini kaydedemiyor. | Kullanıcı fark için isteğe bağlı açıklama yazar ve geçmişte okur; fark otomatik gider sayılmaz. |
| 2 | Bu ay kalan değişken giderin kolay güncellenmesi (§4.2) | Değer yalnız bakiye güncelleme formunda giriliyor; aylık bütçe bu aya otomatik uygulanmıyor. | Kullanıcı tahminin neden eksik olduğunu görür ve kalan tutarı açık bir akışla günceller; kart gideri ikinci kez düşmez. |
| 2 | Kartta kısmi ödeme sonrası kalan borç (§4.3) | Kalan borç görünür; aynı ekstreye ikinci ödeme kaydı yok. | Birden fazla gerçek ödeme ve kalan borç doğru izlenir; bakiye tahmininden iki kez düşülmez. |
| 2 | Hesaplar arası TL transferi (§4.3) | Döviz bozdurma ve altın satışı var; iki TL hesabı arasında transfer yok. | Transfer kaynak ve hedefte tek atomik işlem olur; toplam varlık değişmez. |
| 3 | Düzenli ödemenin sıklığı (§4.3) | Tekrarlama aylık; haftalık/yıllık seçenek yok. | Kullanıcı ihtiyacı doğrulanırsa tarih kuralı ve tahmin motoru genişletilir. |
| 3 | Altın türleri ve fiyat kaynağı (§4.4) | Gram altın var; diğer altın türleri ve alış/satış farkı yok. | Pilot kullanıcı ihtiyacı ve fiyat servisinin lisansı/kapsamı doğrulanır. |

## Dokümanda güncellenecek kararlar

- Ana ekran tanımı artık “Varlıklarım” odağını ve hesap bazında ay sonunda kalacak tutarı içermeli. Doküman en üstte yalnız ay sonu toplamını tarif ediyor.
- Kategori seçimi, kullanıcı geri bildirimiyle pilot ihtiyacına dönüştü; plan/gider veri sözleşmesi ve kategori raporu dokümana eklenmeli.
- Tek tek kayıt silme isteği, dokümandaki yalnız “tüm veriyi silme” maddesinden daha geniş. Bağlı kayıt ve bakiye dönüşümü kuralları kabul örneklerine eklenmeli.
- Günlük alışverişi tek tek girme kararı korunacaksa kategori ekranındaki “harcanan” ifadesi için dönemsel gerçek tutar girişinin nasıl yapılacağı kararlaştırılmalı.
- Varlık toplamının kart borcunu düşmeyen yaklaşık **brüt** tutar olduğu ana ekran ve dokümanda tutarlı yazılmalı.

## Önerilen sıra

1. Kategori, silme ve şifreli yedeği fiziksel Android cihazda uçtan uca doğrulama; hatalı dosya ve yanlış parola denemelerinde verinin korunduğunu görme.
2. İlk kurulum ve hesap bazlı ay sonu tahmininin anlaşılabilirliğini pilot kullanıcılarla sınama.
3. Düzenleme, fark açıklaması, kısmi kart ödemesi ve TL transferi.

## Kısa ürün araştırması

25 Ekim 2026'da incelenen resmi ürün kaynaklarından bu pilot için çıkan uygulanabilir fikirler:

- [Actual Budget: Tracking Budget](https://actualbudget.org/docs/getting-started/tracking-budget), planlanan ve gerçekleşen tutarları ayrı izliyor. Bizim kategori özetinin adlandırmasında aynı ayrım gerekli; mevcut bakiye farkından kategorilere gerçek harcama dağıtılmamalı.
- [Actual Budget: Backup](https://actualbudget.org/docs/backup-restore/backup) ve [Restore](https://actualbudget.org/docs/backup-restore/restore), yedek alma ve geri yükleme akışının kullanıcıya görünür olmasını gösteriyor. Bu uygulamada finans verisinin tek kopyası telefonda olduğu için şifreli ve doğrulanan yedek öncelikli.
- [YNAB: Features](https://www.ynab.com/features), kategori ve harcama raporlarını gösteriyor. Bu pilot için önce aylık kategori özeti; ihtiyaç doğrulanırsa son üç ay eğilimi yeterli bir başlangıç.

Bu karşılaştırma banka bağlantısı veya kapsamlı yatırım takibi ekleme kararı değildir. Öncelik, mevcut ürün vaadini kullanıcıya doğru ve anlaşılır göstermektir.
