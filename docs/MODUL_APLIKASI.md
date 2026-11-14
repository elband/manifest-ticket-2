# Modul Aplikasi — Airport Flight Validation System (AFVS)

> Sistem validasi boarding pass berbasis web untuk operator gate bandara.
> Versi: 0.2.0 · Repository: `airport-flight-validation`

---

## 1. Tentang Aplikasi

**AFVS (Airport Flight Validation System)** adalah aplikasi web internal yang membantu petugas gate memvalidasi boarding pass penumpang secara cepat, akurat, dan ter-audit. Aplikasi dirancang **offline-first**: seluruh data flight, scan event, foto wajah, dan konfigurasi disimpan lokal di browser sehingga gate tetap operasional walau koneksi internet putus.

### Target Pengguna

| Role | Hak Akses |
|------|-----------|
| **Admin** | Manajemen flight, user, settings global |
| **Supervisor** | Pemantauan dashboard, analytics, audit log |
| **Security / Petugas Gate** | Scan boarding pass, lihat scan history |

### Use Case Utama

1. Petugas gate scan boarding pass penumpang sebelum boarding pesawat.
2. Aplikasi memverifikasi: flight benar, hari benar, tiket belum di-scan sebelumnya.
3. Foto wajah penumpang diambil otomatis untuk audit visual.
4. Hasil scan + foto tersimpan dan bisa di-review supervisor.

---

## 2. Arsitektur Singkat

```
┌─────────────────────────────────────────────────────────────┐
│              Next.js 14 (App Router) — Frontend             │
├─────────────────────────────────────────────────────────────┤
│  React Components  ·  Tailwind CSS  ·  Lucide Icons         │
├─────────────────────────────────────────────────────────────┤
│           Lib Layer (lib/*)                                 │
│  scanService · storage · settings · auth · flightStatus     │
├─────────────────────────────────────────────────────────────┤
│  Persistence (Browser)                                       │
│  · localStorage  →  flights, scan events, settings, session │
│  · IndexedDB     →  foto wajah (Blob)                       │
└─────────────────────────────────────────────────────────────┘
```

**Offline-first dengan backend opsional.** Logic + data inti tetap di sisi klien (localStorage + IndexedDB) sehingga gate tetap operasional walau koneksi putus. Sejak v0.2 tersedia **integrasi backend NestJS + PostgreSQL** (opsional, lewat halaman `/connect`): scan event otomatis di-push ke server via outbox idempotent (offline-safe) dan jadwal penerbangan bisa di-tarik dari server. Backend bisa dimatikan tanpa mengganggu operasi lokal. Detail teknis di [BACKEND_SETUP.md](BACKEND_SETUP.md).

**Topologi pemeriksaan (deployment nyata).** Bukan banyak gate, melainkan **2 titik pemeriksaan tetap** yang datanya digabung di backend:

| # | Titik pemeriksaan | Lokasi | `station` |
|---|-------------------|--------|-----------|
| 1 | **SCP 2** | Pos Security Check Point 2, **sebelum X-ray** | `SCP2` |
| 2 | **Lounge Bluesky** | Pintu masuk lounge Bluesky | `BLUESKY` |

Tiap titik scan boarding pass independen (tetap jalan walau backend mati), lalu hasilnya disinkronkan ke server. Identitas titik dibedakan lewat field `station` pada tiap scan event.

```
   Frontend (browser)                      Backend (opsional)
   ┌─────────────────────┐   HTTPS/JSON    ┌──────────────────────┐
   │ lib/api/ (client,   │ ──────────────▶ │ NestJS + Prisma      │
   │ outbox, flightSync) │   Bearer JWT    │ PostgreSQL (Laragon) │
   └─────────────────────┘ ◀────────────── └──────────────────────┘
```

---

## 3. Daftar Modul / Halaman

