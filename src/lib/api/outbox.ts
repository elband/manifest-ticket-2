"use client";

/**
 * Outbox push scan-event ke backend AFVS. Pola sama dengan sikerenOutbox:
 * enqueue lokal dulu (offline-safe), flush sekuensial, idempotent by eventId.
 * Foto wajah diambil lazy dari IndexedDB saat flush (key = faceCaptureId).
 */

import { facePhotoStore } from "../facePhotoStore";
import { getSettings } from "../settings";
import { getSession } from "../storage";
import type { ScanEvent } from "../types";
import {
  ScanPushFields,
  apiDecideIdentity,
  apiHealth,
  apiPushScan,
  getApiUser,
  getDeviceState,
  isAuthed,
} from "./client";

export interface ApiOutboxItem {
  id: string; // = eventId (scan) atau `${eventId}#identity` (keputusan)
  fields: ScanPushFields;
  /** Ada → item ini keputusan petugas cek KTP/SIM untuk scan `fields.eventId`
   *  yang sudah terkirim (PATCH), bukan push scan baru. */
  identity?: { match: boolean; decidedAt: string; auto?: boolean };
  faceCaptureId: string | null;
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  /** HTTP status percobaan terakhir; null = gagal jaringan/timeout. */
  lastStatus?: number | null;
  enqueuedAt: string;
  status: "pending" | "syncing" | "failed";
}

interface ApiOutboxMeta {
  lastSyncedAt: string | null;
  lastError: string | null;
  /**
   * Backend terjangkau pada percobaan terakhir? null = belum pernah dicoba.
   * Lebih jujur dari navigator.onLine, yang tetap true saat LAN hidup tapi
   * server mati.
   */
  reachable?: boolean | null;
}

export interface ApiOutboxSummary {
  pending: number;
  /** Item yang sedang dikirim saat ini. */
  syncing: number;
  failed: number;
  total: number;
  lastSyncedAt: string | null;
  lastError: string | null;
  /** Jaringan hidup DAN backend tidak sedang tak terjangkau. */
  online: boolean;
  /** Ada data menunggu tapi token backend hilang/kedaluwarsa → perlu login. */
  needsLogin: boolean;
  /**
   * Kenapa antrean TIDAK dikirim sama sekali (null = tidak tertahan). Tanpa
   * ini, label hanya "Online · N menunggu" padahal tak ada yang terkirim.
   */
  blocked: OutboxBlock;
  /** Kode perangkat untuk dicocokkan admin di menu Perangkat. */
  deviceCode: string | null;
}

export type OutboxBlock =
  | "device-pending" // perangkat belum diizinkan admin & tak ada petugas login server
  | "device-renew" // izin ada, token perangkat sedang diperbarui
  | "device-revoked" // izin perangkat dicabut admin
  | "sync-off" // sinkron backend dimatikan di perangkat ini
  | null;

/** Jatah percobaan untuk kegagalan "permanent" sebelum item ditandai failed. */
const MAX_ATTEMPTS = 5;

export type PushErrorKind = "transient" | "auth" | "permanent";

/**
 * Golongkan kegagalan push dari HTTP status-nya. Hanya "permanent" (data
 * ditolak backend, mis. validasi 400) yang menghabiskan jatah percobaan.
 * Jaringan putus, timeout, throttle & server error ("transient") serta token
 * habis ("auth") bukan salah datanya → item tetap menunggu sampai pulih.
 */
export function classifyPushError(status: number | null | undefined): PushErrorKind {
  if (!status) return "transient";
  if (status === 401) return "auth";
  if (status === 408 || status === 429 || status >= 500) return "transient";
  return "permanent";
}

/**
 * Apakah kegagalan berarti backend benar-benar tak terjangkau (label
 * "Server offline")? Hanya jaringan putus/timeout (tanpa status) dan 502–504
 * dari Nginx (backend mati/macet). Status lain — termasuk 429 throttle —
 * berarti server hidup & menjawab; dulu 429 ikut dianggap offline sehingga
 * kiosk menampilkan "Server offline" padahal koneksinya lancar.
 */
export function isServerUnreachable(status: number | null | undefined): boolean {
  return !status || status === 502 || status === 503 || status === 504;
}

/**
 * Pulihkan antrean saat aplikasi mulai:
 *  - `syncing` → `pending` (aplikasi tertutup di tengah pengiriman);
 *  - `failed` yang bukan karena data ditolak (versi lama menandai gangguan
 *    jaringan sebagai failed, tanpa lastStatus) → `pending` dengan jatah baru.
 */
export function recoverOutboxItems(items: ApiOutboxItem[]): ApiOutboxItem[] {
  return items.map((q) => {
    if (q.status === "syncing") return { ...q, status: "pending" };
    if (q.status === "failed" && classifyPushError(q.lastStatus) !== "permanent") {
      return { ...q, status: "pending", attempts: 0 };
    }
    return q;
  });
}

