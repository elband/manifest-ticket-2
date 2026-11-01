#!/usr/bin/env python3
"""
SIPANDAI Kiosk Agent — jembatan kecil antara halaman kiosk (browser) dan
perangkat Lubuntu, untuk aksi yang tidak boleh dilakukan halaman web sendiri:

  POST /close-browser  → tutup browser (pkill proses browser)
  POST /minimize-browser → perkecil jendela browser (xdotool, sesi X11)
  POST /shutdown       → matikan perangkat (systemctl poweroff, via polkit)
  GET  /health         → cek agen hidup (dipakai kiosk untuk menampilkan tombol)

Keamanan:
  - Hanya listen di 127.0.0.1 (tidak bisa diakses dari jaringan).
  - Hanya menerima request dengan header Origin yang ada di ALLOWED_ORIGINS
    (browser tidak bisa memalsukan Origin). Request tanpa Origin ditolak.
  - Wajib header X-Sipandai-Kiosk → browser selalu mengirim preflight CORS
    lebih dulu, jadi situs lain tidak bisa "menembak" aksi tanpa izin.

Konfigurasi: /etc/sipandai-kiosk-agent.conf (format KEY=VALUE), dibuat oleh
install.sh. Hanya pakai pustaka standar Python 3 (bawaan Lubuntu).
"""

import json
import os
import shutil
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "1.1.0"
CONFIG_PATH = os.environ.get("SIPANDAI_AGENT_CONFIG", "/etc/sipandai-kiosk-agent.conf")
REQUIRED_HEADER = "X-Sipandai-Kiosk"


def load_config():
    cfg = {
        "PORT": "47800",
        "ALLOWED_ORIGINS": "",
        "BROWSER_PROCESSES": "chromium chromium-browser chrome google-chrome firefox",
        # Regex kelas jendela (xdotool, tidak peka huruf besar/kecil).
        "BROWSER_WINDOW_CLASS": "chromium|chrome",
    }
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                cfg[key.strip()] = value.strip().strip('"').strip("'")
    except FileNotFoundError:
        print(f"[agent] config {CONFIG_PATH} tidak ada, pakai default", file=sys.stderr)
    origins = {o.rstrip("/") for o in cfg["ALLOWED_ORIGINS"].split() if o}
    return {
        "port": int(cfg["PORT"]),
        "origins": origins,
        "browsers": cfg["BROWSER_PROCESSES"].split(),
        "window_class": cfg["BROWSER_WINDOW_CLASS"],
    }


CONFIG = load_config()


def _run(cmd):
    try:
        subprocess.run(cmd, check=False)
    except OSError as e:
        print(f"[agent] gagal menjalankan {cmd[0]}: {e}", file=sys.stderr)


def close_browser():
    for name in CONFIG["browsers"]:
        # -x: cocokkan nama proses persis; SIGTERM = Chromium menutup dengan rapi.
        _run(["pkill", "-TERM", "-x", name])


def shutdown():
    _run(["systemctl", "poweroff"])


def _x_env():
    # Service systemd --user tidak selalu mewarisi DISPLAY dari sesi grafis.
    env = dict(os.environ)
    env.setdefault("DISPLAY", ":0")
    xauth = os.path.expanduser("~/.Xauthority")
    if "XAUTHORITY" not in env and os.path.exists(xauth):
        env["XAUTHORITY"] = xauth
    return env


def can_minimize():
    # xdotool hanya bekerja di X11 (bawaan Lubuntu), tidak di Wayland.
    return bool(shutil.which("xdotool")) and os.environ.get("XDG_SESSION_TYPE") != "wayland"


def minimize_browser():
    try:
        r = subprocess.run(
            ["xdotool", "search", "--onlyvisible", "--class", CONFIG["window_class"],
             "windowminimize", "%@"],
            env=_x_env(), check=False, capture_output=True, timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        print(f"[agent] gagal minimize: {e}", file=sys.stderr)
        return False
    if r.returncode != 0:
        print(f"[agent] xdotool exit {r.returncode}: {r.stderr.decode(errors='replace').strip()}", file=sys.stderr)
    return r.returncode == 0


# Aksi yang dijalankan SETELAH respons dikirim (browser/perangkat akan mati).
DEFERRED_ACTIONS = {
    "/close-browser": close_browser,
    "/shutdown": shutdown,
}
# Aksi langsung — hasilnya dilaporkan ke halaman.
SYNC_ACTIONS = {
    "/minimize-browser": (minimize_browser, can_minimize),
}


def available_actions():
    names = list(DEFERRED_ACTIONS)
    names += [path for path, (_, ok) in SYNC_ACTIONS.items() if ok()]
    return sorted(names)


class Handler(BaseHTTPRequestHandler):
    server_version = f"SipandaiKioskAgent/{VERSION}"

    # ── util ──
    def _origin_allowed(self):
        origin = (self.headers.get("Origin") or "").rstrip("/")
        return origin if origin and origin in CONFIG["origins"] else None

    def _send(self, status, body=None, origin=None):
        data = json.dumps(body or {}).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):  # ringkas ke journal
        sys.stderr.write("[agent] %s %s\n" % (self.address_string(), fmt % args))

    # ── CORS preflight ──
    def do_OPTIONS(self):
        origin = self._origin_allowed()
        if not origin:
            self._send(403, {"error": "origin tidak diizinkan"})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", f"Content-Type, {REQUIRED_HEADER}")
        # Private Network Access / Local Network Access (halaman HTTPS → 127.0.0.1)
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _guard(self):
        origin = self._origin_allowed()
        if not origin:
            self._send(403, {"error": "origin tidak diizinkan"})
            return None
        if self.headers.get(REQUIRED_HEADER) != "1":
            self._send(400, {"error": f"header {REQUIRED_HEADER} wajib"}, origin)
            return None
        return origin

    def do_GET(self):
        origin = self._guard()
        if not origin:
            return
        if self.path == "/health":
            self._send(200, {"ok": True, "version": VERSION, "actions": available_actions()}, origin)
        else:
            self._send(404, {"error": "tidak ditemukan"}, origin)

    def do_POST(self):
        origin = self._guard()
        if not origin:
            return
        name = self.path.lstrip("/")
        if self.path in SYNC_ACTIONS:
            fn, available = SYNC_ACTIONS[self.path]
            if not available():
                self._send(501, {"error": "aksi tidak tersedia di perangkat ini"}, origin)
                return
            ok = fn()
            self._send(200 if ok else 500, {"ok": ok, "action": name}, origin)
            return
        action = DEFERRED_ACTIONS.get(self.path)
        if not action:
            self._send(404, {"error": "tidak ditemukan"}, origin)
            return
        # Balas dulu supaya halaman sempat menerima respons, baru eksekusi.
        self._send(200, {"ok": True, "action": name}, origin)
        threading.Timer(0.5, action).start()


def main():
    if not CONFIG["origins"]:
        print("[agent] PERINGATAN: ALLOWED_ORIGINS kosong — semua request akan ditolak", file=sys.stderr)
    server = ThreadingHTTPServer(("127.0.0.1", CONFIG["port"]), Handler)
    print(
        f"[agent] v{VERSION} listen 127.0.0.1:{CONFIG['port']} origins={sorted(CONFIG['origins'])}",
        file=sys.stderr,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
