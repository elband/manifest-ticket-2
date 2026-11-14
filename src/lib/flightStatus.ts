import { AppSettings } from "./settings";
import { Flight, FlightStatus } from "./types";

export type EffectiveReason =
  | "MANUAL"
  | "CANCELLED"
  | "PAST_DAY"
  | "FUTURE_DAY"
  | "IN_OPEN_WINDOW"
  | "IN_ACTIVE_WINDOW"
  | "AFTER_CLOSE";

export interface EffectiveStatus {
  status: FlightStatus;
  reason: EffectiveReason;
  /** Minutes from departure to `now`. Negative = future, positive = past. */
  minutesFromDeparture: number;
  /** Description in Indonesian, suitable for tooltip/badge subtext. */
  description: string;
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function departureTimestamp(flight: Flight): number {
  const [hh, mm] = flight.departureTime.split(":").map((p) => parseInt(p, 10));
  const [y, mo, d] = flight.departureDate.split("-").map((p) => parseInt(p, 10));
  if (
    !Number.isFinite(hh) ||
    !Number.isFinite(mm) ||
    !Number.isFinite(y) ||
    !Number.isFinite(mo) ||
    !Number.isFinite(d)
  ) {
    return NaN;
  }
  return new Date(y, mo - 1, d, hh, mm, 0, 0).getTime();
}

function formatHHmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

/**
 * Derive the effective flight status by combining the saved status with the
 * current time and the configured boarding windows.
 *
 * Manual override rules:
 *  - CANCELLED always wins.
 *  - DRAFT stays DRAFT (must be promoted manually).
 *  - CLOSED set by a human stays CLOSED — never auto-reopen.
 *  - OPEN / ACTIVE saved values are downgraded to CLOSED if the time window
 *    has passed (gate is shut), or to DRAFT if the user pre-opened too early.
 */
export function getEffectiveFlightStatus(
  flight: Flight,
  now: Date,
  settings: Pick<
    AppSettings,
    | "boardingActiveEnabled"
    | "boardingActiveMinutesBefore"
    | "boardingCloseEnabled"
    | "boardingCloseMinutesAfter"
  >,
): EffectiveStatus {
  if (flight.status === "CANCELLED") {
    return {
      status: "CANCELLED",
      reason: "CANCELLED",
      minutesFromDeparture: 0,
      description: "Flight dibatalkan.",
    };
  }

  const todayKey = dateKey(now);

  if (flight.departureDate < todayKey) {
    return {
      status: flight.status === "DRAFT" ? "DRAFT" : "CLOSED",
      reason: "PAST_DAY",
      minutesFromDeparture: 24 * 60,
      description: "Jadwal sudah lewat hari ini.",
    };
  }

  if (flight.departureDate > todayKey) {
    return {
      status: "DRAFT",
      reason: "FUTURE_DAY",
      minutesFromDeparture: -24 * 60,
      description: `Belum jadwal hari ini (${flight.departureDate}).`,
    };
  }

  const stdTs = departureTimestamp(flight);
  if (!Number.isFinite(stdTs)) {
    return {
      status: flight.status,
      reason: "MANUAL",
      minutesFromDeparture: 0,
      description: "Status manual (waktu tidak valid).",
    };
  }

  const minutesFromDeparture = Math.round((now.getTime() - stdTs) / 60000);

  if (flight.status === "DRAFT") {
    return {
      status: "DRAFT",
      reason: "MANUAL",
      minutesFromDeparture,
      description: "Belum dipublikasikan (DRAFT).",
    };
  }

  if (flight.status === "CLOSED") {
    return {
      status: "CLOSED",
      reason: "MANUAL",
      minutesFromDeparture,
      description: "Ditutup manual oleh supervisor.",
    };
  }

  const activeEnabled = settings.boardingActiveEnabled !== false;
  const closeEnabled = settings.boardingCloseEnabled !== false;

  const activeBefore = Math.max(0, settings.boardingActiveMinutesBefore);
  const closeAfter = Math.max(0, settings.boardingCloseMinutesAfter);

  // Tidak ada jendela "buka boarding": flight hari ini langsung OPEN sejak awal
  // hari — penumpang yang datang jauh sebelum STD tetap bisa di-scan.

  // Final call off → tetap OPEN sampai close window tercapai (atau tak terbatas).
  if (!activeEnabled) {
    if (closeEnabled && minutesFromDeparture > closeAfter) {
      return {
        status: "CLOSED",
        reason: "AFTER_CLOSE",
        minutesFromDeparture,
        description: `Gate sudah ditutup (${minutesFromDeparture} menit setelah STD).`,
      };
    }
    return {
      status: "OPEN",
      reason: "IN_OPEN_WINDOW",
      minutesFromDeparture,
      description: "Boarding terbuka — final call otomatis dinonaktifkan.",
    };
  }

  if (minutesFromDeparture < -activeBefore) {
    return {
      status: "OPEN",
      reason: "IN_OPEN_WINDOW",
      minutesFromDeparture,
      description: `Boarding terbuka — final call pukul ${formatHHmm(
        stdTs - activeBefore * 60000,
      )}.`,
    };
  }

  // Tutup boarding off → setelah STD tetap ACTIVE (final call) sampai supervisor close manual.
  if (!closeEnabled) {
    return {
      status: "ACTIVE",
      reason: "IN_ACTIVE_WINDOW",
      minutesFromDeparture,
      description: "Final call — tutup otomatis dinonaktifkan, tutup manual.",
    };
  }

  if (minutesFromDeparture <= closeAfter) {
    return {
      status: "ACTIVE",
      reason: "IN_ACTIVE_WINDOW",
      minutesFromDeparture,
      description: `Final call — gate tutup pukul ${formatHHmm(
        stdTs + closeAfter * 60000,
      )}.`,
    };
  }

  return {
    status: "CLOSED",
    reason: "AFTER_CLOSE",
    minutesFromDeparture,
    description: `Gate sudah ditutup (${minutesFromDeparture} menit setelah STD).`,
  };
}