| Route | Halaman | Untuk |
|-------|---------|-------|
| `/login` | Login | Semua user |
| `/onboarding` | First-run tutorial | First-time user |
| `/dashboard` | Dashboard ringkasan flight + stats | Supervisor, Admin |
| `/flights` | List flight (CRUD, status, audit) | Admin |
| `/passengers` | List penumpang (dari scan history) | Supervisor |
| `/radar` | Monitoring pesawat live (peta) sekitar Samarinda | Supervisor, Admin |
| `/scan` | Halaman scan utama (camera/USB/manual) | Security |
| `/scan/kiosk` | Mode kiosk fullscreen (monitor gate) | Security |
| `/scan-events` | Riwayat scan event + foto wajah | Supervisor, Security |
| `/admin/scans` | Monitor scan gabungan 2 pos (dari server) | Supervisor, Admin |
| `/admin/officers` | Kelola petugas AVSEC (tambah/edit/hapus + set/reset PIN) | Admin |
| `/analytics` | Grafik & analitik scan | Supervisor, Admin |
| `/connect` | Koneksi & sinkronisasi backend (login, push scan, tarik jadwal) | Supervisor, Admin |
| `/settings` | Konfigurasi user & aplikasi | Semua user (sebagian admin only) |
| `/seeders` | Generator data demo | Admin (dev only) |

---

## 4. Fitur Utama

### 4.1 Autentikasi & Session
- **Admin/Supervisor**: login email + password (lokal `localStorage`).
- **Petugas AVSEC (Security)**: login cepat via **PIN 4-6 digit**. PIN dicoba ke **backend dulu** (`POST /auth/login-pin`) → otomatis tersambung sebagai station petugas (`SCP2`/`BLUESKY`) & mengaktifkan sync; kalau backend offline, **fallback ke PIN lokal**.
- Role-based access: Admin, Supervisor, Security.
- **5 petugas seed** (PIN): `1234` Andi · `2345` Budi · `3456` Citra → **SCP 2**; `4567` Dewi · `5678` Eko → **Lounge Bluesky**.
- Session persisten sampai logout manual.

### 4.2 Manajemen Flight
- **CRUD flight**: tambah, edit, hapus, dengan field: flight number, airline code, origin/destination airport, tanggal & jam keberangkatan, gate, jumlah pax expected.
- **Status flight** (lifecycle): `DRAFT → OPEN → ACTIVE → CLOSED` atau `CANCELLED`.
- **Audit trail**: setiap perubahan status tercatat dengan timestamp + user.
- **Boarding window otomatis**: status `OPEN/ACTIVE/CLOSED` di-compute dari waktu keberangkatan dan threshold di settings (default: open 60 min sebelum, active 30 min sebelum, close 10 min sesudah).

### 4.3 Boarding Pass & Penumpang
- Parser barcode format `FLIGHT|PNR|TICKET|SEAT` (separator `|` atau `,` atau whitespace).
- **Seed boarding passes** — 25+ data dummy untuk demo (5 maskapai × 5 penumpang).
- **Passenger record** — agregasi otomatis dari scan event: nama, PNR, ticket, seat, jumlah scan, first/last scan.

### 4.4 Sistem Scan
Tiga mode input yang bisa di-switch di header `/scan`:

| Mode | Cara Pakai | Cocok Untuk |
|------|-----------|-------------|
| **Camera** | Buka webcam, deteksi QR/barcode otomatis | Phone scanner, tablet kios |
| **USB Scanner** | Field input auto-focus, scanner USB ketik string + Enter | Monitor gate + handheld scanner |
| **Manual** | Operator ketik manual | Backup saat scanner mati |

**Outcome scan:**
- `VALID_FLIGHT` — boarding pass valid, belum pernah di-scan.
- `DUPLICATE_SCAN` — tiket sudah di-scan sebelumnya.
- `FLIGHT_NOT_TODAY` — flight bukan hari ini.
- `FLIGHT_NOT_ACTIVE` — flight belum dibuka atau sudah ditutup.
- `UNKNOWN_FLIGHT` — flight number tidak ada di database.
- `INVALID_BARCODE` — format barcode tidak dikenali.

Setiap outcome memberi feedback **audio (beep berbeda)** + **suara manusia/TTS** + **haptic (getar mobile)** + **toast**. Suara TTS (Web Speech API, Bahasa Indonesia bila tersedia): VALID → ucapan **"Berhasil"** (didahului ding), DUPLICATE → "Boarding pass sudah di scan", lainnya → "Gagal". Berlaku di semua mode scan (kiosk & standar), di-gate oleh setting `soundOn`.

### 4.5 Mode Kiosk (`/scan/kiosk`)
Halaman fullscreen khusus monitor gate, tanpa navbar.

