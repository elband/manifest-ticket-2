import { ParsedBarcode } from "./types";

/**
 * Parser barcode boarding pass (modul MURNI — tanpa dependensi browser/storage,
 * supaya bisa di-unit-test). Mendukung dua format:
 *
 * 1. IATA BCBP (Bar Coded Boarding Pass) — standar boarding pass asli,
 *    contoh: "M1YUSUF/AJIE MUH      EUHXURZ AAPBEJIW 1484 153Y001C0035 100"
 * 2. Format MVP pipe-separated:
 *    "FLIGHT|PNR|TICKET|SEAT"        contoh: "GA123|AB12CD|990001|12A"
 *    "FLIGHT|PNR|TICKET|SEAT|NAME"   contoh: "GA123|AB12CD|990001|12A|BUDI SANTOSO"
 */
export function parseBarcode(raw: string): ParsedBarcode | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;

  const bcbp = parseIataBcbp(trimmed);
  if (bcbp) return bcbp;

  const parts = trimmed.split("|");
  if (parts.length >= 4 && parts.length <= 6) {
    const [flightNumber, pnr, ticketNumber, seatNumber, passengerName, dateRaw] =
      parts.map((p) => p.trim());
    if (flightNumber && pnr && ticketNumber && seatNumber) {
      return {
        flightNumber,
        pnr,
        ticketNumber,
        seatNumber,
        passengerName:
          passengerName && passengerName.length > 0 ? passengerName : null,
        // Field ke-6 (opsional) = tanggal keberangkatan YYYY-MM-DD.
        flightDate: /^\d{4}-\d{2}-\d{2}$/.test(dateRaw ?? "") ? dateRaw : null,
      };
    }
  }

  return null;
}

/** Julian day-of-year (1..366) → YYYY-MM-DD, memakai tahun terdekat dengan hari
 *  ini (menangani pergantian tahun Des↔Jan). null bila tak valid. */
