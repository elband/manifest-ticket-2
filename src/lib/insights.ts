import { boardingProgressFromCount, buildBoardedCounts } from "./boarding";
import { getEffectiveFlightStatus } from "./flightStatus";
import type { AppSettings } from "./settings";
import type { Flight, FlightAuditEvent, ScanEvent, ScanResultStatus } from "./types";
import { localDateKey, todayDateString } from "./utils";

export type InsightCategory =
  | "overview"
  | "flights"
  | "scan"
  | "passengers"
  | "system";

export type InsightSeverity = "success" | "info" | "warning" | "danger";

export interface AppInsight {
  id: string;
  category: InsightCategory;
  severity: InsightSeverity;
  title: string;
  summary: string;
  recommendation: string;
  metricLabel?: string;
  metricValue?: string | number;
  href?: string;
}

export interface InsightOverview {
  flightsToday: number;
  boardableNow: number;
  scansToday: number;
  validToday: number;
  duplicateToday: number;
  rejectedToday: number;
  successRate: number;
  openIssues: number;
}

export interface AppInsightReport {
  overview: InsightOverview;
  insights: AppInsight[];
}

const REJECTED_STATUSES: ScanResultStatus[] = [
  "FLIGHT_NOT_TODAY",
  "FLIGHT_NOT_ACTIVE",
  "UNKNOWN_FLIGHT",
  "INVALID_BARCODE",
  "KTP_MISMATCH",
];

const STATUS_LABEL: Record<ScanResultStatus, string> = {
  VALID_FLIGHT: "Valid",
  DUPLICATE_SCAN: "Duplikat",
  FLIGHT_NOT_TODAY: "Bukan hari ini",
  FLIGHT_NOT_ACTIVE: "Flight tidak aktif",
  UNKNOWN_FLIGHT: "Flight tidak dikenal",
  INVALID_BARCODE: "Barcode rusak",
  KTP_MISMATCH: "KTP tidak cocok",
};

export function buildAppInsightReport(input: {
  flights: Flight[];
  events: ScanEvent[];
  auditEvents: FlightAuditEvent[];
  settings: AppSettings;
  now?: Date;
}): AppInsightReport {
  const now = input.now ?? new Date();
  const today = todayDateString();
  const flightsToday = input.flights.filter((f) => f.departureDate === today);
  const eventsToday = input.events.filter((e) => localDateKey(e.scannedAt) === today);
  const validToday = eventsToday.filter((e) => e.resultStatus === "VALID_FLIGHT");
  const duplicateToday = eventsToday.filter(
    (e) => e.resultStatus === "DUPLICATE_SCAN",
  );
  const rejectedToday = eventsToday.filter((e) =>
    REJECTED_STATUSES.includes(e.resultStatus),
  );
  const successRate =
    eventsToday.length > 0
      ? Math.round((validToday.length / eventsToday.length) * 100)
      : 0;
  const effectiveByFlight = new Map(
    flightsToday.map((flight) => [
      flight.id,
      getEffectiveFlightStatus(flight, now, input.settings),
    ]),
  );
  const boardableNow = flightsToday.filter((flight) => {
    const status = effectiveByFlight.get(flight.id)?.status;
    return status === "OPEN" || status === "ACTIVE";
  }).length;

  const insights: AppInsight[] = [];

  addOverviewInsights(insights, {
    scansToday: eventsToday.length,
    validToday: validToday.length,
    duplicateToday: duplicateToday.length,
    rejectedToday: rejectedToday.length,
    successRate,
    boardableNow,
    flightsToday: flightsToday.length,
  });

  addFlightInsights(insights, {
    flightsToday,
    events: input.events,
    settings: input.settings,
    now,
    effectiveByFlight,
  });

  addScanInsights(insights, {
    eventsToday,
    duplicateToday,
    rejectedToday,
    successRate,
  });

  addPassengerInsights(insights, {
    flightsToday,
    events: input.events,
  });

  addSystemInsights(insights, {
    settings: input.settings,
    auditEvents: input.auditEvents,
    flightsToday,
  });

  if (insights.length === 0) {
    insights.push({
      id: "all-clear",
      category: "overview",
      severity: "success",
      title: "Operasi terlihat stabil",
      summary:
        "Belum ada pola risiko besar dari flight, scan, penumpang, maupun konfigurasi hari ini.",
      recommendation:
        "Lanjutkan monitoring rutin dan cek kembali saat volume scan mulai meningkat.",
      metricLabel: "Success rate",
      metricValue: `${successRate}%`,
      href: "/dashboard",
    });
  }

  const openIssues = insights.filter(
    (item) => item.severity === "warning" || item.severity === "danger",
  ).length;

  return {
    overview: {
      flightsToday: flightsToday.length,
      boardableNow,
      scansToday: eventsToday.length,
      validToday: validToday.length,
      duplicateToday: duplicateToday.length,
      rejectedToday: rejectedToday.length,
      successRate,
      openIssues,
    },
    insights: sortInsights(insights),
  };
}

