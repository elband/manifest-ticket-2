# Deploy AFVS NestJS Backend di Proxmox VM Ubuntu

> ⚠️ **Baca dulu §0 (Hardening wajib).** Audit kode sudah menutup celah tingkat aplikasi
> (lihat [AUDIT-KEAMANAN.md](AUDIT-KEAMANAN.md)). Yang TERSISA untuk "aman di bandara"
> adalah lapisan **infra & kebijakan** di bawah — tanpa ini, JANGAN menangani data penumpang riil.

## 0. Hardening keamanan WAJIB (peta ke audit)

Checklist go-live yang harus dipenuhi di server (bukan di kode):

- [ ] **F-09 — HTTPS/TLS end-to-end.** Terminasi TLS di Nginx (§6, Certbot). Paksa redirect 80→443. Tanpa ini, JWT + foto wajah + PII lewat jaringan **cleartext**. HSTS sudah aktif dari helmet.
- [ ] **F-03 — `NODE_ENV=production` + DB user non-root.** Set di `.env` (§4). Backend kini **gagal-cepat** bila prod tapi `CORS_ORIGIN=localhost` atau `DATABASE_URL` pakai `root` — jadi konfig lemah tak akan boot.
- [ ] **F-01 — Secret kuat.** `JWT_SECRET` & `PIN_LOOKUP_SECRET` masing-masing ≥32 char acak (`openssl rand -base64 48`). Disimpan hanya di `.env` server / secret manager, JANGAN di git.
- [ ] **F-06 — Enkripsi at-rest + retensi.** Retensi foto wajah **sudah otomatis** via `FACE_RETENTION_DAYS` (default 30). Tambahkan **enkripsi disk** untuk volume DB & `uploads/` (LUKS / encrypted dataset) — lihat §3a.
- [ ] **F-04 — Tanpa akun demo.** Dengan `NODE_ENV=production`, `prisma/seed.ts` **otomatis melewati** akun/PIN demo (kecuali `SEED_ALLOW_DEMO=true`). Seed hanya membuat admin awal dari `SEED_ADMIN_*` dan **menolak jalan** bila `SEED_ADMIN_PASSWORD` < 12 karakter atau masih nilai contoh. Wajib-ganti-password saat login pertama belum ada.
- [ ] **PDP (hukum):** dasar pemrosesan + pemberitahuan/persetujuan penumpang + penanggung jawab (DPO). Libatkan tim hukum sebelum go-live.

> **Catatan DB:** provider = **MySQL** (sesuai `prisma/schema.prisma`). Skema diterapkan via `prisma db push`. Folder `prisma/migrations/` lama bersintaks Postgres & **tidak dipakai** — abaikan/hapus saja; **jangan** jalankan `migrate deploy`.

## 1. Provisioning Proxmox VM

Spec untuk 1-5 gate (~10k scan/hari + MySQL):

- 4 vCPU
- 4 GB RAM
- 40 GB disk SSD
- Ubuntu Server 22.04 LTS
- Network bridge: `vmbr0`
- Static IP (mis. `192.168.1.51`)

SSH masuk sebagai user non-root (tambah ke `sudo`).

## 2. Install Node.js 20 LTS + MySQL + Nginx + UFW

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl ca-certificates gnupg ufw nginx certbot python3-certbot-nginx mysql-server