- **Layout dua panel**: webcam wajah (kiri) + scan & result (kanan).
- **USB scanner ready** — hidden input auto-focus tiap 500ms, deteksi heuristik kecepatan ketik untuk membedakan scanner vs typing manual.
- **Validasi wajah pre-scan** — scan ditolak kalau wajah tidak terdeteksi/menghadap kamera (bisa di-toggle di settings).
- **Capture wajah otomatis** — setiap scan menyimpan foto wajah dari webcam (~25KB JPEG) di IndexedDB, ter-link via `event.faceCaptureId`.
- **Boarding pass animated modal** — saat VALID, modal tampilkan tiket dengan **gradient warna maskapai**, foto wajah, dan badge "VERIFIED".
- **Auto-close 6 detik** dengan countdown bar; tombol X manual.
- **Session stats di header** — counter Valid/Duplicate/Ditolak per shift.
- **Demo scan button** — inject barcode sample untuk training operator tanpa scanner fisik.
- **Reset button** — clear stats + recent list.
- **Sound on/off chip** — toggle cepat suara feedback di header.
- **Heuristic detection notice** — banner peringatan kalau browser tidak support FaceDetector API (fallback ke deteksi skin-tone YCbCr).
- **Privacy banner** — info bahwa foto disimpan lokal, tidak dikirim ke server.

### 4.6 Riwayat Scan (`/scan-events`)
- Daftar semua scan event dengan filter status, tanggal, flight.
- Thumbnail foto wajah inline (48×48), klik untuk full size.
- Export ke **CSV** & **XLSX**.
- Auto-archive otomatis: scan event hari lampau bisa di-purge sesuai kebijakan.

### 4.7 Dashboard & Analytics
- **Dashboard** — premium stat cards (flight hari ini, scan total, success rate), hero section airport-themed.
- **Analytics** — chart distribusi scan per jam, breakdown per maskapai, top gates.

### 4.8 Settings
Disimpan di `localStorage` key `afvs.settings`:

| Setting | Default | Fungsi |
|---------|---------|--------|
| `soundOn` | true | Suara feedback per outcome |
| `hapticOn` | true | Getar mobile |
| `locale` | `id` | Bahasa (ID/EN) |
| `theme` | `airport` | Tema (airport / dark) |
| `flightListShowOnlyToday` | true | Filter list flight hari ini saja |
| `autoClosePastDayFlights` | true | Auto-CLOSE flight hari lampau |
| `boardingOpenMinutesBefore` | 60 | Window buka boarding |
| `boardingActiveMinutesBefore` | 30 | Window active boarding |
| `boardingCloseMinutesAfter` | 10 | Window tutup boarding |
| `faceCaptureEnabled` | true | Aktifkan webcam capture |
| `faceCameraDeviceId` | null | Pilih webcam (jika >1) |
| `kioskAutoEnter` | false | Auto-submit di kiosk tanpa Enter |
| `requireFaceForScan` | true | Scan ditolak kalau wajah tidak siap |
| `apiSyncEnabled` | false | Aktifkan push scan & sync ke backend AFVS |

### 4.9 Theming & Aksesibilitas
- **Dua tema**: `airport` (light, cool blue/cyan) & `dark` (midnight aviation).
- Toggle di header semua halaman.
- Token CSS variable di [globals.css](src/app/globals.css), kelas semantik di [tailwind.config.ts](tailwind.config.ts).
- Tipografi: **Poppins** dari Google Fonts.
- Icons: **lucide-react** (consistent line icons).

### 4.10 Offline Capability
- ✅ Semua data inti lokal (localStorage + IndexedDB) — gate tetap jalan tanpa internet.
- ✅ Sync backend bersifat opsional & offline-safe: kalau offline, scan masuk outbox lokal dan otomatis ter-push saat online lagi (lihat 4.13).
- ⚠️ Fitur yang butuh internet: Radar (tile peta + OpenSky) dan sinkronisasi backend.
- ⚠️ Barcode image di modal boarding pass masih fetch ke `barcodeapi.org` (bisa di-replace `bwip-js` lokal).
- ⚠️ Asset Next.js perlu di-load minimal sekali; full offline butuh setup PWA + service worker.

### 4.11 Mobile-Ready
- Layout responsif: desktop grid 3-kolom, mobile single-column dengan bottom navigation.
- Touch-friendly: button minimal 44×44px (Apple HIG).
- Komponen mobile khusus: `BottomNav`, `SegmentedControl`, `StickyActionBar`, `GroupedList`.

