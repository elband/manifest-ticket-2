# SIPANDAI Desktop (Lubuntu)

Aplikasi desktop berbasis Electron untuk **dashboard admin** dan **mode kiosk**
SIPANDAI. Aplikasi ini hanya membungkus web SIPANDAI, jadi frontend dan backend
tetap berjalan di server (Nginx → Next.js :3000 + NestJS :3001). Setiap deploy
web langsung terpakai di aplikasi tanpa perlu memasang ulang.

| Mode | Cara buka | Isi |
|---|---|---|
| Dashboard | menu aplikasi **SIPANDAI** / `sipandai-desktop` | jendela biasa (dimaksimalkan), menu Aplikasi & Tampilan, klik kanan Salin/Tempel |
| Kiosk | **SIPANDAI Kiosk** / `sipandai-desktop --kiosk` | `/scan/kiosk` layar penuh, tanpa menu |

Opsi lain: `--server=https://alamat` memakai server tersebut hanya untuk sesi ini.

## Bedanya dengan membuka lewat browser

- **Tidak perlu `kiosk-agent/`.** Tombol Tutup, Perkecil, dan Matikan Perangkat
  di menu ⚙ kiosk dijalankan langsung oleh aplikasi
  ([src/lib/kioskAgent.ts](../src/lib/kioskAgent.ts) memilih jalur ini secara
  otomatis). Agent tetap diperlukan bila kiosk masih dibuka lewat Chromium.
- Izin kamera dan layar penuh langsung diberikan, **hanya** untuk alamat server
  SIPANDAI.
- Tautan ke situs lain dibuka di browser sistem, tidak di dalam aplikasi.
- Bila server tidak terjangkau, misalnya Wi-Fi belum siap saat boot, muncul
  layar "Server tidak dapat dihubungi" yang mencoba lagi otomatis setiap 15 detik.

## Pasang di Lubuntu

