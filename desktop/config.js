"use strict";

/**
 * Konfigurasi aplikasi desktop SIPANDAI.
 *
 * Dua sumber, digabung:
 *  - Sistem  : /etc/sipandai-desktop.json (dipasang admin). Bila mengisi
 *              `serverUrl`, alamat server TERKUNCI dan tidak bisa diganti dari
 *              layar pengaturan.
 *  - Pengguna: <userData>/config.json (~/.config/SIPANDAI/config.json), ditulis
 *              dari layar pengaturan.
 *
 * Contoh /etc/sipandai-desktop.json:
 *   {
 *     "serverUrl": "https://192.168.50.156",
 *     "trustedCertFingerprint": "AB:CD:...:EF"   // SHA-256, opsional
 *   }
 */

const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const SYSTEM_CONFIG = "/etc/sipandai-desktop.json";

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function userConfigPath() {
  return path.join(app.getPath("userData"), "config.json");
}

/**
 * Rapikan input alamat server → origin (skema + host + port), atau null bila
 * tidak valid. Tanpa skema dianggap https (aplikasi butuh secure context untuk
 * kamera & service worker).
 */
function normalizeServerUrl(input) {
  if (typeof input !== "string") return null;
  let raw = input.trim();
  if (!raw) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** "sha256/<base64>" (format Electron) atau hex bebas → "AB:CD:..." (format openssl). */
function normalizeFingerprint(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const v = value.trim();
  let hex;
  if (v.startsWith("sha256/")) {
    hex = Buffer.from(v.slice("sha256/".length), "base64").toString("hex");
  } else {
    hex = v.replace(/[^0-9a-f]/gi, "");
  }
  if (hex.length !== 64) return null;
  return hex.toUpperCase().match(/.{2}/g).join(":");
}

function load() {
  const system = readJson(SYSTEM_CONFIG) ?? {};
  const user = readJson(userConfigPath()) ?? {};

  const systemServer = normalizeServerUrl(system.serverUrl);
  const serverUrl = systemServer ?? normalizeServerUrl(user.serverUrl) ?? "";

  let trustedCert = null;
  const systemFp = normalizeFingerprint(system.trustedCertFingerprint);
  if (systemServer && systemFp) {
    trustedCert = { origin: systemServer, fingerprint: systemFp };
  } else if (user.trustedCert && typeof user.trustedCert === "object") {
    const origin = normalizeServerUrl(user.trustedCert.origin);
    const fingerprint = normalizeFingerprint(user.trustedCert.fingerprint);
    if (origin && fingerprint) trustedCert = { origin, fingerprint };
  }

  return { serverUrl, locked: Boolean(systemServer), trustedCert };
}

/** Simpan sebagian konfigurasi pengguna (digabung dengan yang sudah ada). */
function save(partial) {
  const file = userConfigPath();
  const current = readJson(file) ?? {};
  const next = { ...current, ...partial };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

module.exports = { load, save, normalizeServerUrl, normalizeFingerprint };
