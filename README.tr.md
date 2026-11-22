<div align="center">
  <h1>ModelCheck</h1>
  <p><strong>Ajana 3B modeli tarif et. Ürettiği GLB’yi gerçekten inceleyip teslim etsin.</strong></p>
  <p>Python ile üret · Görüntüyü incele · Modeli düzelt</p>
  <p>
    <img src="https://img.shields.io/badge/%C3%A7al%C4%B1%C5%9Fma-yerel-2c6654" alt="Yerel çalışma">
    <img src="https://img.shields.io/badge/bi%C3%A7im-GLB%202.0-3d526b" alt="GLB 2.0">
    <a href="LICENSE"><img src="https://img.shields.io/badge/lisans-MIT-34454d" alt="MIT lisansı"></a>
  </p>
  <p>
    <a href="README.md">English</a> · <strong>Türkçe</strong> · <a href="https://hakanbabus.github.io/ModelCheck/?sample=rally-paddle">Canlı örnek</a> · <a href="PYTHON_MODEL_GUIDE.md">Python rehberi</a>
  </p>
  <a href="docs/rally-comparison.png"><img src="docs/rally-comparison.png" width="1040" alt="Solda Rally raket taslağı, sağda ortalanmış sap ve kenara uyumlu kauçuk"></a>
  <p><sub>Python ile üretilen Rally raketi. Ortak ön görünüş, sapın ve kauçuk kenarının nasıl düzeltildiğini gösteriyor.</sub></p>
</div>

## Ajana söyle

> [ModelCheck](https://github.com/HakanBabus/ModelCheck) kullanarak detaylı bir masa tenisi raketi yap. Python ile üret, inceleme görsellerini açıp eleştirel bak, bulduğun sorunları düzelt ve son GLB ile kaynak kodu teslim et.

Ajan yerel bir kopyayı kullanabilir veya depoyu GitHub’dan indirip **[AGENTS.md](AGENTS.md)** ile başlayabilir. Rehber onu üretim, eleştirel görsel kontrol, düzeltme ve teslim adımlarından geçirir. Ajan modelleme yöntemini brief’e göre seçer. [Blender’sız Python rehberi](PYTHON_MODEL_GUIDE.md) · [Adım adım Rally örneği](docs/DETAILED_ASSET_EXAMPLE.md)

## Hızlı başlangıç

Örnek üretici için **Node.js 22.12+** ve **Python 3** kullan.

```sh
git clone --depth 1 https://github.com/HakanBabus/ModelCheck.git
cd ModelCheck
npm ci
python examples/generate_paddle.py --out review/rally-paddle.glb
npm run --silent inspect -- review/rally-paddle.glb --out review/rally.png
```

Komut **`png`** ve **`report`** dosyalarının tam yollarını JSON olarak döndürür. Görseli aç, gerçek ölçü ve geometri sayımlarına rapordan bak. Arka veya alt yüzü yakından kontrol etmek için **`--view back`** ya da **`--view bottom`** kullan. Sürümleri aynı koordinatlarda karşılaştırmak için **`--baseline <önceki.glb>`** ver.

Render yerelde Chromium, Chrome veya Edge ile çalışır. Chromium kurmak için **`npx playwright install chromium`** çalıştır. Linux’ta sistem kütüphanesi eksikse **`npx playwright install --with-deps chromium`** kullan.

## Tarayıcıda incele

GLB dosyanı veya model klasörünü aç. **Auto orbit**, **Fly**, **Measure**, **Section**, **Motion** ve **Pin** ile modeli incele. **Compare versions** iki modeli ortak koordinatlarda çizer. Üretici sürümleri aynı model kimliği ve ayrı revizyon etiketleriyle işaretleyebilir. [Canlı örnek](https://hakanbabus.github.io/ModelCheck/?sample=rally-paddle) · [Sürüm etiketleri](PYTHON_MODEL_GUIDE.md#record-which-model-the-versions-belong-to)

**Save current view** açık olan kesiti veya animasyon pozunu kaydeder. Dört açılı inceleme ve karşılaştırma tam modeli başlangıç pozunda gösterir. **`npm run dev`** ile yerel görüntüleyiciyi açabilir, **`npm run build`** ile **`dist/`** altında statik siteyi oluşturabilirsin.

## Etkileşimli inceleme paylaş

```sh
npm run --silent share -- review/rally-paddle.glb --title "Rally incelemesi"
```

JSON’daki **`url`** modeli aynı bilgisayarda açar. Sunucu bir saat kullanılmadığında kapanır. Karşılaştırma için **`--baseline`**, kayıtlı nokta notları için **`--pins`** ekle. Başka cihazdan erişim için **`--static`** ile oluşturulan **`directory`** klasörünü erişilebilir bir sunucuda yayınla. Klasör seçilen GLB’lerin kopyalarını içerir.

[MIT lisansı](LICENSE)
