"use client";

/**
 * Tarik (pull) jadwal penerbangan dari backend lalu merge ke localStorage.
 * Memetakan bentuk Flight backend (origin/destination/std/station) ke tipe
 * Flight frontend (originAirport/departureDate/departureTime/gateOrCheckpoint).
 */

import { getFlights, saveFlights } from "../storage";
import type { Flight, FlightStatus } from "../types";
import { ApiFlight, apiListAllFlights } from "./client";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function mapStatus(s: string): FlightStatus {
  switch (s) {
    case "OPEN":
      return "OPEN";
    case "ACTIVE":
      return "ACTIVE";
    case "CLOSED":
      return "CLOSED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return "DRAFT"; // SCHEDULED & lainnya
  }
}

/** Konversi ApiFlight → Flight (waktu lokal perangkat). */
export function apiFlightToLocal(f: ApiFlight): Flight {
  const d = new Date(f.std);
  const departureDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )}`;
  const departureTime = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const now = new Date().toISOString();
  return {
    id: `api-${f.id}`,
    flightNumber: f.flightNumber,
    airlineCode: f.airlineCode,
    originAirport: f.origin,
    destinationAirport: f.destination,
    departureDate,
    departureTime,
    gateOrCheckpoint: f.station,
    status: mapStatus(f.status),
    createdAt: f.createdAt ?? now,
    updatedAt: f.updatedAt ?? now,
  };
}

function keyOf(f: Flight) {
  return `${f.flightNumber.toUpperCase()}__${f.departureDate}`;
}

export interface PullResult {
  ok: boolean;
  added: number;
  updated: number;
  total: number;
  error?: string;
}

/**
 * Pull flights backend untuk station/date tertentu, merge ke localStorage.
 * Match by flightNumber + departureDate; yang sudah ada di-update (id lokal
 * dipertahankan), yang baru ditambahkan.
 */
export async function pullFlights(params: {
  station?: string;
  date?: string;
}): Promise<PullResult> {
  const res = await apiListAllFlights(params);
  if (!res.ok || !res.data) {
    return { ok: false, added: 0, updated: 0, total: 0, error: res.error };
  }
  const incoming = res.data.items.map(apiFlightToLocal);
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
        id: existing.id, // pertahankan id lokal agar referensi tidak putus
        // Status dari backend yang berbeda = diubah petugas di perangkat lain
        // (buka/tutup manual) → hormati sebagai manual saat merge FIDS.
        manualStatus:
          inc.status !== existing.status ? true : existing.manualStatus,
        // Flight dari server selalu riil: bila lokal masih penerbangan UJI,
        // data server menang & tanda uji dilepas.
        isTest: false,
        updatedAt: new Date().toISOString(),
      });
      updated += 1;
    } else {
      byKey.set(k, inc);
      added += 1;
    }
  }

  saveFlights(Array.from(byKey.values()));
  return { ok: true, added, updated, total: incoming.length };
}
