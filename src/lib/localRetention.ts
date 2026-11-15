"use client";

/**
 * Pembersihan harian salinan lokal yang sudah aman di server.
 *
 * Perangkat (kiosk/HP) menyimpan setiap scan + foto wajahnya di browser. Setelah
 * server menerimanya (ScanEvent.syncedAt), salinan lokal hanya berguna untuk
 * tampilan riwayat — laci riwayat kiosk cuma menampilkan HARI INI, riwayat lama
 * ada di Monitor Scan (server). Tanpa pembersihan, kiosk yang berjalan berbulan-
 * bulan terus menumpuk data (dulu sampai penyimpanan penuh & scan gagal).
 *
 * Yang dibuang: scan bertanda terkirim (atau scan uji) > RETENTION_DAYS hari,
 * plus foto wajahnya. Yang TIDAK PERNAH dibuang: scan yang masih di antrean
 * kirim, dan scan tanpa tanda terkirim (mis. dibuat saat sinkron server mati).
 */

import { getApiOutboxEventIds } from "./api/outbox";
import { facePhotoStore } from "./facePhotoStore";
import { getLocalScanEventIds, removeSyncedScanEventsBefore } from "./storage";

export const RETENTION_DAYS = 7;
const LAST_RUN_KEY = "afvs.lastRetentionAt";

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface RetentionResult {
  ran: boolean;
  scans: number;
  photos: number;
}

/**
 * Jalankan pembersihan (maks. 1x/hari kecuali `force`). Aman dipanggil di tiap
 * pembukaan halaman; kegagalan apa pun ditelan — ini hanya housekeeping.
 */
export async function pruneSyncedLocalData(opts?: {
  force?: boolean;
  days?: number;
  now?: number;
}): Promise<RetentionResult> {
  if (typeof window === "undefined") return { ran: false, scans: 0, photos: 0 };
  const today = todayKey();
  try {
    if (!opts?.force && window.localStorage.getItem(LAST_RUN_KEY) === today) {
      return { ran: false, scans: 0, photos: 0 };
    }
  } catch {
    return { ran: false, scans: 0, photos: 0 };
  }

  const days = opts?.days ?? RETENTION_DAYS;
  const cutoff = (opts?.now ?? Date.now()) - days * 86_400_000;
  let scans = 0;
  let photos = 0;
  try {
    const queued = getApiOutboxEventIds();
    const removed = removeSyncedScanEventsBefore(cutoff, queued);
    scans = removed.length;

    // Foto: milik scan yang barusan dibuang, ATAU yatim (scannya sudah tidak
    // ada di perangkat — mis. arsip dibuang saat penyimpanan penuh) selama
    // tidak sedang menunggu dikirim bersama scannya.
    const local = getLocalScanEventIds();
    const removedIds = new Set(removed.map((e) => e.faceCaptureId ?? e.id));
    for (const id of await facePhotoStore.keys()) {
      if (queued.has(id)) continue;
      if (removedIds.has(id) || !local.has(id)) {
        try {
          await facePhotoStore.delete(id);
          photos += 1;
        } catch {
          /* lanjut ke foto berikutnya */
        }
      }
    }
    window.localStorage.setItem(LAST_RUN_KEY, today);
  } catch (e) {
    console.warn("[retensi] pembersihan data lokal gagal", e);
  }
  return { ran: true, scans, photos };
}
