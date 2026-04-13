# Electron Staj Kontrol Uygulaması

Bu uygulama transkript PDF dosyasını okuyup şu kuralları kontrol eder:

## Staj I
Öğrenci şu iki dersten D veya üstü almış olmalı:
- BİL240
- BİL265

## Staj II
Öğrenci önce Staj I şartını sağlamalı ve ayrıca BİL300 (Staj I) dersini geçmiş olmalı.
Buna ek olarak şu derslerden de D veya üstü almış olmalı:
- BİL343
- BİL367
- BİL344
- BİL386

Geçer notlar:
- D
- D+
- C-
- C
- C+
- B-
- B
- B+
- A-
- A

## Kurulum
```bash
npm install
npm start
```

## Not
PDF metin çıkarımı bazen karakterleri bozuk okuyabilir. Bu yüzden kodda BIL/BİL normalize işlemleri ve bozuk ayraç temizliği yapıldı.
