"use client";

/**
 * AFVS Backend API client (NestJS @ http://localhost:3001/api).
 *
 * Client-side fetch wrapper:
 * - JWT disimpan di localStorage (`afvs.api.token` + `afvs.api.user`).
 * - Perangkat yang diizinkan admin punya token sendiri (`afvs.device.state`,
 *   dikelola device.ts) — dipakai bila tak ada token petugas, jadi kiosk tetap
 *   bisa kirim/ambil data tanpa login manual ke backend.
 * - `authedFetch` auto-attach Bearer token & auto-logout pada 401.
 * - Semua fungsi return objek `ApiResult` (tidak melempar) supaya UI mudah.
 *
 * Base URL dari env `NEXT_PUBLIC_AFVS_API_BASE` (fallback localhost:3001/api).
 */

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  role: string; // operator | supervisor | admin
  station: string | null;
}

export interface ApiResult<T> {
  ok: boolean;
  status?: number;
  data?: T;
  error?: string;
}

export interface ApiFlight {
  id: string;
  flightNumber: string;
  airlineCode: string;
  origin: string;
  destination: string;
  std: string; // ISO
  status: string; // SCHEDULED | OPEN | ACTIVE | CLOSED | CANCELLED
  station: string;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  perPage: number;
  total: number;
}

export interface ScanPushFields {
  eventId: string;
  rawBarcode: string;
  flightNumber?: string | null;
  pnr?: string | null;
  ticketNumber?: string | null;
  seat?: string | null;
  passengerName?: string | null;
  resultStatus: string;
  message?: string | null;
  scannedAt: string; // ISO
  station: string;
  ktpStatus?: string | null;
  ktpName?: string | null;
  ktpSimilarity?: number | null;
  ktpCapturedAt?: string | null;
  /** Petugas (id operator backend) yang scan — dipakai bila dikirim dgn token perangkat. */
  operatorId?: string | null;
}

const TOKEN_KEY = "afvs.api.token";
const USER_KEY = "afvs.api.user";
const DEVICE_STATE_KEY = "afvs.device.state";

export type DeviceStatus = "unregistered" | "pending" | "approved" | "revoked";

/** Status izin perangkat ini di backend (lihat device.ts). */
export interface DeviceState {
  status: DeviceStatus;
  id?: string;
  code?: string;
  name?: string;
  station?: string | null;
  token?: string | null;
  expiresAt?: string | null;
}

function isBrowser() {
  return typeof window !== "undefined";
}

export function getApiBase(): string {
  const base = process.env.NEXT_PUBLIC_AFVS_API_BASE;
  return (base && base.trim()) || "http://localhost:3001/api";
}

// ─────────────────────────── Auth state ───────────────────────────

export function getToken(): string | null {
  if (!isBrowser()) return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

/**
 * Identitas backend yang dipakai saat ini: petugas yang login, atau — bila
 * tidak ada — perangkat yang diizinkan admin (role setara operator).
 */
export function getApiUser(): ApiUser | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    if (raw) return JSON.parse(raw) as ApiUser;
  } catch {
    /* data rusak → anggap tak ada petugas */
  }
  const device = getDeviceState();
  if (getDeviceToken() && device.id) {
    return {
      id: device.id,
      email: "",
      name: device.name ?? "Perangkat",
      role: "operator",
      station: device.station ?? null,
    };
  }
  return null;
}

export function isAuthed(): boolean {
  return Boolean(getToken() || getDeviceToken());
}

export function getDeviceState(): DeviceState {
  if (!isBrowser()) return { status: "unregistered" };
  try {
    const raw = window.localStorage.getItem(DEVICE_STATE_KEY);
    if (raw) return { status: "unregistered", ...(JSON.parse(raw) as Partial<DeviceState>) };
  } catch {
    /* state rusak → daftar ulang */
  }
  return { status: "unregistered" };
}

/** Simpan status perangkat; beri tahu UI & sinkronisasi bila akses berubah. */
export function setDeviceState(next: DeviceState) {
  if (!isBrowser()) return;
  const prevToken = getDeviceToken();
  window.localStorage.setItem(DEVICE_STATE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("afvs:device", { detail: next }));
  if (prevToken !== getDeviceToken()) notifyAuth();
}