### 4.12 Radar Monitoring Pesawat (`/radar`)
Monitoring lalu lintas udara real-time di sekitar **Bandara APT Pranoto, Samarinda (AAP/WALS)**.
- **Peta interaktif Leaflet** (tile CartoDB; toggle terang/gelap), pan & zoom seperti FlightRadar24.
- **Ikon pesawat** berputar sesuai heading, warna per kategori; gerak halus via dead-reckoning + trail untuk yang dipilih.
- **Kategori heuristik**: Menuju Samarinda / Dari Samarinda / Melintas (estimasi dari posisi, arah, ketinggian).
- **Sumber data**: OpenSky Network (live, anonim, tanpa API key) dengan fallback **mode Demo** (simulator client-side).
- **Panel telemetri**: callsign, maskapai, altitude, ground speed, heading, vertical rate, jarak, bearing, squawk.
- Catatan: data live bisa terlambat ±30–60 dtk & tergantung jangkauan ADS-B; bukan data resmi ATC.

### 4.13 Sinkronisasi Backend (`/connect`)
Integrasi **opsional** ke backend NestJS + PostgreSQL (lihat [BACKEND_SETUP.md](BACKEND_SETUP.md)).
- **Login JWT** ke server; token disimpan di `localStorage` (`afvs.api.token`).
- **Push scan otomatis** — setiap scan masuk outbox lokal lalu di-flush ke `POST /scan-events` (idempotent by `eventId`, offline-safe, foto wajah ikut terkirim). Auto-flush tiap 20 dtk + saat online.
- **Tarik jadwal** — `GET /flights` per station/tanggal, di-merge ke data lokal.
- **Snapshot jadwal FIDS** — saat tarik FIDS di `/jadwal`, jadwal hari itu di-push ke `POST /flights/sync` (upsert idempotent by `station+flightNumber+std`) sehingga tersimpan permanen di DB sebagai riwayat per tanggal, bukan cuma di `localStorage`. Best-effort: bila offline/belum login, jadwal tetap aman di lokal.
- **Monitor antrian** — status pending/gagal + tombol flush/retry.
- **Dashboard server** (`/admin/scans`, admin/supervisor) — lihat scan **gabungan 2 pos** (SCP 2 + Lounge Bluesky) langsung dari server, lengkap foto wajah & statistik per pos.
- **Manifest penumpang per-flight** — setiap scan **VALID** otomatis tercatat sebagai penumpang penerbangan itu, **dua tempat**: lokal (`afvs.manifests`, offline-first) & backend (tabel `FlightPassenger`, di-upsert saat `POST /scan-events`). 1 penumpang = 1 baris, kunci dedup **tiket→PNR** (sama di lokal & server). Halaman detail flight menampilkan daftar + hitungan pax; bila sync aktif, muncul badge **"Server N"** (cross-check jumlah lokal vs backend). Baca via `GET /flights/:id/passengers`; backfill dari scan historis via `POST /flights/manifests/rebuild` (admin). Lihat [RANCANGAN-MANIFEST-PAX.md](RANCANGAN-MANIFEST-PAX.md).
- Di-gate oleh setting `apiSyncEnabled`; base URL dari env `NEXT_PUBLIC_AFVS_API_BASE`.

### 4.14 Kelola Petugas AVSEC (`/admin/officers`)
Manajemen petugas lewat UI (admin only) — menggantikan kebutuhan edit `seed.ts`/Prisma Studio manual untuk operasional sehari-hari.
- **CRUD petugas** — tambah, edit (nama/email/peran/pos), nonaktifkan/aktifkan, atau hapus. Email auto-generate dari nama bila dikosongkan; password login auto-acak (login utama AVSEC tetap via PIN).
- **Set/Reset PIN** — PIN bisa diisi manual (4-6 digit) atau di-generate **acak** oleh server. PIN ditampilkan **sekali** setelah dibuat/di-reset (tombol salin) lalu disimpan ter-hash (bcrypt) — tidak bisa dilihat lagi.
- **Anti-bentrok PIN** — server menolak PIN yang sudah dipakai petugas aktif lain (karena login-PIN mencocokkan PIN→petugas).
- **Audit-safe** — petugas yang sudah punya riwayat scan tidak bisa di-hard-delete (diarahkan untuk dinonaktifkan saja); admin juga tidak bisa menghapus akunnya sendiri.
- **Foto petugas** — upload/ganti/hapus foto dari form Tambah/Edit (JPEG/PNG/WebP, maks 2 MB). File disimpan di `UPLOAD_DIR/operators` dan disajikan **auth-gated** (`GET /operators/:id/photo`), bukan path publik. Avatar di grid/detail otomatis pakai foto upload (lingkaran `object-cover`); bila belum ada foto, fallback ke avatar kurasi/inisial.
- Endpoint: `GET/POST/PATCH/DELETE /operators` + `POST /operators/:id/pin` + `POST/GET/DELETE /operators/:id/photo` (semua role `admin`).

