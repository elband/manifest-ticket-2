export type UserRole = "admin" | "supervisor" | "security";

export interface User {
  id: string;
  email: string;
  password: string;
  pin?: string;
  name: string;
  role: UserRole;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export type FlightStatus =
  | "DRAFT"
  | "OPEN"
  | "ACTIVE"
  | "CLOSED"
  | "CANCELLED";

export interface Flight {
  id: string;
  flightNumber: string;
  airlineCode: string;
  originAirport: string;
  destinationAirport: string;
  departureDate: string; // YYYY-MM-DD
  departureTime: string; // HH:mm
  gateOrCheckpoint: string;
  status: FlightStatus;
  expectedPax?: number; // total penumpang yang diharapkan boarding
  cancellationReason?: string;
  /** Penerbangan UJI (testing): boarding pass dengan nomor flight ini diterima
   *  walau tanggal di barcode bukan hari ini, dan jendela boarding diabaikan.
   *  Hanya berlaku bila flight ini dijadwalkan hari ini. */
  isTest?: boolean;
  /** Status terakhir diubah MANUSIA (supervisor di perangkat ini/lain), bukan
   *  hasil pemetaan remark FIDS. Hanya CLOSED/ACTIVE manual yang dipertahankan
   *  saat merge FIDS; CLOSED dari FIDS boleh dibuka lagi bila FIDS aktif. */
  manualStatus?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AuditAction =
  | "STATUS_CHANGE"
  | "CLOSE_BOARDING"
  | "REOPEN_BOARDING"
  | "CANCEL_FLIGHT";

export interface FlightAuditEvent {
  id: string;
  flightId: string;
  flightNumber: string;
  action: AuditAction;
  fromStatus: FlightStatus | null;
  toStatus: FlightStatus | null;
  userId: string;
  userName: string;
  at: string; // ISO
  note?: string;
}

export interface BoardingProgress {
  boarded: number;
  expected: number | null;
  remaining: number | null;
  percent: number | null; // 0..100, null jika expected belum diset
  tone: "neutral" | "info" | "success" | "warning" | "danger";
}

export type ScanResultStatus =
  | "VALID_FLIGHT"
  | "DUPLICATE_SCAN"
  | "FLIGHT_NOT_TODAY"
  | "FLIGHT_NOT_ACTIVE"
  | "UNKNOWN_FLIGHT"
  | "INVALID_BARCODE"
  | "KTP_MISMATCH";

export interface ScanEvent {
  id: string;
  rawBarcode: string;
  parsedFlightNumber: string | null;
  parsedPnr: string | null;
  parsedTicketNumber: string | null;
  parsedSeatNumber: string | null;
  parsedPassengerName: string | null;
  resultStatus: ScanResultStatus;
  message: string;
  flightId: string | null;
  scannedBy: string; // userId or email
  scannedAt: string; // ISO
  faceCaptureId?: string | null; // key di facePhotoStore (IndexedDB)
  ktpVerification?: KtpVerification | null;
  /** Scan pada penerbangan UJI — hanya lokal, tidak dikirim ke backend/Sikeren. */
  isTest?: boolean;
}

export type KtpVerificationStatus =
  | "matched"
  | "mismatch"
  | "manual_pass"
  | "manual_reject"
  | "auto_pass" // card tertimpa scan berikutnya tanpa ditolak petugas → dianggap sesuai
  | "skipped"
  | "ocr_failed"
  | "exempted"; // penumpang tanpa KTP — dikonfirmasi petugas

export interface KtpVerification {
  status: KtpVerificationStatus;
  ocrName: string | null;
  rawText?: string;
  similarity?: number;
  capturedAt: string;
  photoId?: string | null;
  /** Alasan pengecualian (hanya saat status "exempted"). */
  exemptReason?: "child" | "infant" | "other";
}

export interface ParsedBarcode {
  flightNumber: string;
  pnr: string;
  ticketNumber: string;
  seatNumber: string;
  passengerName: string | null;
  /** Hanya dari BCBP: field nama (20 karakter) terisi penuh → nama kemungkinan
   *  TERPOTONG maskapai, jadi token terakhir nama depan bisa tidak utuh dan
   *  nama tengah berikutnya hilang. Dipakai pencocokan nama KTP. */
  passengerNameTruncated?: boolean;
  /** Hanya dari BCBP: awal barcode (M1 + nama + indikator E) hilang saat scan.
   *  Field penerbangan terbaca, tapi nama tidak ada → validasi minta scan ulang
   *  (tanpa nama, verifikasi KTP tak bisa dilakukan). */
  bcbpHeaderMissing?: boolean;
  /** Tanggal keberangkatan dari barcode (YYYY-MM-DD) bila tersedia: field ke-6
   *  format pipe, atau Julian date BCBP. null = barcode tak memuat tanggal. */
  flightDate?: string | null;
  /** Hanya dari BCBP: kode maskapai & rute (IATA 3-huruf). */
  airlineCode?: string | null;
  originAirport?: string | null;
  destinationAirport?: string | null;
}

export interface PassengerRecord {
  passengerName: string | null;
  pnr: string;
  ticketNumber: string;
  seatNumber: string;
  flightId: string;
  flightNumber: string;
  firstScannedAt: string;
  lastScannedAt: string;
  scanCount: number;
}
