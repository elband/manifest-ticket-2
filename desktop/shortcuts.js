"use strict";

/**
 * Pintasan Linux per pengguna (tanpa root):
 *  - launcher : ~/.local/share/applications/sipandai-kiosk.desktop
 *               → entri "SIPANDAI Kiosk" di menu aplikasi.
 *  - autostart: ~/.config/autostart/sipandai-kiosk.desktop
 *               → mode kiosk terbuka otomatis saat user login.
 *
 * Exec memakai AppImage bila aplikasi dijalankan dari AppImage, selain itu
 * executable yang sedang berjalan (/opt/SIPANDAI/sipandai-desktop dari .deb).
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const FILE_NAME = "sipandai-kiosk.desktop";

const DIRS = {
  launcher: path.join(os.homedir(), ".local", "share", "applications"),
  autostart: path.join(os.homedir(), ".config", "autostart"),
};

function supported() {
  return process.platform === "linux";
}

function executable() {
  return process.env.APPIMAGE || process.execPath;
}

function desktopEntry(iconPath) {
  const exec = executable().replace(/(["`$\\])/g, "\\$1");
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=SIPANDAI Kiosk",
    "Comment=Layar scan boarding pass SIPANDAI (mode kiosk)",
    `Exec="${exec}" --kiosk`,
    `Icon=${iconPath}`,
    "Terminal=false",
    "Categories=Office;",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

function filePath(kind) {
  return path.join(DIRS[kind], FILE_NAME);
}

function status() {
  if (!supported()) return { launcher: false, autostart: false };
  return {
    launcher: fs.existsSync(filePath("launcher")),
    autostart: fs.existsSync(filePath("autostart")),
  };
}

function set(kind, enabled, iconPath) {
  if (!supported() || !(kind in DIRS)) return status();
  const file = filePath(kind);
  if (enabled) {
    fs.mkdirSync(DIRS[kind], { recursive: true });
    fs.writeFileSync(file, desktopEntry(iconPath), { mode: 0o644 });
  } else {
    fs.rmSync(file, { force: true });
  }
  return status();
}

module.exports = { supported, status, set };