### 4.15 Rekap PAX per Maskapai (`/rekap-maskapai`)
Rekap jumlah penumpang **boarded** (scan VALID) dikelompokkan **per maskapai** (Garuda, Batik, Lion, dst.), dengan pemilih periode **Hari ini · Kemarin · Rentang** (custom `dari`–`sampai`). Hanya **penerbangan keberangkatan** (origin = bandara home `AAP`; kedatangan tidak dihitung). Jam ditampilkan sebagai **jam papan** langsung dari `std` (naif-Z, tanpa konversi timezone).
- **Kartu per maskapai** (logo + warna brand dari registry `airlines.ts`, bar proporsi, angka pax) diurut pax terbanyak; **drill-down** klik kartu → daftar penerbangan maskapai itu → klik → halaman detail flight (manifest pax).
- **Sumber data**: server bila sync aktif (`GET /flights/manifests/by-airline`, agregat `FlightPassenger`), fallback **agregasi lokal** dari `afvs.manifests`/scan events saat offline. Badge menandai sumber (Server/Lokal).
- Tanpa tabel DB baru — murni agregasi manifest per-flight (lihat [RANCANGAN-PAX-PER-MASKAPAI.md](RANCANGAN-PAX-PER-MASKAPAI.md)). Helper agregasi murni `lib/reports/byAirline.ts` (di-unit-test). Menu untuk admin/supervisor.

---

## 5. Alur Penggunaan Tipikal

### Operator Gate (per shift)
1. Login ke `/login`.
2. Buka mode kiosk di `/scan/kiosk` (fullscreen di monitor gate).
3. Colok scanner USB → badge "Scanner USB ✓" muncul.
4. Penumpang datang → wajah masuk kamera → operator scan boarding pass.
5. Modal hijau muncul (jika VALID) → boarding pass + foto + countdown 6 detik → otomatis close.
6. Untuk VALID, penumpang dipersilakan masuk; untuk DUPLICATE/REJECTED, eskalasi sesuai SOP.
7. Akhir shift: lihat stats di header, tap "Reset" untuk shift berikutnya.

### Supervisor (review)
1. Login.
2. Buka `/dashboard` — lihat ringkasan hari ini.
3. Buka `/scan-events` — review scan event + foto wajah.
4. Export CSV/XLSX untuk laporan.
5. Buka `/analytics` — lihat tren per jam/maskapai.

### Admin (setup)
1. Buka `/flights` — input flight hari ini (atau import dari sistem lain).
2. Set status flight ke `OPEN` saat siap boarding.
3. Buka `/settings` — sesuaikan threshold boarding window per gate.
4. Buat user baru untuk petugas baru.

---

## 6. Struktur Direktori