export function subscribeDevice(cb: (s: DeviceState) => void): () => void {
  if (!isBrowser()) return () => {};
  const handler = () => cb(getDeviceState());
  window.addEventListener("afvs:device", handler);
  return () => window.removeEventListener("afvs:device", handler);
}

/** Token perangkat yang masih berlaku, atau null. */
export function getDeviceToken(): string | null {
  const s = getDeviceState();
  if (s.status !== "approved" || !s.token) return null;
  if (s.expiresAt && Date.parse(s.expiresAt) <= Date.now()) return null;
  return s.token;
}

function setAuth(token: string, user: ApiUser) {
  if (!isBrowser()) return;
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  notifyAuth();
}

export function clearAuth() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
  notifyAuth();
}

function notifyAuth() {
  if (!isBrowser()) return;
  window.dispatchEvent(new CustomEvent("afvs:api-auth"));
}

export function subscribeAuth(cb: () => void): () => void {
  if (!isBrowser()) return () => {};
  const handler = () => cb();
  window.addEventListener("afvs:api-auth", handler);
  return () => window.removeEventListener("afvs:api-auth", handler);
}

// ─────────────────────────── Helpers ───────────────────────────

async function readJson(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function errMsg(e: unknown): string {
  const err = e as Error;
  if (err?.name === "AbortError") return "Timeout — backend tidak merespons.";
  if (err?.message?.includes("Failed to fetch")) {
    return "Tidak bisa terhubung ke backend (offline / backend mati?).";
  }
  return err?.message || "Permintaan gagal.";
}

function httpError(status: number, body: unknown): string {
  const msg = (body as { message?: unknown })?.message;
  if (Array.isArray(msg)) return msg.join(", ");
  if (typeof msg === "string") return msg;
  if (status === 401) return "Sesi habis / belum login — silakan login ulang.";
  if (status === 403) return "Akses ditolak (role tidak cukup).";
  return `HTTP ${status}`;
}

/**
 * Fetch dengan auto Bearer token + auto-logout pada 401. `timeoutMs` → request
 * dibatalkan (AbortError) bila backend tidak merespons, supaya pemanggil
 * (mis. outbox) tidak menggantung selamanya.
 */
export async function authedFetch(
  path: string,
  init?: RequestInit,
  timeoutMs?: number,
): Promise<Response> {
  const userToken = getToken();
  const token = userToken ?? getDeviceToken();
  let res = await fetchWithToken(path, token, init, timeoutMs);
  if (res.status !== 401 || !token) return res;
  let usedDevice = !userToken;
  if (userToken) {
    // Token petugas habis → keluarkan, lalu coba sekali lagi atas nama
    // perangkat (bila diizinkan) supaya kiriman tidak tertahan.
    clearAuth();
    const deviceToken = getDeviceToken();
    if (deviceToken) {
      res = await fetchWithToken(path, deviceToken, init, timeoutMs);
      usedDevice = true;
    }
  }
  if (res.status === 401 && usedDevice) {
    // Token perangkat ditolak (dicabut / kedaluwarsa) → minta device.ts cek ulang.
    window.dispatchEvent(new CustomEvent("afvs:device-recheck"));
  }
  return res;
}

async function fetchWithToken(
  path: string,
  token: string | null,
  init: RequestInit | undefined,
  timeoutMs: number | undefined,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    return await fetch(`${getApiBase()}${path}`, {
      ...init,
      headers,
      signal: ctrl?.signal ?? init?.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─────────────────────────── Endpoints ───────────────────────────

export async function apiLogin(
  email: string,
  password: string,
): Promise<ApiResult<{ token: string; user: ApiUser }>> {
  if (!isBrowser()) return { ok: false, error: "Tidak bisa login dari server." };
  try {
    const res = await fetch(`${getApiBase()}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await readJson(res);
    if (!res.ok) {
      return { ok: false, status: res.status, error: httpError(res.status, body) };
    }
    const data = body as { token?: string; user?: ApiUser };
    if (data?.token && data?.user) {
      setAuth(data.token, data.user);
      return { ok: true, status: res.status, data: data as { token: string; user: ApiUser } };
    }
    return { ok: false, status: res.status, error: "Respons login tidak valid." };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function apiLoginPin(
  pin: string,
): Promise<ApiResult<{ token: string; user: ApiUser }>> {
  if (!isBrowser()) return { ok: false, error: "Tidak bisa login dari server." };
  try {
    const res = await fetch(`${getApiBase()}/auth/login-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    const body = await readJson(res);
    if (!res.ok) {
      return { ok: false, status: res.status, error: httpError(res.status, body) };
    }
    const data = body as { token?: string; user?: ApiUser };
    if (data?.token && data?.user) {
      setAuth(data.token, data.user);
      return { ok: true, status: res.status, data: data as { token: string; user: ApiUser } };
    }
    return { ok: false, status: res.status, error: "Respons login tidak valid." };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function apiMe(): Promise<ApiResult<ApiUser>> {
  try {
    const res = await authedFetch("/auth/me");
    const body = await readJson(res);
    if (!res.ok) return { ok: false, status: res.status, error: httpError(res.status, body) };
    return { ok: true, status: res.status, data: body as ApiUser };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

const API_MAX_PER_PAGE = 200; // sesuai cap backend (Math.min(200, …))

// P-16: dedup GET in-flight — panggilan identik yang bersamaan (mis. poll 60 dtk
// bertemu refresh manual / beberapa komponen) berbagi SATU request, bukan
// masing-masing menembak network. Promise dihapus saat selesai.
const inflightGet = new Map<string, Promise<unknown>>();
function dedupGet<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = inflightGet.get(key);
  if (hit) return hit as Promise<T>;
  const p = fn().finally(() => inflightGet.delete(key));
  inflightGet.set(key, p);
  return p;
}

export async function apiListFlights(params: {
  station?: string;
  date?: string;
  status?: string;
  page?: number;
  perPage?: number;
}): Promise<ApiResult<Paginated<ApiFlight>>> {
  const qs = new URLSearchParams();
  if (params.station) qs.set("station", params.station);
  if (params.date) qs.set("date", params.date);
  if (params.status) qs.set("status", params.status);
  if (params.page) qs.set("page", String(params.page));
  if (params.perPage) qs.set("perPage", String(params.perPage));
  const path = `/flights?${qs.toString()}`;
  return dedupGet(path, async () => {
    try {
      const res = await authedFetch(path);
      const body = await readJson(res);
      if (!res.ok)
        return { ok: false, status: res.status, error: httpError(res.status, body) };
      return { ok: true, status: res.status, data: body as Paginated<ApiFlight> };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });
}

/**
 * P-16: tarik SEMUA halaman flights (backend cap perPage=200) lalu gabung —
 * hindari kehilangan data >200 secara diam-diam.
 */
export async function apiListAllFlights(params: {
  station?: string;
  date?: string;
  status?: string;
}): Promise<ApiResult<Paginated<ApiFlight>>> {
  const all: ApiFlight[] = [];
  let total = 0;
  for (let page = 1; page <= 50; page++) {
    const res = await apiListFlights({ ...params, page, perPage: API_MAX_PER_PAGE });
    if (!res.ok || !res.data) return res;
    all.push(...res.data.items);
    total = res.data.total;
    if (res.data.items.length === 0 || all.length >= total) break;
  }
  return { ok: true, status: 200, data: { items: all, page: 1, perPage: all.length, total } };
}

/** Satu jadwal untuk di-upsert ke backend (snapshot harian / FIDS). */
export interface FlightSyncPayload {
  flightNumber: string;
  airlineCode: string;
  origin: string;
  destination: string;
  std: string; // ISO
  status: string; // SCHEDULED | OPEN | ACTIVE | CLOSED | CANCELLED
  station: string;
}

/**
 * Simpan snapshot jadwal harian ke backend (tabel Flight, upsert idempotent
 * by station+flightNumber+std). Dipakai saat tarik FIDS agar jadwalnya jadi
 * riwayat permanen, bukan cuma di localStorage.
 */
export async function apiSyncFlights(
  flights: FlightSyncPayload[],
): Promise<ApiResult<{ ok: boolean; synced: number }>> {
  if (flights.length === 0) {
    return { ok: true, data: { ok: true, synced: 0 } };
  }
  try {
    const res = await authedFetch("/flights/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flights }),
    });
    const body = await readJson(res);
    if (!res.ok)
      return { ok: false, status: res.status, error: httpError(res.status, body) };
    return { ok: true, status: res.status, data: body as { ok: boolean; synced: number } };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** Batas tunggu push satu scan (termasuk foto wajah ≤1 MB). */
const PUSH_TIMEOUT_MS = 20_000;

/** Push satu scan event (multipart, idempotent by eventId). */
export async function apiPushScan(
  fields: ScanPushFields,
  faceBlob: Blob | null,
): Promise<ApiResult<unknown>> {
  try {
    const fd = new FormData();
    fd.set("eventId", fields.eventId);
    fd.set("rawBarcode", fields.rawBarcode);
    if (fields.flightNumber) fd.set("flightNumber", fields.flightNumber);
    if (fields.pnr) fd.set("pnr", fields.pnr);
    if (fields.ticketNumber) fd.set("ticketNumber", fields.ticketNumber);
    if (fields.seat) fd.set("seat", fields.seat);
    if (fields.passengerName) fd.set("passengerName", fields.passengerName);
    fd.set("resultStatus", fields.resultStatus);
    if (fields.message) fd.set("message", fields.message);
    fd.set("scannedAt", fields.scannedAt);
    fd.set("station", fields.station || "UNKNOWN");
    if (fields.ktpStatus) fd.set("ktpStatus", fields.ktpStatus);
    if (fields.ktpName) fd.set("ktpName", fields.ktpName);
    if (fields.ktpSimilarity != null)
      fd.set("ktpSimilarity", String(fields.ktpSimilarity));
    if (fields.ktpCapturedAt) fd.set("ktpCapturedAt", fields.ktpCapturedAt);
    if (fields.operatorId) fd.set("operatorId", fields.operatorId);
    if (faceBlob) fd.set("facePhoto", faceBlob, `${fields.eventId}.jpg`);

    const res = await authedFetch(
      "/scan-events",
      { method: "POST", body: fd },
      PUSH_TIMEOUT_MS,
    );
    const body = await readJson(res);
    if (!res.ok) return { ok: false, status: res.status, error: httpError(res.status, body) };
    return { ok: true, status: res.status, data: body };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** Keputusan petugas cek KTP/SIM untuk scan yang sudah ter-push (idempoten). */
export async function apiDecideIdentity(
  eventId: string,
  decision: { match: boolean; decidedAt: string },
): Promise<ApiResult<unknown>> {
  try {
    const res = await authedFetch(
      `/scan-events/${encodeURIComponent(eventId)}/identity`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(decision),
      },
      PUSH_TIMEOUT_MS,
    );
    const body = await readJson(res);
    if (!res.ok) return { ok: false, status: res.status, error: httpError(res.status, body) };
    return { ok: true, status: res.status, data: body };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

// ─────────────────────────── Kartu Pas Bandara (karyawan) ────────────────

export type PasStatus = "VALID" | "EXPIRED" | "NOT_FOUND" | "ERROR";

export interface PasCard {
  name: string | null;
  position: string | null;
  company: string | null;
  category: string | null;
  categoryNote: string | null;
  pasNumber: string | null;
  cardColor: string | null;
  cardColorCss: string | null;
  passType: string | null;
  issuedAt: string | null; // YYYY-MM-DD
  validUntil: string | null; // YYYY-MM-DD
  areaCodes: string[];
  photoUrl: string | null;
}

export interface PasVerifyResult {
  id: string;
  pasId: string;
  status: PasStatus;
  message: string;
  card: PasCard | null;
  checkedAt: string;
}

/** Backend menunggu server PAS maks. 8 dtk — beri ruang di atasnya. */
const PAS_VERIFY_TIMEOUT_MS = 15_000;

/** Cek kartu PAS dari isi QR-nya; backend yang mengambil halaman validasi. */
export async function apiVerifyPas(input: {
  raw: string;
  operatorId?: string | null;
  station?: string | null;
}): Promise<ApiResult<PasVerifyResult>> {
  try {
    const res = await authedFetch(
      "/pas/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw: input.raw,
          operatorId: input.operatorId ?? undefined,
          station: input.station ?? undefined,
        }),
      },
      PAS_VERIFY_TIMEOUT_MS,
    );
    const body = await readJson(res);
    if (!res.ok) return { ok: false, status: res.status, error: httpError(res.status, body) };
    return { ok: true, status: res.status, data: body as PasVerifyResult };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export interface ApiPasScan {
  id: string;
  pasId: string;
  status: PasStatus;
  pasNumber: string | null;
  name: string | null;
  position: string | null;
  company: string | null;
  category: string | null;
  cardColor: string | null;
  passType: string | null;
  issuedAt: string | null;
  validUntil: string | null;
  areaCodes: string | null;
  station: string;
  operatorId: string;
  operator?: { name: string } | null;
  deviceId: string | null;
  createdAt: string;
}

export async function apiListPasScans(params: {
  station?: string;
  date?: string;
  status?: string;
  page?: number;
  perPage?: number;
}): Promise<ApiResult<Paginated<ApiPasScan>>> {
  const qs = new URLSearchParams();
  if (params.station) qs.set("station", params.station);
  if (params.date) qs.set("date", params.date);
  if (params.status) qs.set("status", params.status);
  if (params.page) qs.set("page", String(params.page));
  if (params.perPage) qs.set("perPage", String(params.perPage));
  const path = `/pas/scans?${qs.toString()}`;
  return dedupGet(path, async () => {
    try {
      const res = await authedFetch(path);
      const body = await readJson(res);
      if (!res.ok)
        return { ok: false, status: res.status, error: httpError(res.status, body) };
      return { ok: true, status: res.status, data: body as Paginated<ApiPasScan> };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });
}

export interface ApiScanEvent {
  id: string;
  eventId: string;
  rawBarcode: string;
  flightNumber: string | null;
  pnr: string | null;
  ticketNumber: string | null;
  seat: string | null;
  passengerName: string | null;
  resultStatus: string;
  message: string | null;
  scannedAt: string;
  station: string;
  facePhotoPath: string | null;
  ktpStatus: string | null;
  ktpName: string | null;
  ktpSimilarity: number | null;
  flightId: string | null;
  operatorId: string;
  createdAt: string;
}

export async function apiListScans(params: {
  station?: string;
  date?: string;
  resultStatus?: string;
  flightNumber?: string;
  page?: number;
  perPage?: number;
}): Promise<ApiResult<Paginated<ApiScanEvent>>> {
  const qs = new URLSearchParams();
  if (params.station) qs.set("station", params.station);
  if (params.date) qs.set("date", params.date);
  if (params.resultStatus) qs.set("resultStatus", params.resultStatus);
  if (params.flightNumber) qs.set("flightNumber", params.flightNumber);
  if (params.page) qs.set("page", String(params.page));
  if (params.perPage) qs.set("perPage", String(params.perPage));
  const path = `/scan-events?${qs.toString()}`;
  return dedupGet(path, async () => {
    try {
      const res = await authedFetch(path);
      const body = await readJson(res);
      if (!res.ok)
        return { ok: false, status: res.status, error: httpError(res.status, body) };
      return { ok: true, status: res.status, data: body as Paginated<ApiScanEvent> };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });
}

/**
 * P-16: tarik SEMUA halaman scan-events (backend cap perPage=200) lalu gabung —
 * hindari kehilangan data >200 secara diam-diam.
 */
export async function apiListAllScans(params: {
  station?: string;
  date?: string;
  resultStatus?: string;
  flightNumber?: string;
}): Promise<ApiResult<Paginated<ApiScanEvent>>> {
  const all: ApiScanEvent[] = [];
  let total = 0;
  for (let page = 1; page <= 50; page++) {
    const res = await apiListScans({ ...params, page, perPage: API_MAX_PER_PAGE });
    if (!res.ok || !res.data) return res;
    all.push(...res.data.items);
    total = res.data.total;
    if (res.data.items.length === 0 || all.length >= total) break;
  }
  return { ok: true, status: 200, data: { items: all, page: 1, perPage: all.length, total } };
}

// ─────────────────────────── Manifest penumpang per-flight ───────────────

export interface ApiFlightPassenger {
  id: string;
  flightId: string;
  dedupKey: string;
  pnr: string | null;
  ticketNumber: string | null;
  seat: string | null;
  passengerName: string | null;
  firstScannedAt: string; // ISO
  lastScannedAt: string; // ISO
  scanCount: number;
  boarded: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Manifest penumpang sebuah flight dari backend (agregat scan VALID, sumber
 * kebenaran lintas-device). Scoping per-station/role diterapkan server (F-05).
 */
export async function apiFlightPassengers(
  flightId: string,
): Promise<ApiResult<{ items: ApiFlightPassenger[]; count: number }>> {
  const path = `/flights/${flightId}/passengers`;
  return dedupGet(path, async () => {
    try {
      const res = await authedFetch(path);
      const body = await readJson(res);
      if (!res.ok)
        return { ok: false, status: res.status, error: httpError(res.status, body) };
      return {
        ok: true,
        status: res.status,
        data: body as { items: ApiFlightPassenger[]; count: number },
      };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });
}

export interface ApiAirlineRollup {
  airlineCode: string;
  passengers: number;
  flights: number;
  flightsDetail: Array<{
    flightId: string;
    flightNumber: string;
    std: string;
    passengers: number;
  }>;
}

export interface ApiByAirlineReport {
  range: { from: string; to: string };
  totals: { passengers: number; flights: number; airlines: number };
  airlines: ApiAirlineRollup[];
}

/**
 * Rekap penumpang per maskapai dari backend. `date` (1 hari) atau `from`+`to`.
 * `detail` = sertakan rincian penerbangan per maskapai.
 */
export async function apiManifestByAirline(params: {
  date?: string;
  from?: string;
  to?: string;
  detail?: boolean;
}): Promise<ApiResult<ApiByAirlineReport>> {
  const qs = new URLSearchParams();
  if (params.date) qs.set("date", params.date);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.detail) qs.set("detail", "1");
  const path = `/flights/manifests/by-airline?${qs.toString()}`;
  return dedupGet(path, async () => {
    try {
      const res = await authedFetch(path);
      const body = await readJson(res);
      if (!res.ok)
        return { ok: false, status: res.status, error: httpError(res.status, body) };
      return { ok: true, status: res.status, data: body as ApiByAirlineReport };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });
}

/** Backfill/rebuild manifest dari ScanEvent historis (admin). Tanggal opsional. */
export async function apiRebuildManifests(
  date?: string,
): Promise<ApiResult<{ ok: boolean; flights: number; passengers: number }>> {
  try {
    const qs = date ? `?date=${encodeURIComponent(date)}` : "";
    const res = await authedFetch(`/flights/manifests/rebuild${qs}`, {
      method: "POST",
    });
    const body = await readJson(res);
    if (!res.ok)
      return { ok: false, status: res.status, error: httpError(res.status, body) };
    return {
      ok: true,
      status: res.status,
      data: body as { ok: boolean; flights: number; passengers: number },
    };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

// ─────────────────────────── Operators (admin) ───────────────────────────

export interface ApiOperator {
  id: string;
  email: string;
  name: string;
  role: string; // operator | supervisor | admin
  station: string | null;
  active: boolean;
  hasPin: boolean;
  hasPhoto: boolean; // foto petugas sudah di-upload (disajikan via GET /operators/:id/photo)
  createdAt: string;
  updatedAt: string;
}

export interface CreateOperatorInput {
  name: string;
  email?: string;
  role?: string;
  station?: string;
  pin?: string; // kosong = PIN acak
  password?: string;
}

/** Hasil create: PIN (dan password bila digenerate) hanya muncul SEKALI di sini. */
export interface CreateOperatorResult {
  operator: ApiOperator;
  pin: string;
  password?: string;
}

export async function apiListOperators(params?: {
  station?: string;
  role?: string;
  q?: string;
}): Promise<ApiResult<{ items: ApiOperator[] }>> {
  try {
    const qs = new URLSearchParams();
    if (params?.station) qs.set("station", params.station);
    if (params?.role) qs.set("role", params.role);
    if (params?.q) qs.set("q", params.q);
    const res = await authedFetch(`/operators?${qs.toString()}`);
    const body = await readJson(res);
    if (!res.ok) return { ok: false, status: res.status, error: httpError(res.status, body) };
    return { ok: true, status: res.status, data: body as { items: ApiOperator[] } };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function apiCreateOperator(
  input: CreateOperatorInput,
): Promise<ApiResult<CreateOperatorResult>> {
  try {
    const res = await authedFetch("/operators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await readJson(res);
    if (!res.ok) return { ok: false, status: res.status, error: httpError(res.status, body) };
    return { ok: true, status: res.status, data: body as CreateOperatorResult };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function apiUpdateOperator(
  id: string,
  patch: Partial<Pick<ApiOperator, "name" | "email" | "role" | "station" | "active">>,
): Promise<ApiResult<ApiOperator>> {
  try {
    const res = await authedFetch(`/operators/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await readJson(res);
    if (!res.ok) return { ok: false, status: res.status, error: httpError(res.status, body) };
    return { ok: true, status: res.status, data: body as ApiOperator };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** Set/reset PIN. Kirim pin kosong → server generate acak. Return PIN plaintext. */
export async function apiSetOperatorPin(
  id: string,
  pin?: string,
): Promise<ApiResult<{ pin: string }>> {
  try {
    const res = await authedFetch(`/operators/${id}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pin ? { pin } : {}),
    });
    const body = await readJson(res);
    if (!res.ok) return { ok: false, status: res.status, error: httpError(res.status, body) };
    return { ok: true, status: res.status, data: body as { pin: string } };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function apiDeleteOperator(
  id: string,
): Promise<ApiResult<{ ok: true }>> {
  try {
    const res = await authedFetch(`/operators/${id}`, { method: "DELETE" });
    const body = await readJson(res);
    if (!res.ok) return { ok: false, status: res.status, error: httpError(res.status, body) };
    return { ok: true, status: res.status, data: body as { ok: true } };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** Upload/ganti foto petugas (multipart). Return operator terbaru (hasPhoto: true). */
export async function apiSetOperatorPhoto(
  id: string,
  file: File | Blob,
): Promise<ApiResult<ApiOperator>> {
  try {
    const fd = new FormData();
    // Sertakan nama asli (dengan ekstensi) agar server simpan ext benar &
    // serve Content-Type yang cocok. Blob tanpa nama → tebak dari MIME type.
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const filename = file instanceof File && file.name ? file.name : `photo.${ext}`;
    fd.set("photo", file, filename);
    const res = await authedFetch(`/operators/${id}/photo`, {
      method: "POST",
      body: fd,
    });
    const body = await readJson(res);
    if (!res.ok) return { ok: false, status: res.status, error: httpError(res.status, body) };
    return { ok: true, status: res.status, data: body as ApiOperator };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** Hapus foto petugas. Return operator terbaru (hasPhoto: false). */
export async function apiDeleteOperatorPhoto(
  id: string,
): Promise<ApiResult<ApiOperator>> {
  try {
    const res = await authedFetch(`/operators/${id}/photo`, { method: "DELETE" });
    const body = await readJson(res);
    if (!res.ok) return { ok: false, status: res.status, error: httpError(res.status, body) };
    return { ok: true, status: res.status, data: body as ApiOperator };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** Ambil foto petugas (auth-gated) sebagai object URL untuk <img>. Null jika tak ada. */
export async function getOperatorPhotoObjectUrl(
  id: string,
): Promise<string | null> {
  try {
    const res = await authedFetch(`/operators/${id}/photo`);
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/** Ambil foto wajah (auth-gated) sebagai object URL untuk <img>. Null jika tak ada. */
export async function getFacePhotoObjectUrl(
  eventId: string,
): Promise<string | null> {
  try {
    const res = await authedFetch(`/face-photos/${eventId}`);
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/** Cek backend hidup lewat GET /health (publik, tanpa throttle). */
export async function apiHealth(timeoutMs = 5_000): Promise<ApiResult<true>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // GET polos = CORS "simple request" (tanpa preflight). Metode OPTIONS
    // lintas-origin selalu ditolak preflight, jadi tidak bisa dipakai di sini.
    const res = await fetch(`${getApiBase()}/health`, {
      cache: "no-store",
      signal: ctrl.signal,
    });
    // Server hidup kalau merespons apa pun (termasuk 404/405).
    return { ok: true, status: res.status, data: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────── Pengaturan global ───────────────────────────

export interface ApiAppSettings {
  /** null = belum pernah disimpan di backend. */
  data: Record<string, unknown> | null;
  updatedAt: string | null;
}

export async function apiGetAppSettings(timeoutMs = 10_000): Promise<ApiResult<ApiAppSettings>> {
  try {
    const res = await authedFetch("/settings", { cache: "no-store" }, timeoutMs);
    const body = await readJson(res);
    if (!res.ok) return { ok: false, status: res.status, error: httpError(res.status, body) };
    return { ok: true, status: res.status, data: body as ApiAppSettings };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function apiPutAppSettings(
  data: Record<string, unknown>,
  timeoutMs = 10_000,
): Promise<ApiResult<ApiAppSettings>> {
  try {
    const res = await authedFetch(
      "/settings",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      },
      timeoutMs,
    );
    const body = await readJson(res);
    if (!res.ok) return { ok: false, status: res.status, error: httpError(res.status, body) };
    return { ok: true, status: res.status, data: body as ApiAppSettings };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

// ─────────────────────────── Log aktivitas (admin) ───────────────────────────

export type ActivityCategory =
  | "auth"
  | "operator"
  | "flight"
  | "settings"
  | "device"
  | "system";

export interface ApiActivityLog {
  id: string;
  at: string; // ISO
  operatorId: string | null;
  operatorName: string | null;
  operatorEmail: string | null;
  operatorRole: string | null;
  action: string;
  category: ActivityCategory;
  description: string;
  method: string;
  path: string;
  statusCode: number;
  success: boolean;
  targetId: string | null;
  ip: string | null;
  userAgent: string | null;
  durationMs: number;
  meta: { fields?: string[]; error?: string } | null;
}

export interface ApiActivitySummary {
  today: number;
  failedToday: number;
  failedLogins24h: number;
  activeUsersToday: number;
  byCategory: { category: ActivityCategory; count: number }[];
  topActors: { operatorId: string; name: string | null; role: string | null; count: number }[];
  /** Bucket per jam: `hour` = epoch-jam (ms / 3_600_000). */
  hourly: { hour: number; count: number }[];
}

export interface ActivityLogFilter {
  q?: string;
  category?: string;
  operatorId?: string;
  status?: "success" | "failed";
  from?: string; // ISO
  to?: string; // ISO
  page?: number;
  perPage?: number;
}

export async function apiListActivityLogs(
  filter: ActivityLogFilter,
): Promise<ApiResult<Paginated<ApiActivityLog>>> {
  try {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filter)) {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    }
    const res = await authedFetch(`/activity-logs?${qs.toString()}`, { cache: "no-store" }, 15_000);
    const body = await readJson(res);
    if (!res.ok) return { ok: false, status: res.status, error: httpError(res.status, body) };
    return { ok: true, status: res.status, data: body as Paginated<ApiActivityLog> };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function apiActivitySummary(
  todayStart: string,
): Promise<ApiResult<ApiActivitySummary>> {
  try {
    const qs = new URLSearchParams({ todayStart });
    const res = await authedFetch(`/activity-logs/summary?${qs}`, { cache: "no-store" }, 15_000);
    const body = await readJson(res);
    if (!res.ok) return { ok: false, status: res.status, error: httpError(res.status, body) };
    return { ok: true, status: res.status, data: body as ApiActivitySummary };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function apiActivityActors(): Promise<
  ApiResult<{ items: { operatorId: string; name: string | null }[] }>
> {
  try {
    const res = await authedFetch("/activity-logs/actors", { cache: "no-store" }, 15_000);
    const body = await readJson(res);
    if (!res.ok) return { ok: false, status: res.status, error: httpError(res.status, body) };
    return {
      ok: true,
      status: res.status,
      data: body as { items: { operatorId: string; name: string | null }[] },
    };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

// ─────────────────────────── Perangkat (admin) ───────────────────────────

export interface ApiDevice {
  id: string;
  name: string;
  station: string | null;
  status: "pending" | "approved" | "revoked";
  code: string;
  userAgent: string | null;
  lastIp: string | null;
  lastSeenAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  scanCount: number;
}

async function deviceRequest<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await authedFetch(path, init);
    const body = await readJson(res);
    if (!res.ok) return { ok: false, status: res.status, error: httpError(res.status, body) };
    return { ok: true, status: res.status, data: body as T };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export function apiListDevices() {
  return deviceRequest<{ items: ApiDevice[] }>("/devices", { cache: "no-store" });
}

export function apiApproveDevice(id: string, input: { name?: string; station: string }) {
  return deviceRequest<ApiDevice>(`/devices/${id}/approve`, jsonInit("POST", input));
}

export function apiUpdateDevice(id: string, patch: { name?: string; station?: string }) {
  return deviceRequest<ApiDevice>(`/devices/${id}`, jsonInit("PATCH", patch));
}

export function apiRevokeDevice(id: string) {
  return deviceRequest<ApiDevice>(`/devices/${id}/revoke`, jsonInit("POST"));
}

export function apiDeleteDevice(id: string) {
  return deviceRequest<{ ok: boolean }>(`/devices/${id}`, { method: "DELETE" });
}
