# AFVS Backend — Setup Brief & Cara Pakai

Backend NestJS sudah **ter-install, ter-migrate, dan ter-seed** di folder [backend/](../backend/). Dokumen ini brief apa yang sudah tersedia dan cara menggunakannya end-to-end.

## Yang sudah ter-setup

| Item                          | Status     | Detail                                                                              |
| ----------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| Dependency NestJS + Prisma    | ✅ install | `npm install` (528 packages) — Node 20 LTS                                          |
| Database                      | ✅ MySQL   | Laragon MySQL @ `127.0.0.1:3306`, DB `afvs` (`DATABASE_URL="mysql://…@127.0.0.1:3306/afvs"` di `.env`). |
| Schema DB                     | ✅ applied | Di-apply via `prisma db push` (BUKAN migration history — folder `prisma/migrations/` stale/Postgres, jangan dipakai) |
| Seed admin + operator         | ✅ seeded  | `admin@afvs.local` (admin) & `operator@afvs.local` (operator, station `CGK-T3`)     |
| JWT auth                      | ✅ aktif   | Bearer token 12 jam (`/api/auth/login`)                                             |
| RBAC                          | ✅ aktif   | Role `operator` / `supervisor` / `admin` via `@Roles()`                             |
| Endpoint flights              | ✅ uji     | GET/POST/PATCH/DELETE — tested via curl                                             |
| Endpoint scan-events          | ✅ uji     | POST idempotent by `eventId` (multipart) + GET list + GET detail                    |
| Endpoint face-photos          | ✅ aktif   | Stream JPEG `/api/face-photos/:eventId` (auth-gated)                                |
11| Manifest penumpang            | ✅ aktif   | Model `FlightPassenger`, di-upsert saat push scan VALID; `GET /flights/:id/passengers` + rebuild |
| Swagger docs                  | ✅ aktif   | `http://localhost:3001/docs` (interaktif, klik "Try it out")                        |
| Helmet + CORS + Throttler     | ✅ aktif   | Rate limit 300 req/menit per petugas (per IP bila tanpa token), CORS ke `http://localhost:3000`                         |
| Build artifact                | ✅ siap    | `backend/dist/src/main.js` (`npm run start:prod`)                                   |

## Credential seed

**Admin / Operator** (login email + password):

| Email                  | Password         | Role     | Station   |
| ---------------------- | ---------------- | -------- | --------- |
| `admin@afvs.local`     | `ChangeMe!2026`  | admin    | —         |
| `operator@afvs.local`  | `operator123`    | operator | `CGK-T3`  |

**Petugas AVSEC** (login cepat via PIN di halaman `/login`):

| Nama            | PIN    | Station   |
| --------------- | ------ | --------- |
| Andi Saputra    | `1234` | `SCP2`    |
| Budi Santoso    | `2345` | `SCP2`    |
| Citra Lestari   | `3456` | `SCP2`    |
| Dewi Anggraini  | `4567` | `BLUESKY` |
| Eko Prasetyo    | `5678` | `BLUESKY` |

> ⚠️ PIN seed di atas hanya untuk demo — **ganti sebelum produksi**. Cara termudah: login admin lalu buka **menu "Kelola Petugas" (`/admin/officers`)** untuk tambah/edit/hapus petugas & **set/reset PIN acak** lewat UI (lihat bagian _Kelola petugas via UI_ di bawah). PIN tersimpan ter-hash (bcrypt) di kolom `Operator.pinHash`.

## Endpoint ringkas

