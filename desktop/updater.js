"use strict";

/**
 * Pembaruan aplikasi dari GitHub Releases (electron-updater).
 *
 * - Cek saat aplikasi dibuka lalu tiap 4 jam; versi baru diunduh di latar
 *   belakang (ke cache, tetap ada setelah aplikasi ditutup).
 * - Paket .deb dipasang lewat pkexec (dialog password admin Lubuntu), jadi
 *   pemasangan selalu atas persetujuan orang di depan layar. Bila dialog
 *   dibatalkan, aplikasi tetap berjalan dan pembaruan bisa dipasang nanti.
 * - Hanya aktif di build Linux terpasang yang membawa app-update.yml
 *   (bukan saat `npm start`).
 */

const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let updater = null;
/**
 * status: unsupported | idle | checking | latest | downloading | ready |
 *         installing | error
 */
let state = {
  status: "unsupported",
  version: null,
  percent: null,
  error: null,
  checkedAt: null,
};

function setState(patch) {
  state = { ...state, ...patch };
}

function supported() {
  return (
    app.isPackaged &&
    process.platform === "linux" &&
    fs.existsSync(path.join(process.resourcesPath, "app-update.yml"))
  );
}

function friendlyError(err) {
  const msg = String(err?.message ?? err ?? "").split("\n")[0];
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|net::ERR_/i.test(msg)) {
    return "Tidak bisa menghubungi GitHub. Periksa koneksi internet perangkat.";
  }
  return msg.slice(0, 200) || "Terjadi kesalahan.";
}

/**
 * Mulai pemeriksaan berkala. `onReady(version)` dipanggil saat pembaruan
 * selesai diunduh dan siap dipasang.
 */
function start({ onReady } = {}) {
  if (!supported() || updater) return;
  updater = require("electron-updater").autoUpdater;
  updater.autoDownload = true;
  // Pemasangan .deb butuh password admin → jangan dipicu diam-diam saat
  // aplikasi ditutup (mis. tombol Tutup di kiosk); selalu lewat install().
  updater.autoInstallOnAppQuit = false;

  updater.on("checking-for-update", () => setState({ status: "checking", error: null }));
  updater.on("update-available", (info) =>
    setState({ status: "downloading", version: info.version, percent: 0 }),
  );
  updater.on("update-not-available", () =>
    setState({ status: "latest", checkedAt: new Date().toISOString() }),
  );
  updater.on("download-progress", (p) => setState({ percent: Math.round(p.percent) }));
  updater.on("update-downloaded", (info) => {
    setState({
      status: "ready",
      version: info.version,
      percent: 100,
      checkedAt: new Date().toISOString(),
    });
    onReady?.(info.version);
  });
  updater.on("error", (err) => {
    // Pemasangan dibatalkan/gagal: file unduhan masih ada → bisa dicoba lagi.
    if (state.status === "installing") {
      setState({ status: "ready", error: `Pemasangan dibatalkan atau gagal: ${friendlyError(err)}` });
    } else {
      setState({ status: "error", error: friendlyError(err) });
    }
  });

  setState({ status: "idle" });
  setTimeout(check, FIRST_CHECK_DELAY_MS);
  setInterval(check, CHECK_INTERVAL_MS);
}

function check() {
  if (!updater) return getState();
  if (["checking", "downloading", "ready", "installing"].includes(state.status)) {
    return getState();
  }
  updater.checkForUpdates().catch((err) =>
    setState({ status: "error", error: friendlyError(err) }),
  );
  return getState();
}

/** Pasang pembaruan yang sudah diunduh lalu buka ulang aplikasi. */
function install() {
  if (!updater || state.status !== "ready") return false;
  setState({ status: "installing", error: null });
  // Sinkron: pkexec menampilkan dialog password, dpkg memasang paket, lalu
  // aplikasi ditutup & dibuka ulang (versi baru) bila berhasil.
  updater.quitAndInstall(false, true);
  return true;
}

function getState() {
  return { ...state, currentVersion: app.getVersion() };
}

module.exports = { start, check, install, getState };