```
src/
├── app/                      # Routes (Next.js App Router)
│   ├── analytics/
│   ├── dashboard/
│   ├── flights/
│   ├── login/
│   ├── onboarding/
│   ├── passengers/
│   ├── radar/                # Monitoring pesawat live (Leaflet + OpenSky)
│   ├── rekap-maskapai/       # Rekap PAX per maskapai (harian/rentang, drill-down)
│   ├── connect/             # Koneksi & sinkronisasi backend
│   ├── admin/
│   │   ├── scans/           # Dashboard scan server (gabungan 2 pos)
│   │   └── officers/        # Kelola petugas AVSEC (CRUD + set/reset PIN + foto)
│   ├── scan/
│   │   ├── kiosk/page.tsx    # Mode kiosk fullscreen
│   │   └── page.tsx          # Scan standard
│   ├── scan-events/
│   ├── seeders/              # Demo data generator (boarding pass dari jadwal)
│   ├── settings/
│   ├── error.tsx             # Error boundary per-route (lapor Sentry)
│   └── global-error.tsx      # Error boundary root layout
├── components/
│   ├── dashboard/            # AirportHero, PremiumStatCard
│   ├── flights/              # SeatMap, PassengerDetailModal
│   ├── layout/               # AppShell, BottomNav, PageHero
│   ├── mobile/               # Mobile-specific components
│   ├── print/                # Print-friendly views
│   ├── providers/            # React context providers
│   ├── scan/                 # CameraScanner, FaceCaptureCamera, FaceThumb
│   └── ui/                   # Base components (Button, Modal, Toast, etc.)
└── lib/
    ├── api/                  # Client backend: client.ts, outbox.ts, flightSync.ts
    ├── barcode.ts            # Parser barcode MURNI (BCBP + pipe) — di-unit-test
    ├── radarService.ts       # Fetch OpenSky + simulator demo + geo helpers
    ├── airlines.ts           # Registry maskapai + warna brand
    ├── audit.ts              # Audit log helpers
    ├── auth.ts               # Login & session
    ├── boarding.ts           # Logic boarding window
    ├── csvExport.ts          # Export CSV
    ├── facePhotoStore.ts     # IndexedDB wrapper untuk foto
    ├── flightStatus.ts       # State machine flight
    ├── flightSweeper.ts      # Auto-close past flights
    ├── manifest.ts           # Kunci dedup pax tiket→PNR (cermin backend/common/manifest.ts)
    ├── reports/byAirline.ts  # Agregasi rekap PAX per maskapai (murni, di-unit-test)
    ├── i18n.ts + useT.ts     # Translation
    ├── mockData.ts           # Seed flights
    ├── scanService.ts        # Core logic scan + face capture
    ├── seedBoardingPasses.ts # Seed boarding pass sample (statis)
    ├── generateBoardingPasses.ts # Generate boarding pass dari jadwal (10/flight)
    ├── settings.ts           # App settings (localStorage)
    ├── storage.ts            # localStorage wrapper
    ├── theme.ts              # Theme switcher
    ├── types.ts              # TypeScript types
    ├── useCountUp.ts         # Animation hook
    ├── utils.ts              # cn() classname merger
    └── xlsxExport.ts         # Export XLSX
```

---

## 7. Stack Teknis

| Kategori | Teknologi |
|----------|-----------|
| Framework | Next.js 14 (App Router) |
| Bahasa | TypeScript |
| UI | React 18 |
| Styling | Tailwind CSS + CSS variables |
| Icons | lucide-react |
| Font | Poppins (Google Fonts) |
| State | React hooks (no Redux/Zustand) |
| Persistence (klien) | localStorage + IndexedDB |
| Peta / Radar | Leaflet + tile CartoDB + OpenSky Network API |
| Scanner Lib | Native `BarcodeDetector` + Web FaceDetector API |
| Audio/Voice | Web Audio API + Web Speech API (TTS) |
| Backend (opsional) | NestJS 10 + Prisma + **MySQL** (Laragon dev, `prisma db push`) · JWT auth |
| Build | npm / Next.js compiler |
| Dev Server | `npm run dev:https` (HTTPS untuk getUserMedia di non-localhost) |
| Testing | **Vitest** (frontend, 21 test) + **Jest** (backend NestJS, 12 test) |
| CI | **GitHub Actions** (`.github/workflows/ci.yml`): lint·typecheck·test·build (FE) + typecheck·test (BE) |
| Observability | **Sentry** env-gated (`@sentry/nextjs` + `@sentry/node`) + error boundaries + global exception filter |

---

## 7b. Catatan Rilis v0.4

Ringkasan perubahan terbaru (lihat git log untuk detail):

- **Redesign Kelola Petugas** (`/admin/officers`) — dari list jadi **grid card premium**:
  hero + 4 stat card + search & 3 filter (status/area/posisi); komponen `StaffAvatar`,
  `OfficerCard`, `StatCard`, `FilterSelect`, `OfficerDetail` (modal detail beranimasi).
  - **Avatar** = foto bundar `object-cover` dalam frame gradient + **cincin gradient
    berputar** (`animate-spin-ring`) + dot status. Foto di `public/petugas/` (mapping
    `AVATAR_BY_EMAIL`); fallback inisial bila foto tak ada. Spesifikasi foto: lihat
    `public/petugas/README.md` (PNG, 1:1, 600×600).
  - _Catatan teknis:_ varian efek 3D pop-out/tilt sempat dicoba tetapi di-rollback
    karena `transform-style: preserve-3d` + `overflow-hidden` merusak layering di
    sebagian render. Versi `object-cover` dipilih karena robust.
  - **Upload foto petugas per-akun** — kolom `Operator.photoPath` + endpoint
    `POST/GET/DELETE /operators/:id/photo` (multipart, JPEG/PNG/WebP maks 2 MB,
    disimpan di `UPLOAD_DIR/operators`, disajikan **auth-gated**). Form Tambah/Edit
    punya pemilih foto + pratinjau + hapus; `StaffAvatar` pakai foto upload bila ada
    (`getOperatorPhotoObjectUrl`), jika tidak fallback ke mapping `AVATAR_BY_EMAIL`/inisial.
    Foto ikut terhapus saat petugas di-hard-delete.