# Node 20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # v20.x
sudo npm i -g pnpm pm2
```

## 3. Setup MySQL

```bash
sudo apt install -y mysql-server
sudo mysql_secure_installation   # set root password, hapus akun anonim, dll
sudo mysql <<'SQL'
CREATE DATABASE afvs CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- F-03: user khusus berhak MINIMAL, BUKAN root, bind ke localhost.
CREATE USER 'afvs_app'@'localhost' IDENTIFIED BY 'GANTI_PASSWORD_KUAT';
GRANT SELECT, INSERT, UPDATE, DELETE ON afvs.* TO 'afvs_app'@'localhost';
FLUSH PRIVILEGES;
SQL
```

`DATABASE_URL="mysql://afvs_app:GANTI_PASSWORD_KUAT@127.0.0.1:3306/afvs"`. Terapkan skema: `npx prisma db push` (skema MySQL, history migration lama Postgres diabaikan). Pastikan MySQL hanya listen `127.0.0.1` (`bind-address = 127.0.0.1` di `/etc/mysql/mysql.conf.d/mysqld.cnf`).

## 3a. Enkripsi data at-rest (F-06)

Data biometrik (foto wajah) & PII wajib terenkripsi di disk:

- **Termudah:** taruh `uploads/` + direktori data DB pada **volume terenkripsi LUKS** (atau dataset ZFS/`fscrypt` ber-enkripsi), kunci di-unlock saat boot.
- Alternatif: enkripsi tabel/kolom di DB (TDE) atau object-storage terenkripsi (mis. MinIO/S3 SSE) untuk foto.
- Pastikan **backup juga terenkripsi** (lihat §8) — jangan simpan dump polos.

## 4. Deploy aplikasi

```bash
# Sebagai user app (bukan root)
sudo useradd -m -s /bin/bash afvs
sudo su - afvs
git clone <repo-url> ~/manifest-ticket-2
cd ~/manifest-ticket-2/backend
cp .env.production.example .env
nano .env       # WAJIB: NODE_ENV=production, DATABASE_URL (user non-root),
                # JWT_SECRET & PIN_LOOKUP_SECRET (masing-masing >=32 char acak),
                # CORS_ORIGIN=domain frontend HTTPS, FACE_RETENTION_DAYS, SEED_ADMIN_*

# Generate secret acak:  openssl rand -base64 48

pnpm install --frozen-lockfile
npx prisma generate
npx prisma db push          # terapkan skema (MySQL; history migration lama stale)
npx ts-node prisma/seed.ts  # F-04: dgn NODE_ENV=production hanya admin awal (SEED_ADMIN_*) yg dibuat
                            # login admin: /login → tab Email & Password

pnpm run build
```

> Backend akan **menolak boot** (F-03) bila `NODE_ENV=production` tapi `CORS_ORIGIN` localhost/kosong atau `DATABASE_URL` memakai `root` — ini sengaja, agar konfigurasi lemah ketahuan di awal.

## 5. systemd via PM2

```bash
# Sebagai user afvs
pm2 start dist/main.js --name afvs-backend --time
pm2 save