function addOverviewInsights(
  insights: AppInsight[],
  summary: {
    scansToday: number;
    validToday: number;
    duplicateToday: number;
    rejectedToday: number;
    successRate: number;
    boardableNow: number;
    flightsToday: number;
  },
) {
  if (summary.flightsToday === 0) {
    insights.push({
      id: "overview-no-flights",
      category: "overview",
      severity: "warning",
      title: "Belum ada flight hari ini",
      summary:
        "Sistem belum menemukan jadwal penerbangan untuk tanggal operasional hari ini.",
      recommendation:
        "Tambahkan jadwal flight atau cek seed/import data sebelum pos scan mulai digunakan.",
      metricLabel: "Flight hari ini",
      metricValue: 0,
      href: "/flights/create",
    });
    return;
  }

  if (summary.scansToday === 0) {
    insights.push({
      id: "overview-no-scans",
      category: "overview",
      severity: summary.boardableNow > 0 ? "warning" : "info",
      title: "Belum ada scan masuk hari ini",
      summary:
        summary.boardableNow > 0
          ? "Ada flight yang sudah bisa boarding, tetapi belum ada aktivitas scan."
          : "Jadwal sudah tersedia, namun aktivitas scan belum dimulai.",
      recommendation:
        summary.boardableNow > 0
          ? "Pastikan scanner, kiosk, dan petugas sudah siap di gate yang aktif."
          : "Tidak perlu tindakan cepat; siapkan pos sebelum boarding window dibuka.",
      metricLabel: "Scan hari ini",
      metricValue: 0,
      href: "/scan",
    });
    return;
  }

  if (summary.successRate >= 90 && summary.rejectedToday === 0) {
    insights.push({
      id: "overview-good-success",
      category: "overview",
      severity: "success",
      title: "Validasi berjalan sehat",
      summary:
        "Mayoritas scan hari ini valid dan belum ada penolakan yang perlu ditangani.",
      recommendation:
        "Pertahankan alur scan saat ini; fokus pada flight dengan boarding progress rendah.",
      metricLabel: "Success rate",
      metricValue: `${summary.successRate}%`,
      href: "/dashboard",
    });
  }
}

function addFlightInsights(
  insights: AppInsight[],
  input: {
    flightsToday: Flight[];
    events: ScanEvent[];
    settings: AppSettings;
    now: Date;
    effectiveByFlight: Map<string, ReturnType<typeof getEffectiveFlightStatus>>;
  },
) {
  // P-07: index boarded-count dibangun sekali untuk semua flight.
  const boardedCounts = buildBoardedCounts(input.events);
  const upcomingRisk = input.flightsToday
    .map((flight) => {
      const effective = input.effectiveByFlight.get(flight.id);
      const progress = boardingProgressFromCount(flight, boardedCounts.get(flight.id) ?? 0);
      const departureAt = new Date(`${flight.departureDate}T${flight.departureTime}`);
      const minsToDeparture = Math.round(
        (departureAt.getTime() - input.now.getTime()) / 60000,
      );
      return { flight, effective, progress, minsToDeparture };
    })
    .filter(
      (item) =>
        item.minsToDeparture >= -10 &&
        item.minsToDeparture <= 90 &&
        (item.effective?.status === "OPEN" || item.effective?.status === "ACTIVE") &&
        item.progress.expected !== null &&
        (item.progress.percent ?? 0) < 50,
    )
    .sort((a, b) => a.minsToDeparture - b.minsToDeparture)[0];

  if (upcomingRisk) {
    insights.push({
      id: `flight-low-progress-${upcomingRisk.flight.id}`,
      category: "flights",
      severity: upcomingRisk.minsToDeparture <= 30 ? "danger" : "warning",
      title: `${upcomingRisk.flight.flightNumber} boarding masih rendah`,
      summary: `${upcomingRisk.progress.boarded}/${upcomingRisk.progress.expected} penumpang sudah valid, sementara keberangkatan sekitar ${Math.max(
        0,
        upcomingRisk.minsToDeparture,
      )} menit lagi.`,
      recommendation:
        "Cek kondisi gate, panggilan boarding, dan pastikan jalur scan tidak tertahan.",
      metricLabel: "Progress",
      metricValue: `${upcomingRisk.progress.percent ?? 0}%`,
      href: `/flights/${upcomingRisk.flight.id}`,
    });
  }

  const missingCapacity = input.flightsToday.filter(
    (flight) =>
      flight.status !== "CANCELLED" &&
      (typeof flight.expectedPax !== "number" || flight.expectedPax <= 0),
  );
  if (missingCapacity.length > 0) {
    insights.push({
      id: "flight-missing-capacity",
      category: "flights",
      severity: "info",
      title: "Beberapa flight belum punya target pax",
      summary: `${missingCapacity.length} flight hari ini belum memiliki expected pax, sehingga progress boarding kurang informatif.`,
      recommendation:
        "Lengkapi expected pax pada flight aktif agar sistem bisa menghitung sisa penumpang.",
      metricLabel: "Flight",
      metricValue: missingCapacity.length,
      href: "/flights",
    });
  }

  const cancelled = input.flightsToday.filter((flight) => flight.status === "CANCELLED");
  if (cancelled.length > 0) {
    insights.push({
      id: "flight-cancelled-today",
      category: "flights",
      severity: "warning",
      title: "Ada flight dibatalkan hari ini",
      summary: `${cancelled.length} flight berstatus cancelled dan harus jelas terlihat oleh petugas scan.`,
      recommendation:
        "Pastikan petugas gate mengetahui flight yang dibatalkan agar tidak terjadi validasi manual yang keliru.",
      metricLabel: "Cancelled",
      metricValue: cancelled.length,
      href: "/flights",
    });
  }
}

