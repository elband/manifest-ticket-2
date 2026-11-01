"use strict";

/**
 * SIPANDAI Desktop — shell Electron untuk dashboard admin & mode kiosk.
 *
 * Aplikasi tidak membundel frontend/backend: jendela membuka server SIPANDAI
 * (Next.js + NestJS di belakang Nginx), jadi data tetap terpusat dan update web
 * langsung terpakai tanpa memasang ulang aplikasi.
 *
 * Mode:
 *   sipandai-desktop                 → dashboard (jendela biasa, dimaksimalkan)
 *   sipandai-desktop --kiosk         → /scan/kiosk layar penuh, tanpa menu
 *   sipandai-desktop --server=URL    → pakai server ini untuk sesi ini saja
 *
 * Aksi kiosk (tutup / perkecil / matikan perangkat) dijalankan langsung oleh
 * proses ini, menggantikan kiosk-agent/ yang dibutuhkan bila memakai browser.
 */

const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  screen,
  session,
  shell,
} = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const config = require("./config");
const shortcuts = require("./shortcuts");
const updater = require("./updater");

const IS_KIOSK = process.argv.includes("--kiosk");
const CLI_SERVER = config.normalizeServerUrl(
  process.argv.find((a) => a.startsWith("--server="))?.slice("--server=".length),
);

const PRELOAD = path.join(__dirname, "preload.js");
const PAGES_DIR = path.join(__dirname, "pages");
const PAGES_URL = pathToFileURL(PAGES_DIR).href;
const ICON = path.join(__dirname, "build", "icon.png");

// Izin browser yang boleh diminta halaman SIPANDAI (kamera scan, layar penuh
// kiosk, salin teks). Selain itu & selain dari server → ditolak.
const ALLOWED_PERMISSIONS = new Set([
  "media",
  "fullscreen",
  "notifications",
  "clipboard-read",
  "clipboard-sanitized-write",
]);

let cfg = config.load();
let mainWindow = null;
/** Kegagalan muat terakhir (ditampilkan di pages/error.html). */
let lastFailure = null;
/** Sertifikat server yang ditolak terakhir (untuk tombol "Percayai"). */
let lastCertError = null;

app.userAgentFallback = `${app.userAgentFallback} SIPANDAI-Desktop/${app.getVersion()}`;

// Server lewat HTTP (selain localhost) bukan "secure context": Chromium
// memblokir kamera, service worker & clipboard. Atas keputusan pemilik sistem,
// HANYA origin server SIPANDAI diperlakukan aman. Risikonya: lalu lintas HTTP
// tidak terenkripsi, jadi solusi permanen tetap HTTPS di server. Switch harus
// dipasang sebelum app siap → ganti ke server HTTP lain butuh restart.
const BOOT_ORIGIN = serverOrigin();
if (BOOT_ORIGIN.startsWith("http://")) {
  app.commandLine.appendSwitch("unsafely-treat-insecure-origin-as-secure", BOOT_ORIGIN);
}

// ─────────── Util ───────────

function serverOrigin() {
  return CLI_SERVER ?? cfg.serverUrl ?? "";
}

function startUrl() {
  const origin = serverOrigin();
  return origin ? `${origin}${IS_KIOSK ? "/scan/kiosk" : "/"}` : null;
}