| Method | Path                          | Auth     | Keterangan                                  |
| ------ | ----------------------------- | -------- | ------------------------------------------- |
| POST   | `/api/auth/login`             | —        | Login email+password → `{token, user}`      |
| POST   | `/api/auth/login-pin`         | —        | Login cepat PIN AVSEC → `{token, user}`     |
| GET    | `/api/auth/me`                | Bearer   | Profile current user                        |
| GET    | `/api/flights`                | Bearer   | List flights (filter `station/date/status`) |
| POST   | `/api/flights`                | sup/ad   | Create flight                               |
| POST   | `/api/flights/sync`           | Bearer   | Snapshot jadwal harian (upsert massal idempotent by `station+flightNumber+std`) — dipakai saat tarik FIDS |
| PATCH  | `/api/flights/:id`            | sup/ad   | Update `status`/`std`                       |
| DELETE | `/api/flights/:id`            | admin    | Hapus flight                                |
| GET    | `/api/flights/:id/passengers` | Bearer   | Manifest penumpang flight (agregat scan VALID; scoping per-station F-05) |
| POST   | `/api/flights/manifests/rebuild` | admin | Backfill/rebuild manifest dari ScanEvent historis (idempotent; query `date` opsional) |
| GET    | `/api/flights/manifests/by-airline` | Bearer | Rekap pax per maskapai (`date` atau `from`+`to`; `detail=1` sertakan rincian penerbangan; scoping F-05) |
| GET    | `/api/operators`              | admin    | List petugas (filter `station/role/q`)      |
| POST   | `/api/operators`              | admin    | Tambah petugas → return `{operator, pin}`   |
| PATCH  | `/api/operators/:id`          | admin    | Update nama/email/role/station/active       |
| POST   | `/api/operators/:id/pin`      | admin    | Set/reset PIN — `{pin}` 4-6 digit (PIN pilihan, ditolak bila lemah) atau kosong = acak → `{pin}` |
| POST   | `/api/operators/:id/photo`    | admin    | Upload/ganti foto petugas (multipart, field `photo`; JPEG/PNG/WebP, maks 2 MB) |
| GET    | `/api/operators/:id/photo`    | admin    | Sajikan foto petugas (auth-gated)           |
| DELETE | `/api/operators/:id/photo`    | admin    | Hapus foto petugas                          |
| DELETE | `/api/operators/:id`          | admin    | Hapus petugas (blok bila punya riwayat scan)|
| POST   | `/api/scan-events`            | Bearer   | Push scan (multipart, idempotent)           |
| GET    | `/api/scan-events`            | Bearer   | List scans (filter)                         |
| GET    | `/api/scan-events/:eventId`   | Bearer   | Detail satu scan                            |
| GET    | `/api/face-photos/:eventId`   | Bearer   | Stream JPEG foto wajah                      |
| GET    | `/docs`                       | —        | Swagger UI                                  |

## Cara pakai — dev workflow

### 1. Jalankan backend

```bash
cd backend
npm run start:dev
# atau production-style:
npm run build && npm run start:prod
```

Backend listen di `http://localhost:3001`.

### 2. Buka Swagger

`http://localhost:3001/docs` — interaktif untuk test semua endpoint. Klik tombol **Authorize** kanan atas → paste `Bearer <token>` (atau cuma `<token>` — tergantung versi Swagger).

### 3. Login lewat curl

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@afvs.local","password":"ChangeMe!2026"}'
```

Response:

```json
{ "token": "eyJhbGc...", "user": { "id": "...", "role": "admin", ... } }
```

### 4. Create flight (sebagai admin)

```bash
TOKEN="<paste-token-dari-login-admin>"
curl -X POST http://localhost:3001/api/flights \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "flightNumber":"QG432",
    "airlineCode":"QG",
    "origin":"SRG",
    "destination":"CGK",
    "std":"2026-06-15T08:30:00.000Z",
    "status":"OPEN",
    "station":"CGK-T3"
  }'
```

### 5. Push scan event (sebagai operator, multipart)

```bash
OP="<paste-token-dari-login-operator>"
curl -X POST http://localhost:3001/api/scan-events \
  -H "Authorization: Bearer $OP" \
  -F "eventId=client-cuid-unik-12345" \
  -F "rawBarcode=QG432|ABC123|TKT001|7A" \
  -F "flightNumber=QG432" \
  -F "pnr=ABC123" \
  -F "ticketNumber=TKT001" \
  -F "seat=7A" \
  -F "passengerName=BUDI SANTOSO" \
  -F "resultStatus=VALID_FLIGHT" \
  -F "message=OK" \
  -F "scannedAt=2026-06-15T08:00:00.000Z" \
  -F "station=CGK-T3" \
  -F "facePhoto=@/path/ke/foto.jpg"