Paket hanya untuk **64-bit (x86_64)**. Electron tidak mendukung 32-bit.
Perangkat **tidak perlu clone project**. Cukup unduh paket dari
[Releases](https://github.com/elband/manifest-ticket-2/releases), lalu pasang:

```bash
wget https://github.com/elband/manifest-ticket-2/releases/latest/download/sipandai-desktop-amd64.deb
sudo apt install ./sipandai-desktop-amd64.deb
```

Atau pakai AppImage tanpa instalasi:

```bash
wget https://github.com/elband/manifest-ticket-2/releases/latest/download/sipandai-desktop-x86_64.AppImage
chmod +x sipandai-desktop-x86_64.AppImage
./sipandai-desktop-x86_64.AppImage
```

Bila perangkat tidak punya akses internet (hanya jaringan internal bandara),
unduh file di komputer lain, lalu salin lewat flashdisk atau taruh di server
internal. `SHA256SUMS.txt` di halaman release dipakai untuk memastikan file
tidak rusak: `sha256sum -c SHA256SUMS.txt --ignore-missing`.

Perubahan web SIPANDAI tidak butuh update aplikasi; cukup deploy server.

### Pembaruan aplikasi

Mulai versi **0.1.2**, aplikasi memperbarui dirinya sendiri dari GitHub
Releases (perangkat perlu akses internet ke github.com):

- Aplikasi mengecek versi baru saat dibuka lalu tiap 4 jam, dan mengunduhnya
  di latar belakang.
- **Dashboard:** muncul dialog *"SIPANDAI x.y.z siap dipasang"*. Klik **Pasang &
  Buka Ulang**, masukkan **password admin Lubuntu**, lalu aplikasi terbuka lagi
  dengan versi baru. Bisa juga lewat menu **Aplikasi → Periksa Pembaruan…**.
- **Kiosk:** dialog hanya muncul sesaat setelah aplikasi dibuka (awal shift),
  supaya tidak mengganggu antrean scan. Di luar itu, admin menekan
  **Ctrl+Shift+S** → bagian *Versi & pembaruan* → **Pasang & Buka Ulang**.
- Password dibutuhkan karena paket `.deb` dipasang sebagai root. Bila dialog
  dibatalkan, aplikasi tetap berjalan dan pembaruan bisa dipasang nanti. Data
  scan di perangkat tidak terpengaruh.

Perangkat yang masih memakai **0.1.0 / 0.1.1** perlu memasang **0.1.2** sekali
secara manual (`wget` + `apt install` di atas). Setelah itu pembaruan berikutnya
lewat aplikasi.

Saat pertama kali dibuka, isi alamat server **lengkap dengan `http://` atau
`https://`**, persis seperti di browser, misalnya `http://192.168.50.156`.
Alamat tanpa awalan dianggap `https://`.
Di halaman yang sama ada dua centang untuk perangkat kiosk:

- **Tambahkan SIPANDAI Kiosk ke menu aplikasi**
- **Buka mode kiosk otomatis saat login**

Pintasan ini dibuat untuk user yang sedang login (`~/.local/share/applications`
dan `~/.config/autostart`). Di mode kiosk, halaman pengaturan dibuka dengan
**Ctrl+Shift+S**.

### Server HTTP

Chromium menganggap alamat HTTP (selain localhost) **tidak aman** dan
memblokir kamera, service worker (mode offline), dan clipboard. Di browser
biasa, fitur kamera SIPANDAI tidak berjalan lewat HTTP.

Aplikasi desktop memperlakukan **hanya alamat server SIPANDAI** sebagai aman
(switch Chromium `unsafely-treat-insecure-origin-as-secure`), jadi kamera dan
mode offline tetap berjalan. Saat alamat server diganti ke HTTP, aplikasi
otomatis dibuka ulang agar pengaturan ini berlaku.

> **Risiko:** lalu lintas HTTP tidak terenkripsi. Orang di jaringan yang sama
> bisa menyadap PIN/password, atau menyisipkan skrip yang ikut mendapat akses
> kamera. Gunakan hanya di jaringan internal yang dipercaya. Solusi permanen:
> pasang HTTPS di server (Nginx + sertifikat internal), lalu ganti alamat di
> aplikasi ke `https://` dan ikuti bagian berikut.

### Sertifikat HTTPS internal

Bila server memakai sertifikat CA sendiri, koneksi pertama akan ditolak dan
aplikasi menampilkan **sidik jari SHA-256** sertifikat server. Cocokkan dengan
sidik jari yang dicek di server:

```bash
openssl x509 -in /etc/ssl/certs/sipandai.crt -noout -fingerprint -sha256
```

Bila sama persis, klik **Percayai Sertifikat**. Kepercayaan ini hanya berlaku
untuk alamat server tersebut. Bila sertifikat server diganti, aplikasi akan
bertanya lagi.

### Konfigurasi terpusat (opsional)

Supaya operator tidak perlu mengisi apa pun, admin bisa membuat
`/etc/sipandai-desktop.json`:

```json
{
  "serverUrl": "https://192.168.50.156",
  "trustedCertFingerprint": "AB:CD:EF:...:12"
}
```

Bila `serverUrl` diisi di file ini, alamat server **terkunci** dan tidak bisa
diganti dari aplikasi. Konfigurasi per user tersimpan di
`~/.config/SIPANDAI/config.json`.

### Tombol Matikan Perangkat

Aplikasi menjalankan `systemctl poweroff --no-ask-password`. Di Lubuntu, user
yang login langsung di perangkat biasanya sudah diizinkan. Bila tombol gagal,
pasang aturan polkit dari `kiosk-agent/install.sh` (bagian polkit), atau
buat `/etc/polkit-1/rules.d/50-sipandai-poweroff.rules`:

```js
polkit.addRule(function (action, subject) {
  if (action.id.indexOf("org.freedesktop.login1.power-off") === 0 &&
      subject.user === "kiosk") {
    return polkit.Result.YES;
  }
});
```

Ganti `kiosk` dengan nama user perangkat.

## Pengembangan

```bash
cd desktop
npm install
npm start                                       # dashboard
npm run start:kiosk                             # mode kiosk
npx electron . --server=http://localhost:3000   # ke dev server lokal
```

Ikon `build/icon.png` dibuat dari `public/icons/icon.svg` dengan `npm run icon`.

## Membuat paket .deb / AppImage

Rilis juga memuat `latest-linux.yml`, yang dibaca fitur pembaruan otomatis untuk
mengetahui versi terbaru beserta checksum paketnya. Jangan hapus file ini dari
halaman rilis.

Paket dibangun otomatis oleh GitHub Actions
([.github/workflows/desktop.yml](../.github/workflows/desktop.yml)) di mesin
Ubuntu milik GitHub.

**Rilis versi baru:** buat tag `desktop-v<versi>` dan push. Versi paket
diambil dari tag.

```bash
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

Sekitar 5 menit kemudian, halaman
[Releases](https://github.com/elband/manifest-ticket-2/releases) berisi
`.deb`, AppImage, dan `SHA256SUMS.txt`. Link `releases/latest/download/...` di
atas otomatis menunjuk ke rilis terbaru.

**Build tanpa rilis:** buka tab Actions → *Desktop (Lubuntu)* → *Run workflow*.
Paketnya bisa diunduh dari bagian *Artifacts* run tersebut (disimpan 30 hari).
Setiap push atau PR yang mengubah `desktop/` juga dibangun sebagai pengecekan.

**Build manual** harus dilakukan di Linux, karena electron-builder membutuhkan
`fpm` dan alat AppImage yang tidak berjalan di Windows:

```bash
cd desktop
npm ci
npm run dist          # .deb + AppImage → dist/
npm run dist:deb      # hanya .deb
```