# Sebagai sudo, generate systemd startup
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u afvs --hp /home/afvs
sudo systemctl enable pm2-afvs
```

Cek: `pm2 status` & `pm2 logs afvs-backend`.

## 6. Nginx reverse proxy + Let's Encrypt

`/etc/nginx/sites-available/afvs`:

```nginx
server {
  listen 80;
  server_name api.afvs.example.com;

  client_max_body_size 4m;

  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 30s;
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/afvs /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.afvs.example.com   # auto HTTPS
```

LAN-only? Skip Let's Encrypt, generate self-signed cert + install di tiap klien.

### 6a. Satu host: frontend + backend (layout server produksi)

Bila Next.js (:3000) & NestJS (:3001) dilayani dari host yang sama, `/api/`
diarahkan ke NestJS — **kecuali `/api/jadwal/`**, yang merupakan route Next.js
(proxy FIDS, [route.ts](../src/app/api/jadwal/[jenis]/route.ts)). Tanpa blok
`location /api/jadwal/`, permintaan jadwal ikut ke NestJS dan dijawab
`404 Cannot GET /api/jadwal/keberangkatan` → jadwal FIDS tak pernah tertarik.

```nginx
server {
  listen 80 default_server;
  server_name _;

  client_max_body_size 4m;

  # Proxy jadwal FIDS = route Next.js. Prefix lebih panjang menang atas /api/.
  location /api/jadwal/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;   # menarik banyak halaman FIDS (12 dtk/halaman)
  }

  location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 30s;
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Cek setelah reload — keduanya harus `200`:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://<server>/api/health
curl -s -o /dev/null -w "%{http_code}\n" http://<server>/api/jadwal/keberangkatan
```

Server juga harus bisa menjangkau FIDS (`FIDS_BASE_URL`, default
`http://103.210.122.2`) dari sisi Next.js.

## 7. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

## 8. Backup harian

`/etc/cron.daily/afvs-backup`:

```bash
#!/bin/bash
set -e
DATE=$(date +%F)
DEST=/var/backups/afvs
mkdir -p "$DEST"

# MySQL dump (cron jalan sbg root → auth socket, tanpa password di skrip)
mysqldump --single-transaction --routines afvs | gzip > "$DEST/afvs-${DATE}.sql.gz"

# Upload folder (foto)
tar -czf "$DEST/uploads-${DATE}.tar.gz" -C /home/afvs/manifest-ticket-2/backend uploads

# Retention 14 hari
find "$DEST" -name 'afvs-*.sql.gz' -mtime +14 -delete
find "$DEST" -name 'uploads-*.tar.gz' -mtime +14 -delete
```

> ⚠️ **F-06: enkripsi backup.** Dump di atas berisi PII + foto wajah — jangan simpan polos. Enkripsi mis. dengan `gpg`: `... | gpg --encrypt --recipient ops@bandara` , atau simpan `$DEST` pada volume terenkripsi. Pastikan kunci backup tidak satu lokasi dengan data.

```bash
sudo chmod +x /etc/cron.daily/afvs-backup
```

Snapshot VM Proxmox mingguan via Datacenter → Backup Schedule.

## 9. Konfigurasi klien Next.js

Frontend kiosk perlu env:

```bash
NEXT_PUBLIC_AFVS_API_BASE=https://api.afvs.example.com/api
```

Lalu wire-up:
- Login operator (`POST /auth/login` → simpan JWT di localStorage)
- Outbox flush ke `POST /scan-events` (multipart), idempotent by `eventId`
- Sinkronisasi flights via `GET /flights?station=...&date=YYYY-MM-DD` saat startup kiosk

## 10. Monitoring

- **Uptime/health (F-13):** poll `https://api.afvs.example.com/api/health` → `{status:"ok",db:true}` (endpoint publik, tidak ter-throttle). Pasang di UptimeRobot/monitoring internal.
- `pm2 monit` — CPU/RAM realtime
- `pm2 logs afvs-backend --lines 100`
- MySQL: `sudo mysql afvs -e "SELECT COUNT(*) FROM ScanEvent;"`
- Disk uploads: `du -sh ~/manifest-ticket-2/backend/uploads`

## Estimasi kapasitas

- Scan event row: ~1 KB
- Foto wajah JPEG (320×240): ~25 KB
- 10k scan/hari × 26 KB = ~260 MB/hari → ~7.5 GB/bulan
- Disk 40 GB cukup ~5 bulan. **Retensi foto wajah sudah otomatis** (F-06): `RetentionService` menghapus foto >`FACE_RETENTION_DAYS` (default 30) tiap 12 jam. Sesuaikan nilai env sesuai kebijakan PDP.

## Update aplikasi

```bash
cd ~/manifest-ticket-2/backend
git pull
pnpm install --frozen-lockfile
npx prisma generate
npx prisma db push
pnpm run build
pm2 restart afvs-backend
```

## Rollback cepat

PM2 simpan instance lama di memory sampai `pm2 restart`. Untuk rollback DB pakai dump `mysqldump`:

```bash
sudo mysql -e "DROP DATABASE afvs; CREATE DATABASE afvs CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
gunzip -c /var/backups/afvs/afvs-YYYY-MM-DD.sql.gz | sudo mysql afvs
```