- **Snapshot jadwal FIDS → DB** — `POST /flights/sync` (upsert idempotent by
  `station+flightNumber+std`); tarik FIDS kini menyimpan jadwal harian sebagai riwayat.
- **Keamanan PIN** — PIN bisa dipilih sendiri saat create/reset + guard tolak PIN lemah
  (angka sama/berurutan), di backend (`assertPinStrong`) & UI.
- **Seeder boarding pass dari jadwal** — `generateBoardingPasses.ts`: 10 boarding pass
  per penerbangan (deterministik, payload scannable). Seeder page filter maskapai +
  dropdown penerbangan + muat ulang.
- **Kestabilan & kualitas:**
  - React **error boundaries** (`app/error.tsx`, `app/global-error.tsx`).
  - **ESLint** (`next/core-web-vitals`) + CI menjalankan lint·typecheck·test·build.
  - **Unit test**: Vitest (FE: barcode, generateBoardingPasses, boarding) + Jest
    (BE: guard PIN, flights bulkUpsert). Parser barcode dipisah ke `lib/barcode.ts`.
  - **GitHub Actions CI** (`.github/workflows/ci.yml`).
- **Observability — Sentry (env-gated):** `@sentry/nextjs` (config client/server/edge +
  `instrumentation.ts`) & `@sentry/node` (`instrument.ts`). **Global exception filter**
  NestJS (`AllExceptionsFilter`) — format error konsisten + lapor 5xx. Aktif begitu
  `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` diisi (lihat `.env.local.example` &
  `backend/.env.example`).

---

## 8. Roadmap (Future Enhancements)

- [x] Backend sync (REST API NestJS + PostgreSQL) untuk **2 titik pemeriksaan** (SCP 2 sebelum X-ray & Lounge Bluesky) — ✅ v0.2 (`/connect`)
- [x] Radar monitoring pesawat (Leaflet + OpenSky) — ✅ v0.2 (`/radar`)
- [x] Voice feedback "Berhasil" (TTS) di semua mode scan — ✅ v0.2
- [x] Dashboard admin gabungan **2 titik pemeriksaan** (SCP 2 & Lounge Bluesky) (`/admin/scans`) baca dari backend — ✅ v0.2
- [x] Kelola petugas AVSEC via UI (CRUD + set/reset PIN acak) (`/admin/officers`) — ✅ v0.3
- [ ] Service worker → full offline PWA
- [ ] Replace barcode CDN dengan `bwip-js` lokal
- [ ] Active flight panel di kiosk header
- [ ] Persistent shift stats (sessionStorage)
- [ ] Confirm dialog untuk Reset
- [ ] Idle warning (no scan > 5 min)
- [ ] Visible manual input toggle di kiosk
- [ ] Background sync foto wajah → S3
- [ ] Multi-language: tambah EN content
- [ ] WCAG AA audit & screen reader test

---

## 9. Glosari

| Istilah | Arti |
|---------|------|
| **AFVS** | Airport Flight Validation System (nama aplikasi) |
| **PNR** | Passenger Name Record (kode booking) |
| **Boarding window** | Rentang waktu di mana flight terbuka untuk boarding |
| **Kiosk mode** | Mode fullscreen untuk monitor gate, tanpa nav |
| **Face capture** | Foto wajah otomatis saat scan, untuk audit visual |
| **Heuristic detection** | Deteksi wajah fallback berbasis warna kulit YCbCr (saat FaceDetector API tidak tersedia) |
| **Duplicate scan** | Tiket yang sudah pernah di-scan sebelumnya |
| **Gate** | Pintu boarding penumpang di terminal |