/** URL milik server SIPANDAI (termasuk blob: hasil ekspor Excel). */
function isServerUrl(url) {
  const origin = serverOrigin();
  if (!origin || !url) return false;
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function isLocalPage(url) {
  return typeof url === "string" && url.startsWith(`${PAGES_URL}/`);
}

function senderUrl(event) {
  return event.senderFrame?.url ?? "";
}

function openExternal(url) {
  try {
    const { protocol } = new URL(url);
    if (protocol === "https:" || protocol === "http:" || protocol === "mailto:") {
      shell.openExternal(url);
    }
  } catch {
    // URL rusak → abaikan.
  }
}

function showPage(name) {
  mainWindow?.loadFile(path.join(PAGES_DIR, name));
}

function loadApp(url = startUrl()) {
  if (!mainWindow) return;
  if (!url) {
    showPage("setup.html");
    return;
  }
  lastFailure = null;
  mainWindow.loadURL(url);
}

// ─────────── Aksi kiosk ───────────

function canShutdown() {
  return (
    process.platform === "linux" &&
    ["/usr/bin/systemctl", "/bin/systemctl"].some((p) => fs.existsSync(p))
  );
}

function availableActions() {
  const actions = ["close-browser", "minimize-browser"];
  if (IS_KIOSK) actions.push("fullscreen-browser");
  if (canShutdown()) actions.push("shutdown");
  return actions;
}

/** systemctl poweroff tanpa prompt password: gagal cepat bila polkit menolak. */
function shutdown() {
  return new Promise((resolve) => {
    const child = spawn("systemctl", ["poweroff", "--no-ask-password"], {
      stdio: "ignore",
    });
    const timer = setTimeout(() => resolve(false), 5000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

function coversDisplay(win) {
  const b = win.getBounds();
  const d = screen.getDisplayMatching(b).bounds;
  return (
    b.x <= d.x &&
    b.y <= d.y &&
    b.x + b.width >= d.x + d.width &&
    b.y + b.height >= d.y + d.height
  );
}

/**
 * Layar penuh kiosk seperti F11: tanpa judul jendela & taskbar. Window manager
 * Lubuntu (Openbox/LXQt) kadang mengabaikan permintaan, terutama sesaat setelah
 * jendela tampil → periksa beberapa kali dan minta ulang. Bila tetap gagal,
 * bentangkan jendela (tanpa bingkai) menutupi seluruh layar di atas taskbar.
 */
function enterKiosk(win) {
  win.setKiosk(true);
  const delays = [400, 1200, 3000];
  delays.forEach((ms, i) => {
    setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized()) return;
      if (win.isFullScreen() && coversDisplay(win)) return;
      if (i < delays.length - 1) {
        // Lepas lalu minta lagi supaya window manager memprosesnya ulang.
        win.setKiosk(false);
        setTimeout(() => !win.isDestroyed() && win.setKiosk(true), 150);
      } else {
        win.setBounds(screen.getDisplayMatching(win.getBounds()).bounds);
        win.setAlwaysOnTop(true, "screen-saver");
      }
    }, ms);
  });
  return true;
}

/** Keluar dari layar penuh kiosk supaya dialog password pembaruan terlihat. */
function installUpdate() {
  if (mainWindow && IS_KIOSK) {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setKiosk(false);
  }
  return updater.install();
}

function minimize() {
  const win = mainWindow;
  if (!win) return false;
  if (!win.isKiosk()) {
    win.minimize();
    return true;
  }
  // Jendela kiosk (layar penuh) tidak bisa langsung diperkecil: lepas kiosk,
  // perkecil setelah transisi selesai, pasang lagi saat dipulihkan.
  let done = false;
  const finish = () => {
    if (done || win.isDestroyed()) return;
    done = true;
    win.minimize();
    win.once("restore", () => {
      if (!win.isDestroyed()) enterKiosk(win);
    });
  };
  win.once("leave-full-screen", () => setTimeout(finish, 50));
  setTimeout(finish, 1000); // cadangan bila event tidak muncul
  win.setAlwaysOnTop(false);
  win.setKiosk(false);
  return true;
}

async function runAction(action) {
  switch (action) {
    case "close-browser":
      setTimeout(() => app.quit(), 150);
      return true;
    case "minimize-browser":
      return minimize();
    case "fullscreen-browser":
      return mainWindow ? enterKiosk(mainWindow) : false;
    case "shutdown":
      return canShutdown() ? shutdown() : false;
    default:
      return false;
  }
}

// ─────────── IPC ───────────

ipcMain.handle("kiosk:actions", (event) =>
  isServerUrl(senderUrl(event)) ? availableActions() : [],
);

ipcMain.handle("kiosk:run", (event, action) =>
  isServerUrl(senderUrl(event)) && availableActions().includes(action)
    ? runAction(action)
    : false,
);

/** Handler khusus halaman lokal aplikasi (pages/*.html). */
function handleLocal(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isLocalPage(senderUrl(event))) throw new Error("Akses ditolak");
    return fn(...args);
  });
}

function iconForShortcut() {
  // Ikon di dalam asar tidak terbaca launcher → salin ke ~/.config/SIPANDAI.
  const target = path.join(app.getPath("userData"), "icon.png");
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(ICON, target);
  } catch {
    // Pintasan tetap jalan tanpa ikon.
  }
  return target;
}

