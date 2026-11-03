/**
 * Kartu Pas Bandara karyawan (UPBU APT Pranoto). QR-nya berisi URL halaman
 * validasi: https://pas.aptpairport.id/vp/v/<hex>. Pengecekan dilakukan
 * backend (POST /pas/verify) — di sini hanya deteksi & format tampilan.
 */

/**
 * true bila hasil scan adalah QR kartu PAS, bukan boarding pass. Toleran
 * terhadap ":"/"/" yang tertukar oleh layout keyboard scanner.
 */
export function isPasQr(raw: string): boolean {
  const s = raw.trim();
  return /vp[\/\\?]v[\/\\?][0-9a-f]{16,64}/i.test(s) || /aptpairport/i.test(s);
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

/** "2027-01-14" → "14 Jan 2027". */
export function formatPasDate(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** Sisa hari berlaku terhadap `today` (YYYY-MM-DD); negatif = lewat. */
export function daysUntil(iso: string | null, today: string): number | null {
  if (!iso) return null;
  const a = Date.parse(`${iso}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86_400_000);
}
