"use strict";

/**
 * Jembatan aman halaman ↔ proses utama (contextIsolation + sandbox).
 *
 * Halaman SIPANDAI di server hanya mendapat aksi kiosk (dipakai
 * src/lib/kioskAgent.ts). Fungsi pengaturan hanya diberikan ke halaman lokal
 * aplikasi (file://). Proses utama tetap memeriksa asal setiap panggilan.
 */

const { contextBridge, ipcRenderer } = require("electron");

const api = {
  isDesktop: true,
  getActions: () => ipcRenderer.invoke("kiosk:actions"),
  runAction: (action) => ipcRenderer.invoke("kiosk:run", action),
};

if (location.protocol === "file:") {
  Object.assign(api, {
    getSetup: () => ipcRenderer.invoke("setup:get"),
    saveServer: (url) => ipcRenderer.invoke("setup:save", url),
    trustCert: () => ipcRenderer.invoke("setup:trust-cert"),
    retry: () => ipcRenderer.invoke("setup:retry"),
    openSetup: () => ipcRenderer.invoke("setup:open"),
    cancel: () => ipcRenderer.invoke("setup:cancel"),
    setShortcut: (kind, enabled) => ipcRenderer.invoke("setup:shortcut", kind, enabled),
    quit: () => ipcRenderer.invoke("setup:quit"),
    checkUpdate: () => ipcRenderer.invoke("setup:update-check"),
    installUpdate: () => ipcRenderer.invoke("setup:update-install"),
  });
}

contextBridge.exposeInMainWorld("sipandaiDesktop", api);
