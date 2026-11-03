"use client";

/**
 * Akses backend atas nama PERANGKAT (kiosk/laptop) — tanpa login manual.
 *
 * Alur:
 *  1. Perangkat membuat secret acak sekali (localStorage) lalu mendaftar ke
 *     `POST /devices/register` → status "pending" + kode singkat (XXX-XXX).
 *  2. Admin mencocokkan kode itu di halaman Perangkat lalu mengizinkan
 *     (sekaligus menentukan station).
 *  3. Perangkat menukar secret-nya di `POST /devices/token` → token JWT
 *     perangkat, diperpanjang otomatis sebelum habis. Dicabut admin → ditolak.
 *
 * Token perangkat hanya dipakai bila tak ada token petugas (lihat
 * `authedFetch`); scan tetap tercatat atas nama petugas yang login PIN.
 */

import { getSettings, saveSettings } from "../settings";
import {
  type DeviceState,
  getApiBase,
  getDeviceState,
  getDeviceToken,
  setDeviceState,
} from "./client";

const SECRET_KEY = "afvs.device.secret";
/** Selama menunggu izin / dicabut: cek status tiap 30 dtk. */
const TICK_MS = 30_000;
/** Token diperpanjang bila sisa umurnya kurang dari ini. */
const RENEW_BEFORE_MS = 60 * 60_000;

function getOrCreateSecret(): string {
  const existing = window.localStorage.getItem(SECRET_KEY);
  if (existing) return existing;
  // getRandomValues tetap tersedia di origin HTTP (randomUUID tidak).
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  const secret = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  window.localStorage.setItem(SECRET_KEY, secret);
  return secret;
}

function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  if (ua.includes("SIPANDAI-Desktop")) return "Aplikasi desktop";
  if (/Android|iPhone|iPad/i.test(ua)) return "Perangkat seluler";
  return "Browser";
}

async function postJson(
  path: string,
  body: unknown,
): Promise<{ status: number; data: Record<string, unknown> | null } | null> {
  try {
    const res = await fetch(`${getApiBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    let data: Record<string, unknown> | null = null;
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      /* body kosong */
    }
    return { status: res.status, data };
  } catch {
    return null; // jaringan / server mati → coba lagi di tick berikutnya
  }
}

interface DeviceInfo {
  id: string;
  name: string;
  station: string | null;
  code: string;
}

/** Perlu bicara ke server? Tidak bila token masih lama berlaku. */
function needsCheck(s: DeviceState): boolean {
  if (s.status !== "approved" || !getDeviceToken()) return true;
  const exp = s.expiresAt ? Date.parse(s.expiresAt) : 0;
  return exp - Date.now() < RENEW_BEFORE_MS;
}

/** Satu putaran: daftar bila perlu, lalu ambil status/token terbaru. */
export async function syncDeviceAccess(opts?: { force?: boolean }): Promise<DeviceState> {
  let state = getDeviceState();
  if (!opts?.force && !needsCheck(state)) return state;
  const secret = getOrCreateSecret();

  if (state.status === "unregistered") {
    const reg = await postJson("/devices/register", { secret, name: defaultDeviceName() });
    if (!reg || reg.status !== 200 || !reg.data) return state;
    state = {
      status: reg.data.status as DeviceState["status"],
      id: reg.data.id as string,
      code: reg.data.code as string,
    };
    setDeviceState(state);
  }

  const res = await postJson("/devices/token", { secret });
  if (!res) return state;
  if (res.status === 404) {
    // Dihapus admin → daftar ulang di putaran berikutnya (kode baru).
    state = { status: "unregistered" };
    setDeviceState(state);
    return state;
  }
  if (res.status === 403) {
    state = { ...state, status: "revoked", token: null, expiresAt: null };
    setDeviceState(state);
    return state;
  }
  if (res.status !== 200 || !res.data) return state; // 429/5xx → biarkan, coba lagi

  const info = res.data.device as DeviceInfo;
  const base = { id: info.id, code: info.code, name: info.name, station: info.station };
  if (res.data.status === "approved") {
    state = {
      ...base,
      status: "approved",
      token: res.data.token as string,
      expiresAt: res.data.expiresAt as string,
    };
    setDeviceState(state);
    // Perangkat diizinkan → kirim ke backend selalu aktif.
    if (!getSettings().apiSyncEnabled) saveSettings({ apiSyncEnabled: true });
  } else {
    state = { ...base, status: "pending", token: null, expiresAt: null };
    setDeviceState(state);
  }
  return state;
}

let started = false;
export function startDeviceAuth(): () => void {
  if (typeof window === "undefined" || started) return () => {};
  started = true;

  let busy = false;
  const run = (force = false) => {
    if (busy) return;
    busy = true;
    syncDeviceAccess({ force })
      .catch(() => {})
      .finally(() => {
        busy = false;
      });
  };
  const onRecheck = () => run(true);
  const onOnline = () => run();

  run();
  const interval = window.setInterval(() => run(), TICK_MS);
  window.addEventListener("afvs:device-recheck", onRecheck);
  window.addEventListener("online", onOnline);

  return () => {
    window.clearInterval(interval);
    window.removeEventListener("afvs:device-recheck", onRecheck);
    window.removeEventListener("online", onOnline);
    started = false;
  };
}
