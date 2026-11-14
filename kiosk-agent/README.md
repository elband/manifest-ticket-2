# SIPANDAI Kiosk Agent (Lubuntu)

Agen kecil yang dipasang di **perangkat kiosk** supaya tombol di menu ⚙ kiosk
bisa:

- **Tutup Browser**: selalu berhasil, tidak bergantung izin `window.close()` browser.
- **Perkecil Browser**: memakai `xdotool`. Tombol ini hanya muncul bila `xdotool`
  terpasang dan sesi Lubuntu memakai X11 (bawaan Lubuntu). Buka kembali lewat
  taskbar atau Alt+Tab. Selama browser diperkecil, scan **tidak tercatat**.
- **Matikan Perangkat**: `systemctl poweroff`. Tombol ini hanya muncul bila agen terdeteksi.

Tanpa agen, kiosk tetap berjalan seperti biasa. "Tutup Browser" kembali memakai
`window.close()` dan petunjuk Alt+F4, sedangkan "Perkecil" dan "Matikan Perangkat"
disembunyikan.

> Bila perangkat memakai **aplikasi desktop SIPANDAI** ([desktop/](../desktop/README.md)),
> agen ini tidak diperlukan. Aplikasi menjalankan ketiga aksi di atas sendiri.

## Keamanan

- Agen hanya mendengarkan `127.0.0.1:47800`, sehingga tidak bisa diakses dari jaringan.
- Agen hanya menerima request dari alamat yang didaftarkan lewat `--origin`.
  Browser tidak bisa memalsukan header `Origin`.
- Agen mewajibkan header `X-Sipandai-Kiosk: 1`, sehingga browser selalu mengirim
  preflight CORS lebih dulu dan situs lain tidak bisa memicu aksi.
- User kiosk diberi izin polkit **hanya untuk power-off**, bukan sudo.

## Pasang

Salin folder `kiosk-agent/` ke perangkat Lubuntu, lalu jalankan dengan user
yang dipakai untuk kiosk:

```bash
cd kiosk-agent
chmod +x install.sh
sudo ./install.sh --origin https://192.168.50.156
```

- `--origin` diisi alamat persis yang dibuka browser kiosk: skema, host, dan port
  bila ada, tanpa `/` di akhir. Kalau kiosk dibuka lewat nama domain, pakai nama
  domainnya. Opsi ini boleh diulang untuk beberapa alamat.
- `--user <nama>` dipakai bila user kiosk berbeda dari user yang menjalankan `sudo`.

Skrip ini memasang:

| Apa | Lokasi |
|---|---|
| `xdotool` (via apt, untuk Perkecil Browser) | paket sistem |
| Agen | `/opt/sipandai-kiosk-agent/` |
| Konfigurasi (port, origin, nama proses browser) | `/etc/sipandai-kiosk-agent.conf` |
| Service (otomatis jalan saat user kiosk login) | `/etc/systemd/user/sipandai-kiosk-agent.service` |
| Izin shutdown tanpa password | `/etc/polkit-1/rules.d/` dan `/etc/polkit-1/localauthority/50-local.d/` |
| Izin browser memanggil agen lokal | `/etc/chromium-browser/policies/managed/` (juga Chromium deb & Google Chrome) |

Setelah pemasangan, **tutup lalu buka ulang browser kiosk** agar kebijakannya
terbaca. Menu ⚙ kiosk akan menampilkan "Matikan Perangkat".

## Suara hasil scan

Kiosk mengucapkan **"Berhasil"**, **"Boarding pass sudah di scan"**, atau **"Gagal"**
setelah scan boarding pass/kartu PAS. Suaranya berupa file rekaman
(`public/sounds/scan-*.mp3`), bukan TTS bawaan browser. Ini karena Chromium di
Lubuntu umumnya tidak punya suara TTS Bahasa Indonesia.

- `install.sh` juga memasang kebijakan Chromium `AutoplayAllowlist` untuk
  origin kiosk. Dengan kebijakan ini suara tetap berbunyi walau belum ada
  klik sejak browser dibuka. Perangkat yang memasang agen **sebelum** fitur
  ini perlu menjalankan ulang `sudo ./install.sh --origin …` lalu membuka
  ulang browser. Cek di `chrome://policy` bahwa `AutoplayAllowlist` terbaca.
- Suara bisa dimatikan per perangkat di **Pengaturan → Suara feedback**.
- **Tidak ada suara:** cek volume dan output di ikon speaker panel Lubuntu
  (atau `pavucontrol`). Uji speaker dengan `speaker-test -t wav -c 2 -l 1`.
- Rekaman saat ini: suara **Selma Sita** dari ElevenLabs (voice_id
  `Q3XXAZw7SBnf6HYtNc0s`, model `eleven_multilingual_v2`), dibuat dengan akun
  berbayar agar boleh dipakai di sistem ini. Jeda awal/akhir dipotong dan
  kerasnya disamakan (rata-rata ±−16 dB).
- Membuat ulang: `ELEVENLABS_API_KEY=… npm run sounds:generate -- --voice Q3XXAZw7SBnf6HYtNc0s`
  (atau Google Cloud TTS dengan `GOOGLE_TTS_API_KEY`, lihat
  `scripts/generate-scan-sounds.mjs`). Hasil mentah perlu dipotong jedanya
  dan disamakan kerasnya seperti di atas. Bisa juga ditimpa rekaman sendiri
  dengan nama file sama. Setelah itu deploy ulang frontend.

## Cek & masalah umum

```bash
systemctl --user status sipandai-kiosk-agent
```

```bash
journalctl --user -u sipandai-kiosk-agent -e
```

- **"Matikan Perangkat" tidak muncul:**
  - Pastikan `--origin` sama persis dengan alamat di address bar.
  - Buka ulang browser.
  - Di `chrome://policy`, pastikan `LocalNetworkAccessAllowedForUrls` terbaca.
- **Browser tidak tertutup:** cek nama prosesnya dengan `ps -e | grep -i chrom`,
  lalu tambahkan ke `BROWSER_PROCESSES` di `/etc/sipandai-kiosk-agent.conf`.
  Setelah itu jalankan `systemctl --user restart sipandai-kiosk-agent`.
- **"Perkecil Browser" tidak muncul:** cek `command -v xdotool` dan
  `echo $XDG_SESSION_TYPE` (harus `x11`). Bila xdotool baru dipasang, jalankan
  `systemctl --user restart sipandai-kiosk-agent`.
- **Perkecil tidak berefek:** cek kelas jendela dengan `xdotool search --class chrom`.
  Bila kosong, sesuaikan `BROWSER_WINDOW_CLASS` di `/etc/sipandai-kiosk-agent.conf`.
- **Shutdown meminta password:** pastikan file polkit terpasang dan user kiosk
  sesuai dengan `--user`.

## Hapus

```bash
sudo ./install.sh --uninstall
```

## Port lain

Bila port 47800 bentrok, pasang dengan `--port <angka>`. Lalu build frontend
dengan `NEXT_PUBLIC_KIOSK_AGENT_URL=http://127.0.0.1:<angka>`.