const QUEUE_KEY = "afvs.api.outbox";
const META_KEY = "afvs.api.outboxMeta";

function isBrowser() {
  return typeof window !== "undefined";
}

function readQueue(): ApiOutboxItem[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as ApiOutboxItem[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: ApiOutboxItem[]) {
  if (!isBrowser()) return;
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  notify();
}

const EMPTY_META: ApiOutboxMeta = { lastSyncedAt: null, lastError: null, reachable: null };

function readMeta(): ApiOutboxMeta {
  if (!isBrowser()) return EMPTY_META;
  try {
    const raw = window.localStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as ApiOutboxMeta) : EMPTY_META;
  } catch {
    return EMPTY_META;
  }
}

function writeMeta(meta: ApiOutboxMeta) {
  if (!isBrowser()) return;
  window.localStorage.setItem(META_KEY, JSON.stringify(meta));
  notify();
}

function notify() {
  if (!isBrowser()) return;
  window.dispatchEvent(new CustomEvent("afvs:api-outbox"));
}

export function getApiOutboxSummary(): ApiOutboxSummary {
  const queue = readQueue();
  const meta = readMeta();
  const online =
    (!isBrowser() || navigator.onLine !== false) && meta.reachable !== false;
  const pending = queue.filter(
    (q) => q.status === "pending" || q.status === "syncing",
  ).length;
  return {
    pending,
    syncing: queue.filter((q) => q.status === "syncing").length,
    failed: queue.filter((q) => q.status === "failed").length,
    total: queue.length,
    lastSyncedAt: meta.lastSyncedAt,
    lastError: meta.lastError,
    online,
    needsLogin:
      isBrowser() && getSettings().apiSyncEnabled && !isAuthed() && pending > 0,
    blocked: blockReason(pending),
    deviceCode: isBrowser() ? (getDeviceState().code ?? null) : null,
  };
}

function blockReason(pending: number): OutboxBlock {
  if (!isBrowser() || pending === 0) return null;
  if (!isAuthed()) {
    const status = getDeviceState().status;
    if (status === "revoked") return "device-revoked";
    if (status === "approved") return "device-renew";
    return "device-pending";
  }
  return getSettings().apiSyncEnabled ? null : "sync-off";
}

/** Label + penjelasan status kiriman untuk indikator ringkas (header). */
export function describeApiOutbox(s: ApiOutboxSummary): {
  tone: "ok" | "busy" | "warn" | "bad";
  label: string;
  hint: string;
} {
  const n = s.pending;
  const waiting = n > 0 ? ` · ${n} menunggu` : "";
  const error = s.lastError ? `
Error terakhir: ${s.lastError}` : "";
  switch (s.blocked) {
    case "device-pending":
      return {
        tone: "warn",
        label: `Belum diizinkan · ${s.deviceCode ?? "…"}${waiting}`,
        hint: `Perangkat ini belum diizinkan mengirim data. Minta admin mengizinkan kode ${s.deviceCode ?? "perangkat"} di menu Perangkat. Data tetap tersimpan di perangkat.`,
      };
    case "device-renew":
      return {
        tone: "busy",
        label: `Menyambung ulang${waiting}`,
        hint: "Izin perangkat sedang diperbarui — pengiriman lanjut otomatis.",
      };
    case "device-revoked":
      return {
        tone: "bad",
        label: `Perangkat dicabut${waiting}`,
        hint: "Admin mencabut izin perangkat ini. Data tetap tersimpan; minta admin mengizinkannya lagi di menu Perangkat.",
      };
    case "sync-off":
      return {
        tone: "warn",
        label: `Sinkron mati${waiting}`,
        hint: "Kirim ke server dimatikan di perangkat ini (menu Koneksi). Data tetap tersimpan di perangkat.",
      };
  }
  if (!s.online) {
    return {
      tone: "bad",
      label: `Offline${waiting}`,
      hint: `Server tidak terjangkau. Data tersimpan di perangkat dan dikirim otomatis saat koneksi pulih.${error}`,
    };
  }
  if (s.failed > 0) {
    return {
      tone: "bad",
      label: `${s.failed} gagal kirim${waiting}`,
      hint: `Sebagian data ditolak server.${error}`,
    };
  }
  if (s.syncing > 0) {
    return { tone: "busy", label: `Mengirim${waiting}`, hint: "Sedang mengirim data ke server." };
  }
  if (n > 0) {
    return {
      tone: "busy",
      label: `Online${waiting}`,
      hint: `Data sedang diantre untuk dikirim (±25 tiap 20 detik). Klik untuk kirim sekarang.${error}`,
    };
  }
  return { tone: "ok", label: "Online", hint: "Semua data sudah terkirim ke server." };
}

