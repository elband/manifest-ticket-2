"use client";

export type Locale = "id" | "en";
export type ThemeMode = "airport" | "dark";
export type SikerenSyncMode = "auto" | "manual";

export interface AppSettings {
  soundOn: boolean;
  hapticOn: boolean;
  locale: Locale;
  theme: ThemeMode;
  flightListShowOnlyToday: boolean;
  autoClosePastDayFlights: boolean;
  boardingOpenEnabled: boolean;
  boardingOpenMinutesBefore: number;
  boardingActiveEnabled: boolean;
  boardingActiveMinutesBefore: number;
  boardingCloseEnabled: boolean;
  boardingCloseMinutesAfter: number;
  faceCaptureEnabled: boolean;
  faceCameraDeviceId: string | null;
  /** Kamera untuk scanner barcode (CameraScanner). null = kamera belakang default. */
  scannerCameraDeviceId: string | null;
  kioskAutoEnter: boolean;
  requireFaceForScan: boolean;
  sikerenEnabled: boolean;
  sikerenEndpoint: string;
  sikerenApiKey: string;
  sikerenSyncMode: SikerenSyncMode;
  sikerenStation: string;
  /** Sinkronisasi scan & flight ke backend AFVS (NestJS). */
  apiSyncEnabled: boolean;
  /** Auto-tarik jadwal keberangkatan dari FIDS bandara tiap beberapa menit. */
  fidsAutoSync: boolean;
  ktpVerifyEnabled: boolean;
  ktpAutoPassThreshold: number;
  ktpManualThreshold: number;
  ktpSavePhoto: boolean;
  ktpRequireForValid: boolean;
  /** Mode kiosk "KTP dulu": kamera memindai KTP lebih dulu, lalu boarding pass
   *  dicocokkan ke nama KTP. Tanpa capture wajah. */
  ktpScanFirst: boolean;
  /** Izinkan jalur "Tanpa KTP" di mode KTP-first — 1 tap + audit. */
  allowNoKtpExemption: boolean;
  /** Jenis dokumen identitas yang dibaca di KTP-first: "ktp" | "sim" | "id". */
  idDocType: "ktp" | "sim" | "id";
  /** Lama card hasil scan (data penumpang) tampil di kiosk, dalam detik.
   *  0 = tanpa batas waktu (tetap tampil sampai ditutup / scan berikutnya). */
  kioskResultDurationSec: number;
}

/** Pilihan lama tampil card hasil scan kiosk (detik). 0 = tanpa batas waktu. */
export const KIOSK_RESULT_DURATION_OPTIONS = [3, 5, 6, 10, 15, 20, 30, 60, 0] as const;

const KEY = "afvs.settings";

/**
 * Setelan boarding rekomendasi untuk POS PENDATAAN PRA X-RAY (mode hybrid):
 * scan dibuka lama (4 jam sebelum STD), final call dimatikan, penutupan utama
 * mengikuti papan FIDS ("Departured") dengan pengaman waktu STD+30. Dipakai
 * sebagai default DAN oleh tombol "Reset boarding ke rekomendasi" di Pengaturan.
 */
export type BoardingSettings = Pick<
  AppSettings,
  | "boardingOpenEnabled"
  | "boardingOpenMinutesBefore"
  | "boardingActiveEnabled"
  | "boardingActiveMinutesBefore"
  | "boardingCloseEnabled"
  | "boardingCloseMinutesAfter"
>;

export const RECOMMENDED_BOARDING: BoardingSettings = {
  boardingOpenEnabled: true,
  boardingOpenMinutesBefore: 240,
  boardingActiveEnabled: false,
  boardingActiveMinutesBefore: 30,
  boardingCloseEnabled: true,
  boardingCloseMinutesAfter: 30,
};

const DEFAULTS: AppSettings = {
  soundOn: true,
  hapticOn: true,
  locale: "id",
  theme: "airport",
  flightListShowOnlyToday: true,
  autoClosePastDayFlights: true,
  // Pos pendataan pra X-ray (mode hybrid) — lihat RECOMMENDED_BOARDING.
  ...RECOMMENDED_BOARDING,
  faceCaptureEnabled: true,
  faceCameraDeviceId: null,
  scannerCameraDeviceId: null,
  kioskAutoEnter: false,
  requireFaceForScan: true,
  sikerenEnabled: false,
  sikerenEndpoint: "",
  sikerenApiKey: "",
  sikerenSyncMode: "auto",
  sikerenStation: "",
  apiSyncEnabled: false,
  fidsAutoSync: true,
  ktpVerifyEnabled: false,
  ktpAutoPassThreshold: 0.85,
  ktpManualThreshold: 0.6,
  ktpSavePhoto: false,
  ktpRequireForValid: false,
  ktpScanFirst: false,
  allowNoKtpExemption: true,
  idDocType: "ktp",
  kioskResultDurationSec: 6,
};

function isBrowser() {
  return typeof window !== "undefined";
}

export function getSettings(): AppSettings {
  if (!isBrowser()) return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

/**
 * Setelan khusus perangkat — TIDAK ikut disinkronkan ke backend:
 * kamera berbeda di tiap perangkat, `apiSyncEnabled` mengikuti login
 * backend perangkat itu sendiri, dan tema serta suara feedback dipilih
 * bebas per perangkat. Selain ini, semua setelan berlaku global
 * (lihat settingsSync.ts).
 */
export const DEVICE_LOCAL_KEYS: readonly (keyof AppSettings)[] = [
  "faceCameraDeviceId",
  "scannerCameraDeviceId",
  "apiSyncEnabled",
  "theme",
  "soundOn",
];

/** Bagian setelan yang dibagi ke semua perangkat lewat backend. */
export function getSharedSettings(s: AppSettings = getSettings()): Partial<AppSettings> {
  const out: Record<string, unknown> = { ...s };
  for (const k of DEVICE_LOCAL_KEYS) delete out[k];
  return out as Partial<AppSettings>;
}

/** Ambil hanya kunci yang dikenal & bukan khusus perangkat dari data backend. */
export function pickSharedSettings(data: Record<string, unknown>): Partial<AppSettings> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULTS) as (keyof AppSettings)[]) {
    if (DEVICE_LOCAL_KEYS.includes(k) || !(k in data)) continue;
    out[k] = data[k];
  }
  return out as Partial<AppSettings>;
}

/**
 * Simpan setelan. Perubahan setelan global oleh pengguna memicu event
 * `afvs:settings-local` supaya settingsSync mendorongnya ke backend;
 * `fromRemote` dipakai saat menerapkan setelan yang ditarik dari backend.
 */
export function saveSettings(
  patch: Partial<AppSettings>,
  opts?: { fromRemote?: boolean },
) {
  if (!isBrowser()) return;
  const prev = getSettings();
  const next = { ...prev, ...patch };
  window.localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("afvs:settings", { detail: next }));
  if (opts?.fromRemote) return;
  const sharedChanged = (Object.keys(patch) as (keyof AppSettings)[]).some(
    (k) => !DEVICE_LOCAL_KEYS.includes(k) && prev[k] !== next[k],
  );
  if (sharedChanged) window.dispatchEvent(new CustomEvent("afvs:settings-local"));
}

export function subscribeSettings(cb: (s: AppSettings) => void): () => void {
  if (!isBrowser()) return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<AppSettings>).detail;
    cb(detail ?? getSettings());
  };
  window.addEventListener("afvs:settings", handler);
  return () => window.removeEventListener("afvs:settings", handler);
}
