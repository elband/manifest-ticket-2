"use client";

import { Flight, PassengerRecord, ScanEvent, SessionUser, User } from "./types";
import {
  DEMO_USERS_ENABLED,
  DEMO_USER_IDS,
  DUMMY_USERS,
  buildSeedFlights,
} from "./mockData";
import { buildFlightsFromCustomSeed } from "./seedSnapshot";
import { manifestDedupKey } from "./manifest";
import { todayDateString } from "./utils";

const KEYS = {
  users: "afvs.users",
  flights: "afvs.flights",
  scanEvents: "afvs.scanEvents",
  scanEventsArchive: "afvs.scanEventsArchive",
  session: "afvs.session",
  seeded: "afvs.seeded",
  audit: "afvs.flightAuditEvents",
  settings: "afvs.settings",
  archiveAt: "afvs.lastArchiveAt",
  manifests: "afvs.manifests",
} as const;

function isBrowser() {
  return typeof window !== "undefined";
}

// P-09: cache in-memory hasil parse per-key. Getter (getFlights/getScanEvents/…)
// dipanggil berkali-kali per render/siklus; tanpa cache tiap panggilan = JSON.parse
// penuh (blocking). Cache disinkronkan saat write() dan diinvalidasi saat
// localStorage diubah dari TAB LAIN (event "storage").
// Catatan: nilai yang dikembalikan diperlakukan READ-ONLY oleh pemanggil
// (semua update memakai pola immutable: filter/map/spread).
const cache = new Map<string, unknown>();

function invalidate(key: string) {
  cache.delete(key);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === null) cache.clear();
    else cache.delete(e.key);
  });
}

function read<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  if (cache.has(key)) return cache.get(key) as T;
  try {
    const raw = window.localStorage.getItem(key);
    const value = raw ? (JSON.parse(raw) as T) : fallback;
    cache.set(key, value);
    return value;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  if (!isBrowser()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
  cache.set(key, value);
}

/**
 * Auto-seed flight demo hanya bila di-aktifkan via env
 * `NEXT_PUBLIC_SEED_DEMO_FLIGHTS=true`. DEFAULT OFF (produksi) → instance
 * baru/reset mulai KOSONG; jadwal diisi dari sync FIDS atau dibuat manual.
 */
function demoFlightSeedEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SEED_DEMO_FLIGHTS === "true";
}

export function ensureSeed() {
  if (!isBrowser()) return;
  const seeded = window.localStorage.getItem(KEYS.seeded);
  if (seeded === "1") return;

  write<User[]>(KEYS.users, DUMMY_USERS);
  // Snapshot "default" yang DISENGAJA disimpan operator tetap dihormati. Selain
  // itu: flight demo bawaan HANYA diisi bila demo-seed di-aktifkan (env).
  const customSeed = buildFlightsFromCustomSeed();
  const flights =
    customSeed ?? (demoFlightSeedEnabled() ? buildSeedFlights() : []);
  write<Flight[]>(KEYS.flights, flights);
  write<ScanEvent[]>(KEYS.scanEvents, []);
  window.localStorage.setItem(KEYS.seeded, "1");
}

export function resetAll() {
  if (!isBrowser()) return;
  Object.values(KEYS).forEach((k) => window.localStorage.removeItem(k));
  cache.clear();
  ensureSeed();
}

/* Users */
export function getUsers(): User[] {
  // Produksi: tidak ada akun lokal (satu-satunya isinya akun demo, termasuk
  // salinan lama di localStorage) → login hanya lewat backend.
  if (!DEMO_USERS_ENABLED) return [];
  const stored = read<User[]>(KEYS.users, DUMMY_USERS);
  const byId = new Map(stored.map((u) => [u.id, u]));
  let changed = false;

  for (const demo of DUMMY_USERS) {
    const existing = byId.get(demo.id);
    if (!existing) {
      byId.set(demo.id, demo);
      changed = true;
      continue;
    }
    if (demo.pin && !existing.pin) {
      byId.set(demo.id, { ...existing, pin: demo.pin });
      changed = true;
    }
  }

  const users = Array.from(byId.values());
  if (changed) write<User[]>(KEYS.users, users);
  return users;
}

