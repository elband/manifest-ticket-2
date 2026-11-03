"use client";

/**
 * Tarik jadwal KEBERANGKATAN dari FIDS bandara lalu merge ke localStorage
 * sebagai tipe `Flight`, supaya validasi boarding pass (scanService) mengecek
 * jadwal nyata. Pola merge identik dengan api/flightSync.ts: cocok by
 * flightNumber + tanggal, id lokal dipertahankan agar referensi tak putus.
 *
 * Kedatangan TIDAK ikut di-sync (model Flight berorientasi keberangkatan) —
 * hanya tampil di papan FIDS.
 */

import { apiSyncFlights, isAuthed, type FlightSyncPayload } from "../api/client";
import { getFlights, saveFlights } from "../storage";
import type { Flight, FlightStatus } from "../types";
import { fetchKeberangkatan } from "./client";
import { HOME_IATA, JadwalKeberangkatan, expectedPaxFor } from "./types";

/**
 * remark FIDS → FlightStatus (mode pos pendataan / "hybrid").
 *
 *  - Cancelled/Batal           → CANCELLED (final)
 *  - Departured/Closed/Tutup   → CLOSED (pesawat sudah berangkat / gate tutup)
 *  - selain itu (Check In Open, Estimate, Boarding, Delay, Scheduled, …)
 *    → OPEN, supaya boarding pass bisa di-scan di pos pemeriksaan SELAMA flight
 *      masih hidup di papan FIDS. Penutupan mengikuti FIDS ("Departured"),
 *      dengan pengaman waktu STD+closeAfter di getEffectiveFlightStatus bila
 *      FIDS belum sempat melapor.
 */
function mapRemarkStatus(remark: string | null): FlightStatus {
  const s = (remark ?? "").toLowerCase();
  if (s.includes("cancel") || s.includes("batal")) return "CANCELLED";
  if (
    s.includes("depart") ||
    s.includes("berangkat") ||
    s.includes("closed") ||
    s.includes("tutup")
  )
    return "CLOSED";
  return "OPEN";
}

/**
 * Gabungkan status lokal dengan status hasil pemetaan FIDS saat merge.
 *
 * Aturan (mendahulukan keselamatan & menghormati keputusan manual supervisor):
 *  - CANCELLED lokal itu final — tak bisa dibuka lagi oleh FIDS.
 *  - FIDS terminal (CANCELLED / CLOSED=Departured) SELALU menutup — inilah inti
 *    "tutup ikut FIDS": flight yang sudah OPEN pun ikut CLOSED saat berangkat.
 *  - CLOSED manual oleh supervisor tetap tertutup (FIDS aktif tak membukanya).
 *  - ACTIVE (final call manual) dipertahankan.
 *  - selain itu (DRAFT/OPEN + FIDS aktif) → OPEN.
 */
function nextStatus(
  existing: FlightStatus,
  incoming: FlightStatus,
): FlightStatus {
  if (existing === "CANCELLED") return "CANCELLED";
  if (incoming === "CANCELLED") return "CANCELLED";
  if (incoming === "CLOSED") return "CLOSED";
  if (existing === "CLOSED") return "CLOSED";
  if (existing === "ACTIVE") return "ACTIVE";
  return "OPEN";
}

export function keberangkatanToFlight(j: JadwalKeberangkatan): Flight {
  const now = new Date().toISOString();
  const checkpoint =
    j.gate || (j.counter != null ? `Konter ${j.counter}` : "—");
  return {
    id: j.id, // "fids-kb-<id>"
    flightNumber: j.flightNumber,
    airlineCode: j.airlineCode,
    originAirport: HOME_IATA,
    destinationAirport: j.destinationIata,
    departureDate: j.tanggal,
    departureTime: j.jam,
    gateOrCheckpoint: checkpoint,
    status: mapRemarkStatus(j.remark),
    expectedPax: expectedPaxFor(j.capacity, j.aircraftType),
    createdAt: now,
    updatedAt: now,
  };
}

function keyOf(f: Flight) {
  return `${f.flightNumber.toUpperCase()}__${f.departureDate}`;
}

/** Status lokal → enum backend (backend tak punya DRAFT). */
function toBackendStatus(s: FlightStatus): string {
  return s === "DRAFT" ? "SCHEDULED" : s;
}

/**
 * Flight lokal → payload backend untuk snapshot harian. `std` dibentuk sebagai
 * waktu "naif" (suffix Z) dari tanggal+jam papan FIDS supaya filter tanggal
 * backend (batas hari UTC) mengelompokkannya tepat di tanggal keberangkatan,
 * tanpa pergeseran zona waktu. `station` = bandara asal (AAP) → snapshot jadwal
 * keberangkatan bandara, kunci unik stabil (station+flightNumber+std).
 */
