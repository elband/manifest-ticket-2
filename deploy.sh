#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# AFVS — skrip deploy / update di server Linux (Ubuntu, lihat docs/nestjs-deploy.md)
#
# Dijalankan DI SERVER, dari root repo, sebagai user app (mis. `afvs`, bukan root):
#   ./deploy.sh                    # pull + backup + build & restart backend + frontend
#   ./deploy.sh --backend-only     # hanya backend (NestJS)
#   ./deploy.sh --frontend-only    # hanya frontend (Next.js)
#   ./deploy.sh --no-pull          # pakai kode yang sudah ada (tanpa git pull)
#   ./deploy.sh --db-push          # terapkan skema Prisma (prisma db push)
#   ./deploy.sh --seed             # jalankan prisma/seed.ts (admin awal)
#   ./deploy.sh --skip-backup      # lewati backup DB + uploads sebelum deploy
#   ./deploy.sh --help
#
# Prasyarat (sekali saja, lihat docs/nestjs-deploy.md §2–§6):
#   - Node 20 + npm, pm2 (global), MySQL, Nginx + TLS
#   - backend/.env              (salin dari backend/.env.production.example)
#   - .env.production.local     (frontend; minimal NEXT_PUBLIC_AFVS_API_BASE=https://…/api)
#
# Override via env:
#   BRANCH=main  BACKEND_PORT=3001  FRONTEND_PORT=3000
#   PM2_BACKEND=afvs-backend  PM2_FRONTEND=afvs-frontend
#   DB_ADMIN_URL=mysql://…      # dipakai HANYA untuk --db-push (user app hanya
#                               # punya SELECT/INSERT/UPDATE/DELETE → tak bisa ubah skema)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

BRANCH="${BRANCH:-main}"
BACKEND_PORT="${BACKEND_PORT:-3001}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
PM2_BACKEND="${PM2_BACKEND:-afvs-backend}"
PM2_FRONTEND="${PM2_FRONTEND:-afvs-frontend}"

DO_BACKEND=1
DO_FRONTEND=1
DO_PULL=1
DO_BACKUP=1
DO_DB_PUSH=0
DO_SEED=0

# ─── Util ────────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  C_BLUE=$'\e[34m'; C_GREEN=$'\e[32m'; C_YELLOW=$'\e[33m'; C_RED=$'\e[31m'; C_RESET=$'\e[0m'
else
  C_BLUE=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_RESET=""
fi
step() { echo; echo "${C_BLUE}==> $*${C_RESET}"; }
ok()   { echo "${C_GREEN}  ✓ $*${C_RESET}"; }
warn() { echo "${C_YELLOW}  ! $*${C_RESET}" >&2; }
die()  { echo "${C_RED}ERROR: $*${C_RESET}" >&2; exit 1; }

usage() { sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0; }

# Baca nilai KEY dari file .env (tanpa men-source seluruh file).
env_get() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  grep -E "^${key}=" "$file" | head -n1 | sed -E "s/^${key}=//; s/^[\"']//; s/[\"']\$//"
}

# Start proses pm2 bila belum ada, selain itu reload (zero-downtime bila bisa).
pm2_up() {
  local name="$1"; shift
  if pm2 describe "$name" >/dev/null 2>&1; then
    pm2 reload "$name" --update-env
  else
    # --name/--time HARUS sebelum "$@": argumen setelah `--` (mis. `-- start -p 3000`)
    # diteruskan apa adanya ke skrip, jadi opsi pm2 di belakangnya ikut tertelan.
    pm2 start --name "$name" --time "$@"
  fi
}

# Tunggu URL membalas 2xx (maks ~60 detik).
wait_http() {
  local url="$1" label="$2" i
  for i in $(seq 1 30); do
    if curl -fsS -o /dev/null --max-time 3 "$url"; then
      ok "$label OK ($url)"; return 0
    fi
    sleep 2
  done
  return 1
}

# ─── Argumen ─────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend-only)  DO_FRONTEND=0 ;;
    --frontend-only) DO_BACKEND=0 ;;
    --no-pull)       DO_PULL=0 ;;
    --skip-backup)   DO_BACKUP=0 ;;
    --db-push)       DO_DB_PUSH=1 ;;
    --seed)          DO_SEED=1 ;;
    -h|--help)       usage ;;
    *) die "opsi tidak dikenal: $1 (lihat --help)" ;;
  esac
  shift
done
(( DO_BACKEND || DO_FRONTEND )) || die "--backend-only dan --frontend-only tidak bisa dipakai bersamaan"

# ─── Kunci: cegah dua deploy berjalan bersamaan ──────────────────────────────
LOCK_FILE="${TMPDIR:-/tmp}/afvs-deploy.lock"
exec 9>"$LOCK_FILE"
flock -n 9 || die "deploy lain sedang berjalan ($LOCK_FILE)"

# ─── Preflight ───────────────────────────────────────────────────────────────
step "Preflight"
[[ "$(id -u)" -ne 0 ]] || die "jangan jalankan sebagai root — pakai user app (mis. afvs)"
for bin in git node npm npx pm2 curl; do
  command -v "$bin" >/dev/null || die "'$bin' tidak ditemukan di PATH"
done
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 20 )) || die "butuh Node >= 20 (sekarang $(node -v))"
ok "node $(node -v), npm $(npm -v), pm2 $(pm2 -v)"