function addScanInsights(
  insights: AppInsight[],
  input: {
    eventsToday: ScanEvent[];
    duplicateToday: ScanEvent[];
    rejectedToday: ScanEvent[];
    successRate: number;
  },
) {
  if (input.eventsToday.length === 0) return;

  const duplicateRate = Math.round(
    (input.duplicateToday.length / input.eventsToday.length) * 100,
  );
  if (input.duplicateToday.length >= 3 || duplicateRate >= 10) {
    insights.push({
      id: "scan-duplicate-rate",
      category: "scan",
      severity: duplicateRate >= 20 ? "danger" : "warning",
      title: "Duplicate scan perlu diperhatikan",
      summary: `${input.duplicateToday.length} duplicate scan terdeteksi hari ini (${duplicateRate}% dari total scan).`,
      recommendation:
        "Cek apakah ada re-print boarding pass, antrean putar balik, atau operator melakukan scan ulang.",
      metricLabel: "Duplicate",
      metricValue: `${duplicateRate}%`,
      href: "/scan-events",
    });
  }

  const rejectedRate = Math.round(
    (input.rejectedToday.length / input.eventsToday.length) * 100,
  );
  if (input.rejectedToday.length >= 3 || rejectedRate >= 15) {
    const topRejected = topBy(input.rejectedToday, (event) => event.resultStatus)[0];
    insights.push({
      id: "scan-rejected-rate",
      category: "scan",
      severity: rejectedRate >= 25 ? "danger" : "warning",
      title: "Penolakan scan cukup tinggi",
      summary: `${input.rejectedToday.length} scan ditolak hari ini. Penyebab terbanyak: ${
        topRejected ? STATUS_LABEL[topRejected.key] : "belum terdeteksi"
      }.`,
      recommendation:
        "Filter riwayat scan berdasarkan status penolakan, lalu cek apakah masalah berasal dari jadwal, barcode, atau flight yang belum aktif.",
      metricLabel: "Rejected",
      metricValue: `${rejectedRate}%`,
      href: "/scan-events",
    });
  }

  if (input.successRate > 0 && input.successRate < 75) {
    insights.push({
      id: "scan-low-success",
      category: "scan",
      severity: "danger",
      title: "Success rate rendah",
      summary: `Hanya ${input.successRate}% scan hari ini yang valid.`,
      recommendation:
        "Prioritaskan pengecekan jadwal aktif, format barcode, dan status boarding window.",
      metricLabel: "Success rate",
      metricValue: `${input.successRate}%`,
      href: "/analytics",
    });
  }
}