/* Session */
export function getSession(): SessionUser | null {
  const session = read<SessionUser | null>(KEYS.session, null);
  // Sesi akun demo yang tersisa dari sebelum akun demo dimatikan → logout.
  if (session && !DEMO_USERS_ENABLED && DEMO_USER_IDS.has(session.id)) {
    setSession(null);
    return null;
  }
  return session;
}

export function setSession(user: SessionUser | null) {
  if (!isBrowser()) return;
  if (user === null) {
    window.localStorage.removeItem(KEYS.session);
    invalidate(KEYS.session);
  } else {
    write(KEYS.session, user);
    // Tandai sesi login baru agar AI Insight hanya auto-popup sekali tepat
    // setelah login — bukan tiap refresh / pindah menu.
    try {
      window.sessionStorage.setItem("afvs.insightBubble.freshLogin", "1");
    } catch {
      /* sessionStorage tidak tersedia → toast cukup di-skip */
    }
  }
}

/**
 * Ubah data sesi yang sedang aktif (mis. nama dari halaman profil) tanpa
 * dianggap login baru. Header & sidebar mendengarkan event `afvs:session`.
 */
export function updateSession(patch: Partial<Pick<SessionUser, "name" | "email">>) {
  if (!isBrowser()) return;
  const cur = getSession();
  if (!cur) return;
  write(KEYS.session, { ...cur, ...patch });
  window.dispatchEvent(new CustomEvent("afvs:session"));
}

/* Flights */
export function getFlights(): Flight[] {
  return read<Flight[]>(KEYS.flights, []);
}

export function saveFlights(flights: Flight[]) {
  write(KEYS.flights, flights);
}

export function addFlight(flight: Flight) {
  // P-09: jangan mutasi array hasil getFlights() (kini bisa ter-cache) — pakai copy.
  saveFlights([...getFlights(), flight]);
}

export function updateFlight(id: string, patch: Partial<Flight>) {
  // Perubahan status lewat updateFlight = keputusan manusia (supervisor /
  // sweeper) → ditandai manual agar merge FIDS tidak menimpanya.
  const manual =
    patch.status !== undefined && patch.manualStatus === undefined
      ? { manualStatus: true }
      : {};
  const list = getFlights().map((f) =>
    f.id === id
      ? { ...f, ...patch, ...manual, updatedAt: new Date().toISOString() }
      : f,
  );
  saveFlights(list);
}

export function deleteFlight(id: string) {
  saveFlights(getFlights().filter((f) => f.id !== id));
}

/* Manifest penumpang per-flight (afvs.manifests) — dataset kanonik lokal yang
   diisi saat scan VALID (offline-first). Bentuk: { [flightId]: PassengerRecord[] }.
   Kunci dedup tiket→PNR sama dengan backend (lihat ./manifest). */
type ManifestStore = Record<string, PassengerRecord[]>;

function getManifestStore(): ManifestStore {
  return read<ManifestStore>(KEYS.manifests, {});
}

export function getFlightManifest(flightId: string): PassengerRecord[] {
  return getManifestStore()[flightId] ?? [];
}

/**
 * Catat satu penumpang (dari scan VALID) ke manifest flight. Dedup tiket→PNR:
 * penumpang yang sama → increment scanCount + majukan lastScannedAt. Idempotensi
 * scan sudah dijaga di layer scan (rawBarcode+flightId+hari) sehingga aman.
 */