export function subscribeApiOutbox(cb: () => void): () => void {
  if (!isBrowser()) return () => {};
  const handler = () => cb();
  window.addEventListener("afvs:api-outbox", handler);
  window.addEventListener("afvs:api-auth", handler);
  window.addEventListener("afvs:device", handler); // status izin / kode perangkat
  window.addEventListener("online", handler);
  window.addEventListener("offline", handler);
  return () => {
    window.removeEventListener("afvs:api-outbox", handler);
    window.removeEventListener("afvs:api-auth", handler);
    window.removeEventListener("afvs:device", handler);
    window.removeEventListener("online", handler);
    window.removeEventListener("offline", handler);
  };
}

export function resolveStation(): string {
  // Perangkat yang diizinkan admin bertugas di station yang ditetapkan admin.
  const device = getDeviceState();
  if (device.status === "approved" && device.station) return device.station;
  const user = getApiUser();
  if (user?.station) return user.station;
  const s = getSettings();
  return s.sikerenStation || "UNKNOWN";
}

/**
 * Enqueue scan event ke outbox backend. Gate oleh setting `apiSyncEnabled`.
 * Dipanggil dari scanService setiap scan tercatat. Tidak melempar error.
 */
export function enqueueScanPush(event: ScanEvent): void {
  if (!isBrowser()) return;
  if (!getSettings().apiSyncEnabled) return;

  const item: ApiOutboxItem = {
    id: event.id,
    fields: toPushFields(event),
    faceCaptureId: event.faceCaptureId ?? null,
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    enqueuedAt: new Date().toISOString(),
    status: "pending",
  };

  const queue = readQueue().filter((q) => q.id !== item.id);
  queue.push(item);
  writeQueue(queue);
}

/**
 * Kirim keputusan petugas "Sesuai"/"Tidak sesuai" (cek KTP/SIM) ke backend.
 * `event` = scan event yang SUDAH diperbarui lokal. Bila push scan-nya masih
 * menunggu di antrean, cukup timpa field-nya (status final ikut terkirim);
 * bila sudah terkirim / sedang dikirim, antre PATCH terpisah di belakangnya.
 */
export function enqueueIdentityDecision(
  event: ScanEvent,
  match: boolean,
  decidedAt: string,
  /** Sesuai otomatis (card tertimpa scan berikutnya), bukan keputusan petugas. */
  auto = false,
): void {
  if (!isBrowser()) return;
  if (!getSettings().apiSyncEnabled) return;
  if (event.isTest) return; // scan penerbangan uji tak pernah dikirim

  const queue = readQueue();
  const queued = queue.find((q) => q.id === event.id);
  if (queued && queued.status !== "syncing") {
    writeQueue(
      queue.map((q) =>
        q.id === event.id ? { ...q, fields: toPushFields(event) } : q,
      ),
    );
    return;
  }

  const item: ApiOutboxItem = {
    id: `${event.id}#identity`,
    fields: toPushFields(event),
    identity: auto ? { match, decidedAt, auto } : { match, decidedAt },
    faceCaptureId: null,
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    enqueuedAt: new Date().toISOString(),
    status: "pending",
  };
  writeQueue([...queue.filter((q) => q.id !== item.id), item]);
}

function toPushFields(event: ScanEvent): ScanPushFields {
  return {
    eventId: event.id,
    rawBarcode: event.rawBarcode,
    flightNumber: event.parsedFlightNumber,
    pnr: event.parsedPnr,
    ticketNumber: event.parsedTicketNumber,
    seat: event.parsedSeatNumber,
    passengerName: event.parsedPassengerName,
    resultStatus: event.resultStatus,
    message: event.message,
    scannedAt: event.scannedAt,
    station: resolveStation(),
    operatorId: getSession()?.id ?? null,
    ktpStatus: event.ktpVerification?.status ?? null,
    ktpName: event.ktpVerification?.ocrName ?? null,
    ktpSimilarity: event.ktpVerification?.similarity ?? null,
    ktpCapturedAt: event.ktpVerification?.capturedAt ?? null,
  };
}

/**
 * Lengkapi faceCaptureId pada item yang sudah ter-enqueue (dipanggil setelah
 * foto wajah tersimpan di IndexedDB, mis. dari processScanWithFace).
 */
export function attachFaceToQueued(eventId: string, faceCaptureId: string): void {
  const queue = readQueue();
  let changed = false;
  const next = queue.map((q) => {
    if (q.id === eventId && q.faceCaptureId !== faceCaptureId) {
      changed = true;
      return { ...q, faceCaptureId };
    }
    return q;
  });
  if (changed) writeQueue(next);
}