```

Kalau di-push lagi dengan `eventId` sama → server return record yang sama (HTTP 200), **tidak duplikat**. Inilah kontrak yang dipakai outbox client untuk safe-retry.

### 6. Lihat database

```bash
cd backend
npx prisma studio
# Buka http://localhost:5555 — UI table editor
```

## Wiring ke frontend Next.js — ✅ SUDAH DIIMPLEMENTASI (v0.2)

Frontend kini tersambung ke backend lewat halaman **`/connect`** (menu "Koneksi Backend"):

1. ✅ **Env var** — `.env.local` di root frontend:
   ```
   NEXT_PUBLIC_AFVS_API_BASE=http://localhost:3001/api
   ```
2. ✅ **Login** — form di `/connect` → JWT disimpan di `localStorage` (`afvs.api.token` + `afvs.api.user`), auto-logout pada 401.
3. ✅ **Client lib** ([src/lib/api/](../src/lib/api/)):
   - `client.ts` — fetch wrapper auto-attach Bearer token.
   - `outbox.ts` — outbox idempotent (pola [sikerenOutbox.ts](../src/lib/sikerenOutbox.ts)); tiap scan di-enqueue, flush ke `POST /scan-events` (FormData + foto wajah dari `facePhotoStore`), auto-flush tiap 20 dtk.
   - `flightSync.ts` — pull `GET /flights?station=...&date=...`, map ke tipe Flight frontend, merge ke `localStorage afvs.flights`.
   - `jadwal/flightSync.ts` — tarik jadwal dari FIDS → merge ke localStorage **dan** push snapshot ke `POST /flights/sync` (best-effort, hanya bila login) supaya jadwal jadi riwayat permanen di DB, bukan cuma di localStorage. `station`/`origin` = `AAP`, `std` naif-Z dari tanggal+jam papan.
4. ✅ **Flight sync** — tombol "Tarik jadwal" di `/connect`; tarik FIDS di `/jadwal` (auto-simpan snapshot harian ke server).
5. ⬜ **Dashboard admin** (opsional, belum) — page `/admin/scans` untuk supervisor lihat semua scan + foto + KTP dari server.

> Sync di-gate oleh setting `apiSyncEnabled` (otomatis ON setelah login di `/connect`). Aplikasi tetap berfungsi penuh offline; backend hanya menggabungkan data 2 titik pemeriksaan (SCP 2 sebelum X-ray & Lounge Bluesky).

## Operasional

### Database: MySQL (Laragon)

`backend/.env`:
```
DATABASE_URL="mysql://root:PASSWORD@127.0.0.1:3306/afvs"
```
(dev Laragon default: user `root`. **Produksi: WAJIB user khusus berhak minimal, BUKAN root** — lihat `.env.production.example`.)

Pastikan Laragon → **Start All** (MySQL listen `:3306`). Buat database `afvs` sekali (mis. via HeidiSQL/Adminer atau `CREATE DATABASE afvs;`), lalu apply skema:
```bash
cd backend
npx prisma db push        # apply schema.prisma ke MySQL (buat/ubah tabel)
npx prisma generate       # generate Prisma Client
npx ts-node prisma/seed.ts  # seed admin/operator (opsional di dev)
```
> Catatan: pakai **`prisma db push`**, BUKAN `prisma migrate` — folder `prisma/migrations/` masih Postgres & stale, `migrate dev` akan error P3019.

### Reset DB (MySQL)

```bash
cd backend
# Pastikan tidak ada `npm run start:dev` berjalan (mengunci Prisma engine .dll di Windows).
npx prisma db push --force-reset   # DROP semua tabel + re-apply schema (HATI-HATI: hapus data)
npx prisma generate
npx ts-node prisma/seed.ts         # seed ulang admin/operator
```

### Tambah operator baru

**Cara utama (operasional): lewat UI** — login admin → menu **"Kelola Petugas" (`/admin/officers`)**. Lihat bagian _Kelola petugas via UI_ di bawah.

Alternatif (dev/bulk): Prisma Studio (langkah 6 di atas) atau extend `prisma/seed.ts`. Jangan lupa hash password & PIN dengan bcrypt 10 rounds.

### Kelola petugas via UI (`/admin/officers`) — ✅ v0.3

Halaman admin untuk mengelola petugas AVSEC tanpa menyentuh DB:

- **Tambah** — isi nama (wajib), peran, pos (`SCP2`/`BLUESKY`). Email opsional (auto dari nama bila kosong); password login otomatis acak (login utama AVSEC via PIN). PIN bisa diisi manual 4-6 digit atau dikosongkan untuk **PIN acak** dari server.
- **Set/Reset PIN** — tombol kunci di tiap baris membuka dialog: admin bisa **mengetik PIN pilihan petugas** (4-6 digit, biar mudah diingat) atau pilih **"Acak otomatis"**. PIN gampang ditebak (angka sama/berurutan spt `1234`, `000000`) ditolak — penting karena login-PIN dicocokkan ke semua petugas aktif. PIN baru ditampilkan **sekali** (dengan tombol salin) lalu disimpan ter-hash — tidak bisa dilihat lagi, hanya bisa di-reset.
- **Edit / Nonaktifkan / Hapus** — ubah data, toggle aktif, atau hapus. Petugas yang punya riwayat scan **tidak bisa dihapus** (FK audit) — nonaktifkan saja. Admin tidak bisa menghapus akun sendiri.
- **Anti-bentrok PIN** — server menolak PIN yang sudah dipakai petugas aktif lain (login-PIN memetakan PIN→petugas, jadi harus unik).

Semua endpoint `/operators` butuh role **admin** (JWT dari login admin di `/connect`).

### Pindah ke SQLite (dev cepat tanpa Laragon) — opsional

Set `provider = "sqlite"` di `schema.prisma`, `DATABASE_URL="file:./dev.db"`, lalu `npx prisma db push` + seed. (Hanya untuk dev lokal; produksi tetap MySQL.)

### Deploy ke server (Ubuntu VM / on-prem)

Lihat [nestjs-deploy.md](./nestjs-deploy.md) — full step Node 20 + **MySQL** + PM2 + Nginx + Certbot (HTTPS) + backup harian.

**Dokumen produksi terkait:**
- [GO-LIVE-CHECKLIST.md](./GO-LIVE-CHECKLIST.md) — daftar periksa lengkap sebelum & saat go-live (HTTPS, secret, validasi station dengan scan asli, dll).
- [BACKUP-DB.md](./BACKUP-DB.md) — skrip backup DB + uploads (foto) & uji restore.
- [MONITORING.md](./MONITORING.md) — uptime `/api/health` + agregasi log (PM2/Sentry).

## Troubleshooting

| Gejala                                | Cek                                                      |
| ------------------------------------- | -------------------------------------------------------- |
| `Cannot find module '@prisma/client'` | `npx prisma generate` dulu                               |
| 401 di endpoint yg seharusnya OK      | Token expired (12 jam) — re-login                        |
| 403 Forbidden                         | Role tidak cukup — pakai token admin/supervisor          |
| `Unsupported image type` saat upload  | Hanya `image/jpeg`, `image/png`, `image/webp`            |
| Port 3001 bentrok                     | Ubah `PORT` di `backend/.env`                            |
| CORS error di browser                 | Tambah origin ke `CORS_ORIGIN` (comma-separated)         |

## Hasil verifikasi setup (jejak test)

Tes end-to-end (sudah dilakukan saat setup):

1. ✅ `POST /auth/login` operator → JWT 249 char
2. ✅ `POST /auth/login` admin → JWT
3. ✅ `POST /flights` (admin) → create QG432 OPEN station CGK-T3
4. ✅ `POST /scan-events` (operator, multipart) → create event + auto-resolve `flightId`
5. ✅ Re-push `eventId` sama → **idempotent**, return record existing, tidak duplikat

Backend siap dikonsumsi dari client AFVS kapanpun.