function addPassengerInsights(
  insights: AppInsight[],
  input: {
    flightsToday: Flight[];
    events: ScanEvent[];
  },
) {
  const flightsById = new Map(input.flightsToday.map((flight) => [flight.id, flight]));
  const validToday = input.events.filter(
    (event) =>
      event.resultStatus === "VALID_FLIGHT" &&
      event.flightId !== null &&
      flightsById.has(event.flightId),
  );

  const unnamed = validToday.filter(
    (event) => !event.parsedPassengerName || event.parsedPassengerName.trim() === "",
  );
  if (validToday.length >= 5 && unnamed.length / validToday.length >= 0.5) {
    insights.push({
      id: "passenger-names-missing",
      category: "passengers",
      severity: "info",
      title: "Data nama penumpang belum banyak terbaca",
      summary: `${unnamed.length} dari ${validToday.length} scan valid hari ini tidak memiliki nama penumpang.`,
      recommendation:
        "Jika manifest nama diperlukan, pertimbangkan upload manifest awal atau gunakan format barcode yang membawa nama.",
      metricLabel: "Tanpa nama",
      metricValue: unnamed.length,
      href: "/passengers",
    });
  }

  const byPassengerKey = topBy(
    validToday,
    (event) =>
      `${event.flightId ?? ""}|${event.parsedPnr ?? ""}|${event.parsedSeatNumber ?? ""}|${
        event.parsedTicketNumber ?? ""
      }`,
  );
  const repeatedValid = byPassengerKey.find((item) => item.count > 1);
  if (repeatedValid) {
    insights.push({
      id: "passenger-repeat-valid",
      category: "passengers",
      severity: "warning",
      title: "Ada penumpang valid lebih dari sekali",
      summary:
        "Sistem menemukan kombinasi PNR/seat/tiket yang muncul lebih dari sekali pada scan valid hari ini.",
      recommendation:
        "Buka pencarian penumpang untuk memastikan tidak ada proses manual atau data barcode yang ganda.",
      metricLabel: "Kemunculan",
      metricValue: repeatedValid.count,
      href: "/passengers",
    });
  }
}

function addSystemInsights(
  insights: AppInsight[],
  input: {
    settings: AppSettings;
    auditEvents: FlightAuditEvent[];
    flightsToday: Flight[];
  },
) {
  if (!input.settings.faceCaptureEnabled) {
    insights.push({
      id: "system-face-disabled",
      category: "system",
      severity: "info",
      title: "Face capture sedang nonaktif",
      summary:
        "Scan tetap berjalan, tetapi bukti visual penumpang tidak akan tersimpan untuk audit.",
      recommendation:
        "Aktifkan face capture jika pos ini membutuhkan audit visual saat boarding.",
      metricLabel: "Audit visual",
      metricValue: "Off",
      href: "/settings",
    });
  }

  if (!input.settings.requireFaceForScan && input.settings.faceCaptureEnabled) {
    insights.push({
      id: "system-face-not-required",
      category: "system",
      severity: "warning",
      title: "Scan tidak mewajibkan wajah siap",
      summary:
        "Kiosk bisa menerima scan walau wajah belum terdeteksi, sehingga kualitas audit bisa turun.",
      recommendation:
        "Untuk pos boarding utama, aktifkan syarat wajah siap sebelum scan.",
      metricLabel: "Require face",
      metricValue: "Off",
      href: "/settings",
    });
  }

  if (!input.settings.autoClosePastDayFlights) {
    insights.push({
      id: "system-auto-close-off",
      category: "system",
      severity: "info",
      title: "Auto-close flight hari lalu nonaktif",
      summary:
        "Flight lama yang masih OPEN/ACTIVE tidak otomatis ditutup saat aplikasi dibuka.",
      recommendation:
        "Aktifkan auto-close untuk mengurangi risiko jadwal lama ikut tervalidasi.",
      metricLabel: "Auto-close",
      metricValue: "Off",
      href: "/settings",
    });
  }

  const todaysFlightIds = new Set(input.flightsToday.map((flight) => flight.id));
  const todaysAuditCount = input.auditEvents.filter(
    (event) =>
      todaysFlightIds.has(event.flightId) && localDateKey(event.at) === todayDateString(),
  ).length;
  if (todaysAuditCount >= 5) {
    insights.push({
      id: "system-many-status-changes",
      category: "system",
      severity: "warning",
      title: "Perubahan status flight cukup sering",
      summary: `${todaysAuditCount} perubahan status tercatat pada flight hari ini.`,
      recommendation:
        "Review audit trail untuk memastikan perubahan status dilakukan sesuai SOP.",
      metricLabel: "Audit event",
      metricValue: todaysAuditCount,
      href: "/flights",
    });
  }
}

function topBy<T, K extends string>(
  items: T[],
  keyFn: (item: T) => K,
): { key: K; count: number }[] {
  const map = new Map<K, number>();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

function sortInsights(insights: AppInsight[]): AppInsight[] {
  const severityRank: Record<InsightSeverity, number> = {
    danger: 0,
    warning: 1,
    info: 2,
    success: 3,
  };
  const categoryRank: Record<InsightCategory, number> = {
    overview: 0,
    flights: 1,
    scan: 2,
    passengers: 3,
    system: 4,
  };
  return insights.slice().sort((a, b) => {
    const bySeverity = severityRank[a.severity] - severityRank[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return categoryRank[a.category] - categoryRank[b.category];
  });
}