export function retryAllApiFailed(): void {
  const queue = readQueue().map((q) =>
    q.status === "failed" ? { ...q, status: "pending" as const } : q,
  );
  writeQueue(queue);
}

export function clearApiOutbox(): void {
  writeQueue([]);
  writeMeta(EMPTY_META);
}

let flushing = false;

export async function flushApiOutbox(opts?: {
  maxItems?: number;
}): Promise<{ sent: number; failed: number; skipped: number }> {
  if (!isBrowser()) return { sent: 0, failed: 0, skipped: 0 };
  if (flushing) return { sent: 0, failed: 0, skipped: 0 };
  if (!getSettings().apiSyncEnabled) return { sent: 0, failed: 0, skipped: 0 };
  if (!isAuthed()) return { sent: 0, failed: 0, skipped: 0 };
  if (navigator.onLine === false) return { sent: 0, failed: 0, skipped: 0 };

  flushing = true;
  const max = opts?.maxItems ?? 25;
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  try {
    let queue = readQueue();
    const targets = queue.filter((q) => q.status === "pending").slice(0, max);

    for (const item of targets) {
      queue = readQueue().map((q) =>
        q.id === item.id ? { ...q, status: "syncing" as const } : q,
      );
      writeQueue(queue);

      let result;
      if (item.identity) {
        result = await apiDecideIdentity(item.fields.eventId, item.identity);
      } else {
        const faceBlob = item.faceCaptureId
          ? await facePhotoStore.get(item.faceCaptureId)
          : null;
        // Item lama (sebelum ada operatorId) → atas nama petugas yang login sekarang.
        const fields = item.fields.operatorId
          ? item.fields
          : { ...item.fields, operatorId: getSession()?.id ?? null };
        result = await apiPushScan(fields, faceBlob);
      }

      queue = readQueue();
      if (result.ok) {
        writeQueue(queue.filter((q) => q.id !== item.id));
        writeMeta({
          lastSyncedAt: new Date().toISOString(),
          lastError: null,
          reachable: true,
        });
        sent += 1;
      } else {
        const kind = classifyPushError(result.status);
        const attempts = kind === "permanent" ? item.attempts + 1 : item.attempts;
        const nextStatus: ApiOutboxItem["status"] =
          attempts >= MAX_ATTEMPTS ? "failed" : "pending";
        writeQueue(
          queue.map((q) =>
            q.id === item.id
              ? {
                  ...q,
                  attempts,
                  lastAttemptAt: new Date().toISOString(),
                  lastError: result.error ?? "Unknown error",
                  lastStatus: result.status ?? null,
                  status: nextStatus,
                }
              : q,
          ),
        );
        writeMeta({
          lastSyncedAt: readMeta().lastSyncedAt,
          lastError: result.error ?? "Unknown error",
          reachable: !isServerUnreachable(result.status),
        });
        if (nextStatus === "failed") failed += 1;
        else skipped += 1;
        // Jaringan/server terganggu atau token habis: hentikan batch, coba
        // lagi di tick berikutnya (atau setelah login ulang).
        if (kind !== "permanent") break;
      }
    }
  } finally {
    flushing = false;
  }
  return { sent, failed, skipped };
}

/** Perbarui status `reachable` dengan ping ringan ke backend. */
async function probeBackend(): Promise<void> {
  if (!getSettings().apiSyncEnabled) return;
  const reachable = navigator.onLine !== false && (await apiHealth()).ok;
  const meta = readMeta();
  if (meta.reachable !== reachable) writeMeta({ ...meta, reachable });
}

let autoFlushStarted = false;
export function startApiAutoFlush(): () => void {
  if (!isBrowser()) return () => {};
  if (autoFlushStarted) return () => {};
  autoFlushStarted = true;

  const queue = readQueue();
  const recovered = recoverOutboxItems(queue);
  if (recovered.some((q, i) => q !== queue[i])) writeQueue(recovered);

  const kick = () => {
    const hasPending = readQueue().some((q) => q.status === "pending");
    // Antrean kosong → tetap cek backend supaya indikator online/offline
    // akurat (flush hanya memperbarui status saat ada yang dikirim). Probe
    // dilewati saat tab tersembunyi (indikatornya pun tak terlihat); antrean
    // pending tetap dikirim walau tersembunyi.
    if (hasPending) flushApiOutbox().catch(() => {});
    else if (document.visibilityState === "visible") probeBackend().catch(() => {});
  };
  kick();
  const interval = window.setInterval(kick, 20_000);
  window.addEventListener("online", kick);
  window.addEventListener("afvs:api-auth", kick);

  return () => {
    window.clearInterval(interval);
    window.removeEventListener("online", kick);
    window.removeEventListener("afvs:api-auth", kick);
    autoFlushStarted = false;
  };
}
