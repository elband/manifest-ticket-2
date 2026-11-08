"use client";

import type { Flight, ParsedBarcode, ScanEvent } from "./types";
import { getSettings } from "./settings";
import { todayDateString } from "./utils";

export interface SikerenPayload {
  /** Source/station id supaya backend bisa membedakan gate */
  station: string;
  scanEventId: string;
  airlineCode: string;
  flightNumber: string;
  originAirport: string;
  destinationAirport: string;
  departureDate: string;
  departureTime: string;
  gate: string;
  pnr: string;
  ticketNumber: string;
  seatNumber: string;
  passengerName: string | null;
  scannedAt: string;
  scannedBy: string;
}

export interface SikerenPostResult {
  ok: boolean;
  status?: number;
  error?: string;
  body?: unknown;
}

/**
 * Bangun payload Sikeren dari ScanEvent + Flight + parsed barcode.
 * Hanya boleh dipanggil pada outcome VALID_FLIGHT.
 */
export function buildSikerenPayload(
  event: ScanEvent,
  flight: Flight,
  parsed: ParsedBarcode,
): SikerenPayload {
  const s = getSettings();
  return {
    station: s.sikerenStation || "",
    scanEventId: event.id,
    airlineCode: flight.airlineCode,
    flightNumber: flight.flightNumber,
    originAirport: flight.originAirport,
    destinationAirport: flight.destinationAirport,
    departureDate: flight.departureDate,
    departureTime: flight.departureTime,
    gate: flight.gateOrCheckpoint,
    pnr: parsed.pnr,
    ticketNumber: parsed.ticketNumber,
    seatNumber: parsed.seatNumber,
    passengerName: parsed.passengerName,
    scannedAt: event.scannedAt,
    scannedBy: event.scannedBy,
  };
}

/**
 * Kirim payload ke endpoint Sikeren. Pakai timeout 8 detik.
 * Tidak melempar error — selalu return result object.
 */
export async function postSikeren(
  payload: SikerenPayload,
  opts?: { endpoint?: string; apiKey?: string; timeoutMs?: number },
): Promise<SikerenPostResult> {
  if (typeof window === "undefined") {
    return { ok: false, error: "Tidak bisa kirim dari server." };
  }
  const s = getSettings();
  const endpoint = (opts?.endpoint ?? s.sikerenEndpoint).trim();
  const apiKey = (opts?.apiKey ?? s.sikerenApiKey).trim();
  const timeoutMs = opts?.timeoutMs ?? 8000;

  if (!endpoint) {
    return { ok: false, error: "Endpoint Sikeren belum di-set." };
  }
  if (!isOnline()) {
    return { ok: false, error: "Offline — tidak ada koneksi internet." };
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        "X-AFVS-Station": payload.station || "unknown",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let body: unknown = null;
    try {
      const text = await res.text();
      body = text ? safeJson(text) : null;
    } catch {
      /* ignore */
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: `HTTP ${res.status} ${res.statusText}`,
        body,
      };
    }
    return { ok: true, status: res.status, body };
  } catch (e) {
    const err = e as Error;
    const message =
      err?.name === "AbortError"
        ? `Timeout setelah ${timeoutMs}ms`
        : err?.message || "Gagal mengirim ke Sikeren";
    return { ok: false, error: message };
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Test connection — kirim ping dengan payload minimal supaya operator
 * tahu endpoint+auth-nya valid sebelum aktifkan sync.
 */
export async function pingSikeren(
  endpoint: string,
  apiKey: string,
): Promise<SikerenPostResult> {
  const probe: SikerenPayload = {
    station: getSettings().sikerenStation || "test",
    scanEventId: "probe-" + Date.now(),
    airlineCode: "XX",
    flightNumber: "TEST",
    originAirport: "XXX",
    destinationAirport: "XXX",
    departureDate: todayDateString(),
    departureTime: "00:00",
    gate: "TEST",
    pnr: "TEST00",
    ticketNumber: "0",
    seatNumber: "0A",
    passengerName: "TEST PROBE",
    scannedAt: new Date().toISOString(),
    scannedBy: "ping",
  };
  return postSikeren(probe, { endpoint, apiKey, timeoutMs: 5000 });
}

function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
