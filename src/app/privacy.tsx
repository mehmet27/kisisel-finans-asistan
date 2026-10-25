import { ScrollView, Text } from 'react-native';
import { PageTitle, SectionCard, sharedStyles } from '@/ui/components';

export default function PrivacyScreen() {
  return (
    <ScrollView style={sharedStyles.page} contentContainerStyle={sharedStyles.content}>
      <PageTitle eyebrow="GİZLİLİK" title="Verilerin nasıl kullanılıyor?" subtitle="Finans kayıtların bu telefonda kalır." />
      <SectionCard>
        <Text style={sharedStyles.cardTitle}>Yerel finans kayıtları</Text>
        <Text style={sharedStyles.helper}>Hesapların, bakiyelerin, gelirlerin, giderlerin, kartların ve birikimlerin cihazındaki veritabanında tutulur. Hesap açman gerekmez; bu kayıtlar geliştiricinin sunucusuna gönderilmez.</Text>
      </SectionCard>
      <SectionCard>
        <Text style={sharedStyles.cardTitle}>Fiyat sorguları</Text>
        <Text style={sharedStyles.helper}>Yaklaşık TL karşılığı için Frankfurter üzerinden ECB döviz kurları ve Gold API altın fiyatı alınır. İstekler varlık kodlarını içerir; bakiyelerin veya işlem geçmişin gönderilmez. Bu servisler internet bağlantın nedeniyle IP adresini görebilir.</Text>
      </SectionCard>
      <SectionCard>
        <Text style={sharedStyles.cardTitle}>Yedek ve silme</Text>
        <Text style={sharedStyles.helper}>Yedek oluşturursan dosya parolanla şifrelenir; kaydedeceğin veya paylaşacağın yeri sen seçersin. Paylaştığın hizmetin gizlilik koşulları geçerlidir. Uygulama içindeki kayıtları silebilirsin; uygulamanın verilerini Android ayarlarından temizlemek de yerel kayıtları kaldırır. Başka konuma kaydettiğin yedekleri ayrıca silmelisin.</Text>
      </SectionCard>
      <SectionCard>
        <Text style={sharedStyles.cardTitle}>Diğer bilgiler</Text>
        <Text style={sharedStyles.helper}>Uygulamada reklam, analiz aracı, banka bağlantısı veya ödeme hizmeti yoktur. Yedek parolan geliştiriciye gönderilmez; unutursan dosyanı geri açamayız.</Text>
        <Text style={sharedStyles.helper}>Gizlilik soruları için: mehmetcelek.bm@gmail.com</Text>
        <Text style={sharedStyles.helper}>Son güncelleme: 25 Ekim 2026</Text>
      </SectionCard>
    </ScrollView>
  );
}