export function upsertManifestPax(
  flightId: string,
  pax: {
    passengerName: string | null;
    pnr: string | null;
    ticketNumber: string | null;
    seatNumber: string | null;
    scannedAt: string;
    flightNumber: string;
  },
) {
  const dedupKey = manifestDedupKey(pax.ticketNumber, pax.pnr);
  if (!dedupKey) return; // tak ada tiket/PNR → tak bisa didedup

  const store = getManifestStore();
  const list = store[flightId] ? [...store[flightId]] : [];
  const idx = list.findIndex(
    (p) => manifestDedupKey(p.ticketNumber, p.pnr) === dedupKey,
  );

  if (idx === -1) {
    list.push({
      passengerName: pax.passengerName,
      pnr: pax.pnr ?? "—",
      ticketNumber: pax.ticketNumber ?? "—",
      seatNumber: pax.seatNumber ?? "—",
      flightId,
      flightNumber: pax.flightNumber,
      firstScannedAt: pax.scannedAt,
      lastScannedAt: pax.scannedAt,
      scanCount: 1,
    });
  } else {
    const cur = list[idx];
    list[idx] = {
      ...cur,
      scanCount: cur.scanCount + 1,
      lastScannedAt:
        pax.scannedAt > cur.lastScannedAt ? pax.scannedAt : cur.lastScannedAt,
      firstScannedAt:
        pax.scannedAt < cur.firstScannedAt ? pax.scannedAt : cur.firstScannedAt,
      // perkaya field yang kosong tanpa menimpa yang sudah ada
      passengerName: cur.passengerName ?? pax.passengerName,
      seatNumber:
        cur.seatNumber && cur.seatNumber !== "—"
          ? cur.seatNumber
          : pax.seatNumber ?? cur.seatNumber,
    };
  }

  write(KEYS.manifests, { ...store, [flightId]: list });
}

/* Scan Events */
export function getScanEvents(): ScanEvent[] {
  return read<ScanEvent[]>(KEYS.scanEvents, []);
}

export function saveScanEvents(events: ScanEvent[]) {
  write(KEYS.scanEvents, events);
}

export function addScanEvent(event: ScanEvent) {
  // P-09: jangan mutasi array hasil getScanEvents() (kini bisa ter-cache) — pakai copy.
  saveScanEvents([event, ...getScanEvents()]);
}

export function updateScanEvent(id: string, patch: Partial<ScanEvent>) {
  const list = getScanEvents().map((e) =>
    e.id === id ? { ...e, ...patch } : e,
  );
  saveScanEvents(list);
}

/* Scan Events Archive */
export function getScanEventsArchive(): ScanEvent[] {
  return read<ScanEvent[]>(KEYS.scanEventsArchive, []);
}

function saveScanEventsArchive(events: ScanEvent[]) {
  write(KEYS.scanEventsArchive, events);
}

export function purgeScanEventsArchive() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(KEYS.scanEventsArchive);
  invalidate(KEYS.scanEventsArchive);
}

/**
 * Pindahkan scan event yang lebih lama dari `keepDays` hari ke arsip
 * (key terpisah supaya localStorage utama tidak membengkak).
 * Idempotent — aman dipanggil tiap mount AppShell; menggunakan
 * `KEYS.archiveAt` untuk menghindari re-run pada hari yang sama.
 */
const ARCHIVE_MAX = 5000; // P-18: batas entri arsip agar localStorage tak membengkak

export function archiveOldScanEvents(keepDays = 1): {
  moved: number;
  ranToday: boolean;
} {
  if (!isBrowser()) return { moved: 0, ranToday: false };
  const todayStr = todayDateString();
  const lastRun = window.localStorage.getItem(KEYS.archiveAt);
  if (lastRun === todayStr) return { moved: 0, ranToday: true };

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - keepDays);

  const current = getScanEvents();
  const keep: ScanEvent[] = [];
  const move: ScanEvent[] = [];
  for (const e of current) {
    const t = new Date(e.scannedAt).getTime();
    if (Number.isFinite(t) && t < cutoff.getTime()) move.push(e);
    else keep.push(e);
  }

  if (move.length > 0) {
    const archive = getScanEventsArchive();
    // P-18: gabung (terbaru di depan) lalu batasi ukuran — buang yang paling lama.
    const merged = [...move, ...archive];
    saveScanEventsArchive(
      merged.length > ARCHIVE_MAX ? merged.slice(0, ARCHIVE_MAX) : merged,
    );
    saveScanEvents(keep);
  }
  window.localStorage.setItem(KEYS.archiveAt, todayStr);
  return { moved: move.length, ranToday: false };
}

/* Bulk export of everything (for Settings → Data tab) */
export function exportAllData(): string {
  if (!isBrowser()) return "{}";
  const payload: Record<string, unknown> = {};
  for (const k of Object.values(KEYS)) {
    const raw = window.localStorage.getItem(k);
    if (raw === null) continue;
    try {
      payload[k] = JSON.parse(raw);
    } catch {
      payload[k] = raw;
    }
  }
  return JSON.stringify(payload, null, 2);
}
