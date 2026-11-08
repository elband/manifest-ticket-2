/**
 * Zona waktu operasional bandara (APT Pranoto, WITA = UTC+8).
 *
 * `scannedAt` disimpan sebagai instant UTC asli, sedangkan `flight.std`
 * disimpan sebagai jam lokal "naif" berakhiran Z (lihat toSyncPayload di
 * frontend). Jadi:
 *  - hari kalender sebuah scan  → `witaDateKey(scannedAt)`
 *  - rentang `scannedAt` sehari → `witaDayRange(date)`
 *  - rentang `std` sehari       → tetap `${date}T00:00:00Z` … `T23:59:59.999Z`
 * Memakai batas UTC untuk scan membuat "hari" baru berganti pukul 08.00 WITA.
 */
export const OPS_TZ = "Asia/Makassar";
const OPS_OFFSET = "+08:00";

/** Tanggal kalender WITA (YYYY-MM-DD) dari sebuah instant. */
export function witaDateKey(at: Date | string = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}

/** Rentang instant (inklusif) untuk satu hari kalender WITA. */
export function witaDayRange(date: string): { gte: Date; lte: Date } {
  return {
    gte: new Date(`${date}T00:00:00.000${OPS_OFFSET}`),
    lte: new Date(`${date}T23:59:59.999${OPS_OFFSET}`),
  };
}

/** Rentang `flight.std` (jam lokal naif) untuk satu hari kalender. */
export function naiveDayRange(date: string): { gte: Date; lte: Date } {
  return {
    gte: new Date(`${date}T00:00:00.000Z`),
    lte: new Date(`${date}T23:59:59.999Z`),
  };
}
