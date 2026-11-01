#!/usr/bin/env bash
# Pemasang SIPANDAI Kiosk Agent untuk perangkat kiosk Lubuntu.
#
# Pakai (jalankan dari folder kiosk-agent, sebagai root):
#   sudo ./install.sh --origin https://192.168.50.156 [--origin https://domain-lain] [--user kiosk]
#   sudo ./install.sh --uninstall [--user kiosk]
#
#   --origin   Alamat web SIPANDAI yang boleh memanggil agen (skema+host[:port],
#              tanpa garis miring di akhir). Boleh diulang. Wajib saat install.
#   --user     User Lubuntu yang menjalankan kiosk (default: user pemanggil sudo).
#   --port     Port agen (default 47800). Ganti juga NEXT_PUBLIC_KIOSK_AGENT_URL.
set -euo pipefail

APP=sipandai-kiosk-agent
INSTALL_DIR=/opt/$APP
CONF=/etc/$APP.conf
UNIT=/etc/systemd/user/$APP.service
POLKIT_RULE=/etc/polkit-1/rules.d/50-$APP.rules
POLKIT_PKLA=/etc/polkit-1/localauthority/50-local.d/50-$APP.pkla
POLICY_NAME=sipandai-kiosk.json
POLICY_DIRS=(
  /etc/chromium/policies/managed          # Chromium (deb)
  /etc/chromium-browser/policies/managed  # Chromium snap (Ubuntu/Lubuntu)
  /etc/opt/chrome/policies/managed        # Google Chrome
)

ORIGINS=()
KIOSK_USER="${SUDO_USER:-}"
PORT=47800
UNINSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --origin) ORIGINS+=("${2%/}"); shift 2 ;;
    --user) KIOSK_USER="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "Argumen tidak dikenal: $1" >&2; exit 1 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "Jalankan dengan sudo." >&2; exit 1; }
[[ -n "$KIOSK_USER" ]] || { echo "Tentukan --user <user kiosk>." >&2; exit 1; }
id "$KIOSK_USER" >/dev/null 2>&1 || { echo "User '$KIOSK_USER' tidak ada." >&2; exit 1; }

as_user_systemctl() {
  # Kelola service milik user kiosk (butuh systemd >= 248 untuk --machine=user@).
  systemctl --user --machine="$KIOSK_USER@" "$@" 2>/dev/null || return 1
}

if [[ $UNINSTALL -eq 1 ]]; then
  as_user_systemctl stop "$APP.service" || true
  systemctl --global disable "$APP.service" 2>/dev/null || true
  rm -f "$UNIT" "$CONF" "$POLKIT_RULE" "$POLKIT_PKLA"
  for d in "${POLICY_DIRS[@]}"; do rm -f "$d/$POLICY_NAME"; done
  rm -rf "$INSTALL_DIR"
  echo "Agen dihapus."
  exit 0
fi

[[ ${#ORIGINS[@]} -gt 0 ]] || { echo "Minimal satu --origin wajib diisi." >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 tidak ditemukan." >&2; exit 1; }

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "→ Pastikan xdotool terpasang (untuk tombol Perkecil Browser)"
if ! command -v xdotool >/dev/null; then
  if ! { apt-get update -qq && apt-get install -y -qq xdotool; }; then
    echo "! Gagal memasang xdotool — tombol Perkecil Browser tidak akan muncul."
    echo "  Pasang manual nanti: sudo apt install xdotool, lalu restart agen."
  fi
fi

echo "→ Pasang agen ke $INSTALL_DIR"
install -d -m 755 "$INSTALL_DIR"
install -m 755 "$SRC_DIR/$APP.py" "$INSTALL_DIR/$APP.py"

echo "→ Tulis konfigurasi $CONF"
cat > "$CONF" <<EOF
# SIPANDAI Kiosk Agent — dibuat oleh install.sh
PORT=$PORT
ALLOWED_ORIGINS=${ORIGINS[*]}
BROWSER_PROCESSES=chromium chromium-browser chrome google-chrome firefox
BROWSER_WINDOW_CLASS=chromium|chrome
EOF
chmod 644 "$CONF"

echo "→ Service systemd (user: $KIOSK_USER)"
cat > "$UNIT" <<EOF
[Unit]
Description=SIPANDAI Kiosk Agent (tutup browser & shutdown dari layar kiosk)
ConditionUser=$KIOSK_USER

[Service]
ExecStart=/usr/bin/python3 $INSTALL_DIR/$APP.py
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
systemctl --global enable "$APP.service"

echo "→ Izin shutdown tanpa password untuk '$KIOSK_USER' (polkit)"
# polkit >= 0.106 (Lubuntu 23.10+): aturan JavaScript
install -d -m 755 "$(dirname "$POLKIT_RULE")"
cat > "$POLKIT_RULE" <<EOF
// SIPANDAI Kiosk Agent — user kiosk boleh mematikan perangkat tanpa password.
polkit.addRule(function (action, subject) {
  if ((action.id == "org.freedesktop.login1.power-off" ||
       action.id == "org.freedesktop.login1.power-off-multiple-sessions" ||
       action.id == "org.freedesktop.login1.power-off-ignore-inhibit") &&
      subject.user == "$KIOSK_USER") {
    return polkit.Result.YES;
  }
});
EOF
# polkit 0.105 (Lubuntu 22.04): format .pkla
install -d -m 755 "$(dirname "$POLKIT_PKLA")"
cat > "$POLKIT_PKLA" <<EOF
[SIPANDAI kiosk poweroff]
Identity=unix-user:$KIOSK_USER
Action=org.freedesktop.login1.power-off;org.freedesktop.login1.power-off-multiple-sessions;org.freedesktop.login1.power-off-ignore-inhibit
ResultAny=yes
ResultInactive=yes
ResultActive=yes
EOF

echo "→ Kebijakan browser: izinkan halaman SIPANDAI mengakses agen lokal"
ORIGINS_JSON=$(printf '"%s",' "${ORIGINS[@]}"); ORIGINS_JSON="[${ORIGINS_JSON%,}]"
for d in "${POLICY_DIRS[@]}"; do
  install -d -m 755 "$d"
  cat > "$d/$POLICY_NAME" <<EOF
{
  "LocalNetworkAccessAllowedForUrls": $ORIGINS_JSON
}
EOF
  chmod 644 "$d/$POLICY_NAME"
done

echo "→ Menjalankan agen"
if as_user_systemctl daemon-reload && as_user_systemctl restart "$APP.service"; then
  sleep 1
  ORIGIN0="${ORIGINS[0]}"
  if python3 - "$PORT" "$ORIGIN0" >/dev/null 2>&1 <<'PY'
import sys, urllib.request
req = urllib.request.Request(
    f"http://127.0.0.1:{sys.argv[1]}/health",
    headers={"Origin": sys.argv[2], "X-Sipandai-Kiosk": "1"},
)
urllib.request.urlopen(req, timeout=3)
PY
  then
    echo "✓ Agen aktif di 127.0.0.1:$PORT"
  else
    echo "! Agen belum menjawab. Cek: journalctl --user -u $APP -e (sebagai $KIOSK_USER)"
  fi
else
  echo "! Tidak bisa menyalakan service untuk $KIOSK_USER sekarang — logout/login ulang user tersebut."
fi

cat <<EOF

Selesai. Langkah berikutnya:
  1. Tutup lalu buka ulang browser kiosk (supaya kebijakan browser terbaca).
  2. Buka kiosk SIPANDAI → menu ⚙ akan menampilkan "Matikan Perangkat".
EOF
