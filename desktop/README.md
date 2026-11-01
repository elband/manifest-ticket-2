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

```bash
sudo apt install ./sipandai-desktop-0.1.0-amd64.deb
```

Atau pakai AppImage tanpa instalasi:

```bash
chmod +x sipandai-desktop-0.1.0-x86_64.AppImage
./sipandai-desktop-0.1.0-x86_64.AppImage
```

Saat pertama kali dibuka, isi alamat server, misalnya `https://192.168.50.156`.
Di halaman yang sama ada dua centang untuk perangkat kiosk:

- **Tambahkan SIPANDAI Kiosk ke menu aplikasi**
- **Buka mode kiosk otomatis saat login**

Pintasan ini dibuat untuk user yang sedang login (`~/.local/share/applications`
dan `~/.config/autostart`). Di mode kiosk, halaman pengaturan dibuka dengan
**Ctrl+Shift+S**.

### Sertifikat HTTPS internal

Server memakai sertifikat CA sendiri, jadi koneksi pertama akan ditolak dan
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

Paket Linux **harus dibangun di Linux** (Lubuntu/Ubuntu, WSL, atau server),
karena electron-builder membutuhkan `fpm` dan alat AppImage yang tidak berjalan
di Windows.

```bash
cd desktop
npm ci
npm run dist          # .deb + AppImage → dist/
npm run dist:deb      # hanya .deb
```

Hasilnya ada di `desktop/dist/`.