function toSyncPayload(f: Flight): FlightSyncPayload {
  return {
    flightNumber: f.flightNumber,
    airlineCode: f.airlineCode || "—",
    origin: f.originAirport,
    destination: f.destinationAirport,
    std: `${f.departureDate}T${f.departureTime || "00:00"}:00.000Z`,
    status: toBackendStatus(f.status),
    station: f.originAirport,
  };
}

// Tiap perangkat menarik FIDS tiap 3 menit dan dulu SELALU mengirim seluruh
// jadwal ke POST /flights/sync, padahal isinya jarang berubah. Simpan sidik
// snapshot terakhir yang diterima backend; kirim ulang hanya bila berubah
// (atau sudah lewat SYNC_REFRESH_MS, sebagai pengaman).
const LAST_SYNC_KEY = "afvs.fids.lastSync";
const SYNC_REFRESH_MS = 30 * 60_000;

function isUnchangedSinceLastSync(payload: FlightSyncPayload[]): boolean {
  try {
    const raw = window.localStorage.getItem(LAST_SYNC_KEY);
    if (!raw) return false;
    const last = JSON.parse(raw) as { at: number; body: string };
    return (
      Date.now() - last.at < SYNC_REFRESH_MS &&
      last.body === JSON.stringify(payload)
    );
  } catch {
    return false;
  }
}

function rememberSync(payload: FlightSyncPayload[]) {
  try {
    window.localStorage.setItem(
      LAST_SYNC_KEY,
      JSON.stringify({ at: Date.now(), body: JSON.stringify(payload) }),
    );
  } catch {
    /* storage penuh → sync berikutnya tetap dikirim, tak masalah */
  }
}

export interface FidsPullResult {
  ok: boolean;
  added: number;
  updated: number;
  total: number;
  /** Jumlah jadwal yang berhasil disimpan ke backend (snapshot). 0 jika offline/tak login. */
  synced?: number;
  error?: string;
}

/** Tarik keberangkatan (opsional filter tanggal) lalu merge ke localStorage. */
export async function pullFidsKeberangkatan(
  tanggal?: string,
): Promise<FidsPullResult> {
  const res = await fetchKeberangkatan(tanggal);
  if (!res.ok) {
    return { ok: false, added: 0, updated: 0, total: 0, error: res.error };
  }

  const incoming = res.items.map(keberangkatanToFlight);
  const byKey = new Map(getFlights().map((f) => [keyOf(f), f]));

  let added = 0;
  let updated = 0;
  for (const inc of incoming) {
    const k = keyOf(inc);
    const existing = byKey.get(k);
    if (existing) {
      byKey.set(k, {
        ...existing,
        ...inc,
        id: existing.id, // pertahankan id lokal
        // Status mengikuti FIDS dengan aturan aman (lihat nextStatus): FIDS
        // boleh MENUTUP (Departured/Cancelled) walau lokal sudah OPEN, tapi
        // tak boleh membuka kembali yang sudah CLOSED/CANCELLED manual.
        // Bila lokal masih penerbangan UJI, jadwal riil dari FIDS menang:
        // tanda uji dilepas & status sepenuhnya mengikuti FIDS.
        status: existing.isTest
          ? inc.status
          : nextStatus(existing.status, inc.status),
        isTest: false,
        // Pertahankan pax yang sudah diisi; default FIDS hanya mengisi yang kosong.
        expectedPax:
          existing.expectedPax && existing.expectedPax > 0
            ? existing.expectedPax
            : inc.expectedPax,
        updatedAt: new Date().toISOString(),
      });
      updated += 1;
    } else {
      byKey.set(k, inc);
      added += 1;
    }
  }

  saveFlights(Array.from(byKey.values()));
  // Beritahu UI lain (mis. halaman Jadwal Penerbangan) agar refresh daftar.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("afvs:flights-updated"));
  }

  // Snapshot ke backend (riwayat permanen). Best-effort: kalau belum login ke
  // backend / backend mati, jadwal tetap aman di localStorage — pull tak gagal.
  let synced = 0;
  if (isAuthed() && incoming.length > 0) {
    const payload = incoming.map(toSyncPayload);
    if (isUnchangedSinceLastSync(payload)) {
      // Backend sudah punya snapshot identik → tak perlu POST lagi.
      synced = payload.length;
    } else {
      const sync = await apiSyncFlights(payload);
      if (sync.ok && sync.data) {
        synced = sync.data.synced;
        rememberSync(payload);
      }
    }
  }

  return { ok: true, added, updated, total: incoming.length, synced };
}
