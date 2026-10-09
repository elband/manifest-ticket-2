# Video Panduan SIPANDAI — Petugas Avsec Bandara A.P.T. Pranoto

Video animasi ±92 detik (1920×1080, 30 fps) untuk melatih petugas Avsec Bandar Udara
Aji Pangeran Tumenggung Pranoto memakai SIPANDAI. Scene langkah 1–7 menampilkan
**rekaman UI asli** aplikasi (login PIN, kiosk, KTP, hasil scan, riwayat), diberi zoom,
sorotan berlabel, caption karaoke, dan narasi Bahasa Indonesia. Dibuat dengan
[Remotion](https://www.remotion.dev), terpisah dari aplikasi utama.

## Alur produksi

1. `npm install`
2. Jalankan aplikasi SIPANDAI di `http://localhost:3000` (`npm run dev` di root repo).
3. `REMOTION_BROWSER="C:/Program Files/Google/Chrome/Application/chrome.exe" npm run cams`
   — membuat webcam palsu (`out/cams/*.y4m`): wajah (foto petugas yang ada di aplikasi) dan e-KTP contoh fiktif.
4. `npm run capture` — Chrome headless menjalankan alur asli (PIN `1234`, kiosk, scan, KTP-first,
   akun demo supervisor) lalu menyimpan klip ke `public/clips/` dan penanda waktu aksi ke `src/clips.json`.
   `ONLY_KTP=1 npm run capture` merekam ulang sesi KTP + supervisor saja.
5. `npm run tts` (bila naskah berubah) → `npm run stills` untuk cek cepat → `npm run render:chrome`.

Penerbangan & boarding pass yang dipakai saat rekam adalah data contoh yang disuntikkan ke
localStorage browser rekaman (tidak menyentuh data operasional).

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run studio` | Pratinjau & scrub video di browser |
| `npm run tts` | Voice-over dari `src/narration.json` (Edge TTS `id-ID-GadisNeural`) + timing per kata |
| `npm run audio` | Musik latar & SFX (sintesis, bebas royalti) |
| `npm run cams` | Webcam palsu untuk rekaman UI |
| `npm run capture` | Rekam UI asli ke `public/clips/` |
| `npm run stills` | 2 gambar per scene ke `out/stills/` |
| `npm run render` / `render:chrome` | Render MP4 ke `out/panduan-avsec.mp4` (`:chrome` jika headless-shell Remotion diblokir Windows) |

## Mengubah naskah

Edit `src/narration.json`, lalu `npm run tts`. Panjang scene, caption, dan zoom/sorotan yang
dipicu kata (`at(id, "kata")`) menyesuaikan otomatis; jika kata pemicu dihapus, scene terkait
error — ganti kata di file scene-nya. Singkatan yang dieja ditulis berspasi
(`A. P. T.`, `S. O. P.`) supaya TTS membacanya per huruf.

## Struktur

- `src/Main.tsx` — susunan scene, transisi, overlay global, audio & ducking musik.
- `src/scenes/S01…S09` — tiap scene; S02–S08 memakai `ScreenClip` (rekaman asli + zoom + sorotan).
- `src/components/ScreenClip.tsx` — bingkai monitor, keyframe fokus, sorotan berlabel.
- `src/FakeCams.tsx` — gambar webcam palsu; `scripts/capture.mjs` — skenario rekaman.

## Naskah

| # | Scene | Durasi VO | Narasi |
|---|---|---|---|
| 1 | Pembuka | 7.9 dtk | Selamat datang, petugas Avsec Bandara A. P. T. Pranoto. Ini panduan singkat aplikasi SIPANDAI. |
| 2 | Login PIN | 8.6 dtk | Masukkan PIN petugas, empat sampai enam digit, lalu tekan Masuk Petugas. Aplikasi langsung membuka mode kiosk. |
| 3 | Kiosk & Wajah | 10.3 dtk | Minta penumpang menghadap kamera. Saat muncul tanda Siap scan, wajah sudah terdeteksi, dan fotonya tersimpan otomatis ketika boarding pass di-scan. |
| 4 | Cek KTP | 12.5 dtk | Bila mode KTP aktif, dekatkan KTP ke kamera agar namanya terbaca. Anak atau bayi tanpa KTP? Tekan Tanpa KTP, lalu cek dokumennya secara visual. |
| 5 | Scan Boarding Pass | 8.9 dtk | Lalu scan boarding pass dengan scanner USB, atau ketik kodenya secara manual. Sistem langsung mencocokkan kode penerbangan. |
| 6 | Hasil Valid | 8.2 dtk | Muncul VALID dan suara Berhasil? Persilakan penumpang lewat. Layar hasil menutup sendiri dalam enam detik. |
| 7 | Duplikat & Ditolak | 16.2 dtk | Kuning berarti tiket sudah pernah dipakai. Merah berarti ditolak: bukan hari ini, penerbangan belum aktif, tidak dikenal, barcode tidak valid, atau KTP tidak cocok. Tahan penumpang, dan eskalasi sesuai S. O. P. |
| 8 | Tips Shift | 10.6 dtk | Pantau penerbangan yang sedang boarding beserta jumlah penumpangnya. Supervisor dapat memantau semua hasil scan, dan tombol Demo scan bisa dipakai untuk latihan. |
| 9 | Penutup | 6.3 dtk | SIPANDAI. Aman, cepat, tertib. Selamat bertugas! |
