"use client";

/**
 * Outbox push scan-event ke backend AFVS. Pola sama dengan sikerenOutbox:
 * enqueue lokal dulu (offline-safe), flush sekuensial, idempotent by eventId.
 * Foto wajah diambil lazy dari IndexedDB saat flush (key = faceCaptureId).
 */

import { facePhotoStore } from "../facePhotoStore";
import { getSettings } from "../settings";
import type { ScanEvent } from "../types";
import {
  ScanPushFields,
  apiDecideIdentity,
  apiHealth,
  apiPushScan,
  getApiUser,
  getToken,
} from "./client";

export interface ApiOutboxItem {
  id: string; // = eventId (scan) atau `${eventId}#identity` (keputusan)
  fields: ScanPushFields;
  /** Ada → item ini keputusan petugas cek KTP/SIM untuk scan `fields.eventId`
   *  yang sudah terkirim (PATCH), bukan push scan baru. */
  identity?: { match: boolean; decidedAt: string };
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
}

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
      isBrowser() && getSettings().apiSyncEnabled && !getToken() && pending > 0,
  };
}

export function subscribeApiOutbox(cb: () => void): () => void {
  if (!isBrowser()) return () => {};
  const handler = () => cb();
  window.addEventListener("afvs:api-outbox", handler);
  window.addEventListener("afvs:api-auth", handler);
  window.addEventListener("online", handler);
  window.addEventListener("offline", handler);
  return () => {
    window.removeEventListener("afvs:api-outbox", handler);
    window.removeEventListener("afvs:api-auth", handler);
    window.removeEventListener("online", handler);
    window.removeEventListener("offline", handler);
  };
}

function resolveStation(): string {
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
    identity: { match, decidedAt },
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
  if (!getToken()) return { sent: 0, failed: 0, skipped: 0 };
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
        result = await apiPushScan(item.fields, faceBlob);
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
          reachable: kind !== "transient",
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