handleLocal("setup:get", () => ({
  serverUrl: serverOrigin(),
  locked: cfg.locked || Boolean(CLI_SERVER),
  kiosk: IS_KIOSK,
  version: app.getVersion(),
  failure: lastFailure,
  cert:
    lastCertError && lastFailure && isServerUrl(lastFailure.url)
      ? lastCertError
      : null,
  shortcuts: { supported: shortcuts.supported(), ...shortcuts.status() },
  update: updater.getState(),
}));

handleLocal("setup:save", (input) => {
  if (cfg.locked || CLI_SERVER) {
    return { ok: false, error: "Alamat server dikunci oleh administrator." };
  }
  const origin = config.normalizeServerUrl(input);
  if (!origin) {
    return { ok: false, error: "Alamat tidak valid. Contoh: https://192.168.50.156" };
  }
  config.save({ serverUrl: origin });
  cfg = config.load();
  if (origin.startsWith("http://") && origin !== BOOT_ORIGIN) {
    // Origin HTTP baru baru dianggap aman setelah aplikasi dibuka ulang.
    app.relaunch();
    app.exit(0);
    return { ok: true };
  }
  loadApp();
  return { ok: true };
});

handleLocal("setup:trust-cert", () => {
  if (!lastCertError || !isServerUrl(lastCertError.url)) return { ok: false };
  config.save({
    trustedCert: { origin: serverOrigin(), fingerprint: lastCertError.fingerprint },
  });
  cfg = config.load();
  const url = lastFailure?.url;
  lastCertError = null;
  loadApp(url && isServerUrl(url) ? url : startUrl());
  return { ok: true };
});

handleLocal("setup:retry", () => {
  const url = lastFailure?.url;
  loadApp(url && isServerUrl(url) ? url : startUrl());
});

handleLocal("setup:open", () => showPage("setup.html"));
handleLocal("setup:cancel", () => loadApp());
handleLocal("setup:quit", () => app.quit());
handleLocal("setup:update-check", () => updater.check());
handleLocal("setup:update-install", () => installUpdate());
handleLocal("setup:shortcut", (kind, enabled) =>
  shortcuts.set(kind, Boolean(enabled), iconForShortcut()),
);

// ─────────── Keamanan sesi ───────────

function hardenSession() {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(
      ALLOWED_PERMISSIONS.has(permission) &&
        isServerUrl(details.requestingUrl ?? details.securityOrigin),
    );
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
    ALLOWED_PERMISSIONS.has(permission) && isServerUrl(requestingOrigin),
  );
}

// Sertifikat self-signed / CA internal: hanya diterima bila sidik jarinya sama
// dengan yang dipercayai (dari layar error atau /etc/sipandai-desktop.json).
app.on("certificate-error", (event, _wc, url, error, certificate, callback) => {
  const fingerprint = config.normalizeFingerprint(certificate.fingerprint);
  if (
    isServerUrl(url) &&
    cfg.trustedCert &&
    cfg.trustedCert.origin === serverOrigin() &&
    cfg.trustedCert.fingerprint === fingerprint
  ) {
    event.preventDefault();
    callback(true);
    return;
  }
  if (isServerUrl(url)) {
    lastCertError = {
      url,
      error,
      fingerprint,
      subject: certificate.subjectName,
      issuer: certificate.issuerName,
      validExpiry: certificate.validExpiry,
    };
  }
  callback(false);
});

// ─────────── Jendela ───────────