if (( DO_BACKEND )); then
  BE_ENV="$BACKEND_DIR/.env"
  [[ -f "$BE_ENV" ]] || die "$BE_ENV belum ada — salin dari backend/.env.production.example"
  [[ "$(env_get "$BE_ENV" NODE_ENV)" == "production" ]] \
    || warn "backend/.env: NODE_ENV bukan 'production' (F-03)"
  [[ "$(env_get "$BE_ENV" DATABASE_URL)" != mysql://root* ]] \
    || die "backend/.env: DATABASE_URL memakai user root (F-03) — backend akan menolak boot"
  BACKEND_PORT="$(env_get "$BE_ENV" PORT)"; BACKEND_PORT="${BACKEND_PORT:-3001}"
  ok "backend/.env ada (port $BACKEND_PORT)"
fi

if (( DO_FRONTEND )); then
  # NEXT_PUBLIC_* di-bake saat build → harus tersedia SEBELUM `next build`.
  FE_ENV=""
  for f in .env.production.local .env.production .env.local; do
    [[ -f "$ROOT_DIR/$f" ]] && { FE_ENV="$ROOT_DIR/$f"; break; }
  done
  [[ -n "$FE_ENV" ]] || die "env frontend tidak ada — buat .env.production.local (lihat .env.local.example)"
  API_BASE="$(env_get "$FE_ENV" NEXT_PUBLIC_AFVS_API_BASE)"
  [[ -n "$API_BASE" ]] || die "$(basename "$FE_ENV"): NEXT_PUBLIC_AFVS_API_BASE kosong"
  [[ "$API_BASE" != *localhost* && "$API_BASE" != *127.0.0.1* ]] \
    || warn "NEXT_PUBLIC_AFVS_API_BASE masih $API_BASE — kiosk lain tak akan bisa menjangkaunya"
  [[ "$API_BASE" == https://* ]] || warn "NEXT_PUBLIC_AFVS_API_BASE bukan HTTPS (F-09)"
  [[ "$(env_get "$FE_ENV" NEXT_PUBLIC_ENABLE_TEST_FLIGHTS)" != "true" ]] \
    || warn "NEXT_PUBLIC_ENABLE_TEST_FLIGHTS=true — penerbangan uji AKTIF di build produksi"
  ok "env frontend: $(basename "$FE_ENV") → $API_BASE"
fi

# ─── Git pull ────────────────────────────────────────────────────────────────
cd "$ROOT_DIR"
PREV_COMMIT="$(git rev-parse --short HEAD)"
if (( DO_PULL )); then
  step "Update kode ($BRANCH)"
  # Abaikan file yang tidak dilacak; tolak bila ada perubahan lokal pada file terlacak.
  git diff --quiet && git diff --cached --quiet \
    || die "ada perubahan lokal di server (git status) — commit/stash dulu"
  git fetch --prune origin "$BRANCH"
  git checkout -q "$BRANCH"
  git merge --ff-only "origin/$BRANCH"
fi
NEW_COMMIT="$(git rev-parse --short HEAD)"
ok "commit $PREV_COMMIT → $NEW_COMMIT"

# ─── Backup ──────────────────────────────────────────────────────────────────
if (( DO_BACKEND && DO_BACKUP )); then
  step "Backup DB + uploads"
  if command -v mysqldump >/dev/null; then
    bash "$BACKEND_DIR/scripts/backup-db.sh"
  else
    warn "mysqldump tidak ada — backup dilewati"
  fi
fi

# ─── Backend (NestJS) ────────────────────────────────────────────────────────
if (( DO_BACKEND )); then
  step "Backend: install + build"
  cd "$BACKEND_DIR"
  npm ci --include=dev --no-audit --no-fund   # devDeps perlu untuk nest build / prisma
  npx prisma generate

  if (( DO_DB_PUSH )); then
    step "Backend: prisma db push"
    # MySQL: skema diterapkan via db push (folder migrations/ lama = Postgres, jangan dipakai).
    if [[ -n "${DB_ADMIN_URL:-}" ]]; then
      DATABASE_URL="$DB_ADMIN_URL" npx prisma db push --skip-generate
    else
      warn "DB_ADMIN_URL kosong → pakai DATABASE_URL dari .env (gagal bila user app berhak minimal)"
      npx prisma db push --skip-generate
    fi
  fi

  if (( DO_SEED )); then
    step "Backend: seed"
    npx ts-node prisma/seed.ts
  fi

  npm run build
  [[ -f dist/src/main.js ]] || die "build backend tidak menghasilkan dist/src/main.js"

  step "Backend: restart ($PM2_BACKEND)"
  pm2_up "$PM2_BACKEND" dist/src/main.js --cwd "$BACKEND_DIR"
  wait_http "http://127.0.0.1:$BACKEND_PORT/api/health" "health backend" \
    || { pm2 logs "$PM2_BACKEND" --lines 40 --nostream || true; die "backend tidak sehat setelah restart"; }
fi

# ─── Frontend (Next.js) ──────────────────────────────────────────────────────
if (( DO_FRONTEND )); then
  step "Frontend: install + build"
  cd "$ROOT_DIR"
  npm ci --include=dev --no-audit --no-fund   # postinstall menyalin aset tesseract
  NEXT_TELEMETRY_DISABLED=1 npm run build

  step "Frontend: restart ($PM2_FRONTEND)"
  pm2_up "$PM2_FRONTEND" node_modules/next/dist/bin/next --cwd "$ROOT_DIR" -- start -p "$FRONTEND_PORT"
  wait_http "http://127.0.0.1:$FRONTEND_PORT/" "frontend" \
    || { pm2 logs "$PM2_FRONTEND" --lines 40 --nostream || true; die "frontend tidak merespons setelah restart"; }
fi

pm2 save >/dev/null

step "Selesai"
ok "deploy $NEW_COMMIT sukses"
if [[ "$PREV_COMMIT" != "$NEW_COMMIT" ]]; then
  echo "  Rollback kode: git checkout $PREV_COMMIT && ./deploy.sh --no-pull --skip-backup"
fi