function julianToDate(doy: number): string | null {
  if (!Number.isFinite(doy) || doy < 1 || doy > 366) return null;
  const now = new Date();
  const y = now.getFullYear();
  const todayDoy = Math.floor(
    (Date.UTC(y, now.getMonth(), now.getDate()) - Date.UTC(y, 0, 1)) / 86400000,
  );
  // Pilih tahun agar tanggal jatuh paling dekat ke hari ini (rollover akhir tahun).
  let year = y;
  if (doy - todayDoy > 182) year = y - 1;
  else if (todayDoy - doy > 182) year = y + 1;
  const d = new Date(year, 0, doy);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function formatBcbpName(raw: string): string | null {
  const clean = raw.trim();
  if (!clean) return null;
  // BCBP convention: LASTNAME/FIRSTNAME(MIDDLE)
  const [last, first] = clean.split("/");
  if (last && first) {
    return `${first.trim()} ${last.trim()}`.replace(/\s+/g, " ").trim();
  }
  return clean;
}

/**
 * Parser IATA Resolution 792 Mandatory Items (kira-kira 60 karakter pertama).
 *   pos 0      : 'M'
 *   pos 1      : jumlah leg (1-9)
 *   pos 2-21   : nama penumpang (20 char)
 *   pos 22     : 'E' / ' '
 *   pos 23-29  : PNR / booking code (7 char)
 *   pos 30-32  : origin (3 char)
 *   pos 33-35  : destination (3 char)
 *   pos 36-38  : kode maskapai (3 char, space-padded)
 *   pos 39-43  : nomor flight (5 char, zero-padded)
 *   pos 44-46  : Julian date (day-of-year, 3 char)
 *   pos 47     : compartment / class
 *   pos 48-51  : nomor seat (4 char, contoh "001C")
 *   pos 52-56  : sequence number (5 char)
 *   pos 57     : status
 */
export function parseIataBcbp(raw: string): ParsedBarcode | null {
  if (!/^M\d/.test(raw)) return parseHeaderlessBcbp(raw);
  if (raw.length < 58) return null;

  const nameRaw = raw.substring(2, 22);
  const fields = bcbpFields(raw.substring(30), raw.substring(23, 30));
  if (!fields) return null;

  return {
    ...fields,
    passengerName: formatBcbpName(nameRaw),
    // Field nama BCBP tetap 20 char & di-pad spasi; karakter terakhir bukan
    // spasi → nama mengisi penuh field, kemungkinan besar terpotong.
    passengerNameTruncated: nameRaw.length === 20 && nameRaw[19] !== " ",
  };
}

/**
 * Blok tetap BCBP mulai dari origin (pos 30-57 pada string utuh):
 * origin(3) dest(3) maskapai(3) flight(4+1) julian(3) kelas(1) seat(4) seq(5).
 * Dipakai untuk mengenali BCBP yang AWALNYA HILANG saat scan (lihat
 * parseHeaderlessBcbp). Nama tidak mengandung angka, jadi pola ini tak
 * mungkin cocok di tengah field nama.
 */
const BCBP_FIXED_BLOCK =
  /([A-Z]{3})([A-Z]{3})([A-Z0-9]{2}[A-Z0-9 ])(\d{4}[A-Z ])(\d{3})([A-Z])([A-Z0-9 ]{4})([A-Z0-9 ]{5})/;

/**
 * BCBP yang bagian awalnya (M1 + nama + indikator E) hilang saat dibaca —
 * mis. scanner USB mengetik sebelum input kiosk sempat fokus. Contoh:
 *   "LHLEGJX AAPSUBQG 0461 318Y029C0060 147>7181 ..."
 * Field penerbangan tetap bisa dibaca; nama penumpang TIDAK ada (null) dan
 * ditandai `bcbpHeaderMissing` supaya validasi bisa meminta scan ulang.
 */
function parseHeaderlessBcbp(raw: string): ParsedBarcode | null {
  const m = BCBP_FIXED_BLOCK.exec(raw.toUpperCase());
  // Harus ada sisa PNR di depan blok; tanpa itu bukan BCBP terpotong.
  if (!m || m.index < 1) return null;
  // PNR = 7 karakter tepat sebelum origin (posisi IATA 23-29) — sama dengan
  // hasil parser utuh untuk pass yang sama, jadi deteksi duplikat konsisten.
  const pnrField = raw.substring(Math.max(0, m.index - 7), m.index);
  const fields = bcbpFields(raw.substring(m.index).toUpperCase(), pnrField);
  if (!fields) return null;
  return { ...fields, passengerName: null, bcbpHeaderMissing: true };
}

/** Ekstrak field penerbangan dari `tail` (string BCBP mulai pos origin). */
function bcbpFields(
  tail: string,
  pnrField: string,
): Omit<ParsedBarcode, "passengerName"> | null {
  const pnr = pnrField.trim();
  const origin = tail.substring(0, 3).trim().toUpperCase();
  const destination = tail.substring(3, 6).trim().toUpperCase();
  const airline = tail.substring(6, 9).trim();
  const flightNumRaw = tail.substring(9, 14).trim();
  const flightNum = flightNumRaw.replace(/^0+/, "") || flightNumRaw;
  const seatRaw = tail.substring(18, 22).trim();
  const seat = seatRaw.replace(/^0+/, "") || seatRaw;
  const seq = tail.substring(22, 27).trim().replace(/^0+/, "") || "0";
  const doy = parseInt(tail.substring(14, 17).trim(), 10);

  if (!airline || !flightNum) return null;

  return {
    flightNumber: `${airline}${flightNum}`.toUpperCase(),
    pnr: pnr || "—",
    ticketNumber: seq || "—",
    seatNumber: seat || "—",
    flightDate: julianToDate(doy),
    airlineCode: airline.toUpperCase(),
    originAirport: origin || null,
    destinationAirport: destination || null,
  };
}