function buildMenu() {
  if (IS_KIOSK) {
    Menu.setApplicationMenu(null);
    return;
  }
  const template = [
    {
      label: "Aplikasi",
      submenu: [
        { label: "Beranda", accelerator: "Alt+Home", click: () => loadApp() },
        { label: "Pengaturan Server…", click: () => showPage("setup.html") },
        {
          label: "Periksa Pembaruan…",
          click: () => {
            updater.check();
            showPage("setup.html");
          },
        },
        { type: "separator" },
        { role: "quit", label: "Keluar" },
      ],
    },
    {
      label: "Tampilan",
      submenu: [
        { role: "reload", label: "Muat Ulang" },
        { role: "forceReload", label: "Muat Ulang (abaikan cache)" },
        { type: "separator" },
        { role: "resetZoom", label: "Ukuran Asli" },
        { role: "zoomIn", label: "Perbesar" },
        { role: "zoomOut", label: "Perkecil" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Layar Penuh" },
        { role: "toggleDevTools", label: "Developer Tools" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Menu klik kanan sederhana (Salin / Tempel) untuk dashboard. */
function attachContextMenu(contents) {
  if (IS_KIOSK) return;
  contents.on("context-menu", (_e, params) => {
    const items = [];
    if (params.isEditable) {
      items.push(
        { role: "undo", label: "Urungkan" },
        { role: "redo", label: "Ulangi" },
        { type: "separator" },
        { role: "cut", label: "Potong" },
        { role: "copy", label: "Salin" },
        { role: "paste", label: "Tempel" },
        { role: "selectAll", label: "Pilih Semua" },
      );
    } else if (params.selectionText) {
      items.push({ role: "copy", label: "Salin" });
    } else if (params.linkURL && !isServerUrl(params.linkURL)) {
      items.push({ label: "Buka di Browser", click: () => openExternal(params.linkURL) });
    }
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
}

const WEB_PREFERENCES = {
  preload: PRELOAD,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: false,
};

function guardNavigation(contents) {
  contents.on("will-navigate", (event, url) => {
    if (isServerUrl(url) || isLocalPage(url)) return;
    event.preventDefault();
    openExternal(url);
  });

  // Jendela baru dari server (mis. cetak) boleh; tautan luar → browser sistem.
  contents.setWindowOpenHandler(({ url }) => {
    if (isServerUrl(url) || url === "about:blank") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          icon: ICON,
          webPreferences: WEB_PREFERENCES,
        },
      };
    }
    openExternal(url);
    return { action: "deny" };
  });

  contents.on("did-create-window", (child) => {
    guardNavigation(child.webContents);
    attachContextMenu(child.webContents);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: "SIPANDAI",
    icon: ICON,
    backgroundColor: "#0f172a",
    autoHideMenuBar: true,
    // Kiosk tanpa bingkai: judul jendela tidak muncul walau window manager
    // menolak layar penuh.
    frame: !IS_KIOSK,
    webPreferences: WEB_PREFERENCES,
  });

  const contents = mainWindow.webContents;
  guardNavigation(contents);
  attachContextMenu(contents);

  contents.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
    // -3 = ERR_ABORTED (navigasi dibatalkan/diganti), bukan kegagalan nyata.
    if (!isMainFrame || code === -3 || !isServerUrl(url)) return;
    lastFailure = { code, description, url };
    showPage("error.html");
  });

  // Ctrl+Shift+S membuka pengaturan server, juga di mode kiosk (tanpa menu).
  // F11 ditangani langsung: di Linux akselerator menu yang tersembunyi
  // (autoHideMenuBar) bisa tidak terbaca. Di kiosk F11 hanya memasang ulang
  // layar penuh, tidak pernah keluar darinya.
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.control && input.shift && input.code === "KeyS") {
      event.preventDefault();
      showPage("setup.html");
    } else if (input.code === "F11" && !input.isAutoRepeat) {
      event.preventDefault();
      if (IS_KIOSK) enterKiosk(mainWindow);
      else mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (!IS_KIOSK) mainWindow.maximize();
    mainWindow.show();
    // Kiosk dipasang setelah jendela tampil, bukan lewat opsi `kiosk`:
    // Openbox/LXQt bisa membuang layar penuh yang diminta saat `show: false`.
    if (IS_KIOSK) enterKiosk(mainWindow);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  loadApp();
}

// ─────────── Pembaruan aplikasi ───────────

/**
 * Tawarkan pemasangan pembaruan yang sudah diunduh. Dashboard selalu ditanya;
 * kiosk hanya sesaat setelah aplikasi dibuka (awal shift), supaya dialog
 * password tidak muncul di tengah antrean scan. Di luar itu admin memasang
 * dari halaman pengaturan (Ctrl+Shift+S).
 */
async function offerUpdate(version) {
  if (!mainWindow) return;
  if (IS_KIOSK && process.uptime() > 180) return;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "Pembaruan SIPANDAI",
    message: `SIPANDAI ${version} siap dipasang.`,
    detail:
      "Aplikasi akan ditutup sebentar dan meminta password admin Lubuntu untuk memasang pembaruan, lalu dibuka kembali. Data scan di perangkat tetap aman.",
    buttons: ["Pasang & Buka Ulang", "Nanti"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) installUpdate();
}

// ─────────── Siklus hidup ───────────

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    hardenSession();
    buildMenu();
    createWindow();
    updater.start({ onReady: offerUpdate });
  });

  app.on("window-all-closed", () => app.quit());
}
