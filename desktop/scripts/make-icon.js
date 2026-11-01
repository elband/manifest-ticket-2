"use strict";

// Render public/icons/icon.svg → build/icon.png (512px) memakai Chromium
// bawaan Electron. Jalankan: npm run icon
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "..", "public", "icons", "icon.svg");
const OUT = path.join(__dirname, "..", "build", "icon.png");
const SIZE = 512;

// Render offscreen lewat CPU: tidak bergantung GPU/driver mesin build.
app.disableHardwareAcceleration();

app.whenReady().then(() => {
  const svg = fs
    .readFileSync(SRC, "utf8")
    .replace("<svg ", `<svg width="${SIZE}" height="${SIZE}" `);
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });

  let loaded = false;
  win.webContents.on("did-finish-load", () => {
    loaded = true;
  });
  win.webContents.on("paint", (_e, _dirty, image) => {
    const { width, height } = image.getSize();
    if (!loaded || width < SIZE || height < SIZE) return;
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, image.resize({ width: SIZE, height: SIZE }).toPNG());
    console.log(`Ikon ditulis: ${OUT}`);
    app.quit();
  });

  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`;
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  // Paksa repaint setelah halaman selesai dimuat.
  win.webContents.on("did-finish-load", () => win.webContents.invalidate());
  setTimeout(() => {
    console.error("Gagal merender ikon (timeout).");
    app.exit(1);
  }, 15000);
});
