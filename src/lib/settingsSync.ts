"use client";

/**
 * Sinkronisasi pengaturan GLOBAL lewat backend AFVS (GET/PUT /api/settings).
 *
 * - Perubahan lokal (event `afvs:settings-local`) ditandai pending lalu
 *   didorong ke backend; offline / belum login → tetap pending sampai bisa.
 * - Perangkat menarik pengaturan saat mulai, tiap 60 detik (hanya saat tab
 *   terlihat), saat login, online, dan saat tab kembali aktif. Selama ada perubahan pending, push
 *   didahulukan supaya perubahan di perangkat ini tidak tertimpa.
 * - Konflik: last-write-wins (penyimpanan terakhir yang menang).
 * - Setelan khusus perangkat (kamera, apiSyncEnabled) tidak ikut — lihat
 *   DEVICE_LOCAL_KEYS di settings.ts.
 */

import { apiGetAppSettings, apiPutAppSettings, getToken } from "./api/client";
import {
  getSettings,
  getSharedSettings,
  pickSharedSettings,
  saveSettings,
  type AppSettings,
} from "./settings";

interface SyncMeta {
  /** Ada perubahan lokal yang belum diterima backend. */
  pendingPush: boolean;
  /** updatedAt pengaturan backend terakhir yang sudah diterapkan di sini. */
  serverUpdatedAt: string | null;
}

const META_KEY = "afvs.settings.sync";
const POLL_MS = 60_000;
const PUSH_DEBOUNCE_MS = 800;

function readMeta(): SyncMeta {
  try {
    const raw = window.localStorage.getItem(META_KEY);
    if (raw) return { pendingPush: false, serverUpdatedAt: null, ...JSON.parse(raw) };
  } catch {
    /* abaikan meta rusak */
  }
  return { pendingPush: false, serverUpdatedAt: null };
}

function writeMeta(patch: Partial<SyncMeta>) {
  window.localStorage.setItem(META_KEY, JSON.stringify({ ...readMeta(), ...patch }));
}

/** Terapkan data backend ke localStorage tanpa memicu push balik. */
function applyRemote(data: Record<string, unknown>) {
  const remote = pickSharedSettings(data);
  const local = getSettings();
  const changed = (Object.keys(remote) as (keyof AppSettings)[]).some(
    (k) => JSON.stringify(remote[k]) !== JSON.stringify(local[k]),
  );
  if (changed) saveSettings(remote, { fromRemote: true });
}

async function push(): Promise<void> {
  const res = await apiPutAppSettings(getSharedSettings() as Record<string, unknown>);
  if (res.ok) {
    writeMeta({ pendingPush: false, serverUpdatedAt: res.data?.updatedAt ?? null });
    return;
  }
  // Role tidak boleh mengubah (403) / data ditolak (400): perubahan lokal
  // dibatalkan, pengaturan global ditarik ulang. Gangguan jaringan / 401 →
  // tetap pending.
  if (res.status === 403 || res.status === 400) {
    writeMeta({ pendingPush: false, serverUpdatedAt: null });
    await pull();
  }
}

async function pull(): Promise<void> {
  const res = await apiGetAppSettings();
  if (!res.ok || !res.data) return;
  const { data, updatedAt } = res.data;
  if (!data) {
    // Backend belum punya pengaturan → perangkat ini yang mengisinya pertama kali.
    await push();
    return;
  }
  if (updatedAt === readMeta().serverUpdatedAt) return;
  applyRemote(data);
  writeMeta({ serverUpdatedAt: updatedAt });
}

let running = false;

/** Satu putaran sinkronisasi: push bila ada perubahan pending, lalu pull. */
export async function syncSettingsNow(): Promise<void> {
  if (running) return;
  if (!getToken() || navigator.onLine === false) return;
  running = true;
  try {
    if (readMeta().pendingPush) await push();
    if (!readMeta().pendingPush) await pull();
  } finally {
    running = false;
  }
}

let started = false;
export function startSettingsSync(): () => void {
  if (typeof window === "undefined" || started) return () => {};
  started = true;

  let pushTimer: number | null = null;
  const kick = () => {
    syncSettingsNow().catch(() => {});
  };
  const onLocalChange = () => {
    writeMeta({ pendingPush: true });
    if (pushTimer) window.clearTimeout(pushTimer);
    pushTimer = window.setTimeout(kick, PUSH_DEBOUNCE_MS);
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") kick();
  };

  kick();
  // Tab tersembunyi tak perlu polling — onVisible menarik ulang saat kembali.
  const interval = window.setInterval(() => {
    if (document.visibilityState === "visible") kick();
  }, POLL_MS);
  window.addEventListener("afvs:settings-local", onLocalChange);
  window.addEventListener("afvs:api-auth", kick);
  window.addEventListener("online", kick);
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    if (pushTimer) window.clearTimeout(pushTimer);
    window.clearInterval(interval);
    window.removeEventListener("afvs:settings-local", onLocalChange);
    window.removeEventListener("afvs:api-auth", kick);
    window.removeEventListener("online", kick);
    document.removeEventListener("visibilitychange", onVisible);
    started = false;
  };
}
