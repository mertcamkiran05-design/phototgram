# Memogram / Phototgram — proje notları

Etkinlik anı toplama uygulaması. Misafirler QR/link ile girer, giriş yapmadan fotoğraf-video yükler; ev sahibi panelinden galeriyi görür ve ZIP indirir.

## Dosyalar
- `Memogram.dc.html` — tek kaynak dosya (tüm ekranlar burada: landing, auth, panel, etkinlik oluşturma, etkinlik detayı, misafir sayfası, lightbox).
- `index.html` — `super_inline_html` ile derlenmiş, tek parça production dosyası. **Vercel'e giden dosya budur.** Her değişiklikten sonra yeniden derlenir.
- `Memogram-standalone.html` — eski derleme adı, artık kullanılmıyor.
- `supabase-kurulum.sql` — şema + RLS + realtime + storage kurulumu. Supabase SQL Editor'de baştan sona çalıştırılır.
- `github.md` — repo bağlantısı ve sync kaydı.

## Deploy akışı
1. `Memogram.dc.html` düzenlenir (dc_* araçlarıyla).
2. `super_inline_html` → `index.html`.
3. `index.html` GitHub reposuna (mertcamkiran05-design/phototgram, main) push edilir; Vercel otomatik deploy eder.
- Canlı adres: phototgram.vercel.app. Repo kökünde `index.html` olmazsa Vercel 404 verir.
- Hangi build'in canlı olduğunu anlamak için misafir sayfası altında sürüm etiketi var ("Powered by Memogram · v7").

## Supabase
- URL/anon key `Memogram.dc.html` içinde sabit.
- Tablolar: `events` (owner, name, event_date, deadline, welcome, theme, is_open), `media` (event_id, uploader nullable, guest_key, uploader_name, path, kind).
- RLS: `anon` + `authenticated` her ikisi de events/media okur; media insert anon'a açık (etkinlik `is_open` ve deadline geçmemişse); delete sadece authenticated (yükleyen ya da etkinlik sahibi).
- Storage bucket `media` public; anon insert açık, delete authenticated.
- Etkinlik başına 500 dosya limiti trigger ile.
- Realtime: `media` ve `events` `supabase_realtime` publication'ına ekli, `replica identity full`.

## Realtime davranışı (istemci)
- `watchEvent(id)` tek kanal açar: `media` için `*`, `events` için `UPDATE`, ikisi de `event_id`/`id` filtresiyle.
- Satır bazlı state güncellemesi (INSERT ekler, UPDATE değiştirir, DELETE çıkarır) — tüm listeyi yeniden çekmez.
- `CHANNEL_ERROR|TIMED_OUT|CLOSED` durumunda 4 sn sonra yeniden bağlanır.
- Realtime bağlı değilse 10 sn'lik polling yedeği; sekmeye dönünce ve `online` olayında tazeleme.
- Bağlıyken galeri başlığında yeşil "Canlı", değilse "Yenile" yazar (`live` state).

## Kimlik doğrulama
- Sadece e-posta + şifre aktif.
- Google butonu duruyor ama OAuth'a bağlı DEĞİL; tıklanınca "yakında" toast'ı gösterir (`loginGoogle`). Kullanıcı bunu böyle istedi.
- Misafirin giriş yapmasına gerek yok: `localStorage`'da `mg_guest_key` (cihaz uuid) ve `mg_guest_name` (isim) tutulur; media satırında `uploader = null`, `guest_key` dolu.

## Çözülmüş hatalar (tekrar etmesin)
- **Kritik:** `onFilesPicked` içinde `e.target.value = ''` satırı, dosyalar diziye kopyalanmadan çalıştığı için FileList'i boşaltıyordu → hiçbir yükleme olmuyordu. Önce `Array.from(e.target.files)`, sonra reset.
- MIME tipi filtresi mobil dosyalarda (HEIC/MOV, boş `type`) yükleme engelliyordu → filtre kaldırıldı, `accept` sınırı da kaldırıldı; video değilse fotoğraf sayılıyor.
- Misafir sayfasındaki "giriş yap" duvarı kaldırıldı, yerine isim alanı geldi.
- Yükleme/kayıt hataları sessizce yutuluyordu → artık gerçek Supabase mesajı toast ve kırmızı hata kutusunda gösteriliyor (`loadError`).
- QR/misafir linki sabit `memogram.vercel.app` yerine `window.location.origin` kullanıyor.
- Vercel 404: repo kökünde `index.html` yoktu.

## Galeri sunumu
- Misafir galerisi tek sütun, tam genişlik, `object-fit:contain` (kırpma yok), altında yükleyenin adı; videolar `controls` ile oynar.
- Ev sahibi etkinlik ekranında filtreler (tümü/fotoğraf/video), ZIP indirme, QR indirme, link kopyalama, yüklemeyi açma-kapama, etkinlik silme var.

## Yapılmayanlar / açık konular
- Google OAuth bağlanmadı.
- Misafirler kendi yüklediklerini silemez (RLS delete anon'a kapalı).
- Yükleme yüzdesi gerçek progress değil, adım adım sahte ilerleme.
