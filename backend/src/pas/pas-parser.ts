/**
 * Pengurai halaman validasi Pas Bandara (pas.aptpairport.id/vp/v/<id>).
 *
 * Halaman dirender server (PHP) — data ada langsung di HTML sebagai pasangan
 *   <label class="form-control-static">Judul</label>
 *   <label class="form-control" ...><b>Nilai</b> ...</label>
 * ID tak dikenal tetap HTTP 200, dengan alert "FAILED / Data tidak ditemukan".
 * Murni (tanpa I/O) supaya mudah dites dengan fixture HTML.
 */

export interface PasCard {
  name: string | null;
  position: string | null;
  company: string | null;
  category: string | null;
  categoryNote: string | null;
  pasNumber: string | null;
  cardColor: string | null;
  /** Warna latar kartu dari CSS halaman (mis. "red") — untuk chip warna. */
  cardColorCss: string | null;
  passType: string | null;
  /** YYYY-MM-DD */
  issuedAt: string | null;
  /** YYYY-MM-DD */
  validUntil: string | null;
  areaCodes: string[];
  photoUrl: string | null;
}

export type PasParseResult =
  | { kind: "found"; card: PasCard }
  | { kind: "not_found" }
  /** HTML tak dikenali — kemungkinan tampilan situs PAS berubah. */
  | { kind: "unrecognized" };

const MONTHS: Record<string, number> = {
  JANUARI: 1,
  FEBRUARI: 2,
  MARET: 3,
  APRIL: 4,
  MEI: 5,
  JUNI: 6,
  JULI: 7,
  AGUSTUS: 8,
  SEPTEMBER: 9,
  OKTOBER: 10,
  NOVEMBER: 11,
  DESEMBER: 12,
};

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));
}

function clean(s: string | undefined | null): string | null {
  if (s == null) return null;
  const v = decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  return v || null;
}

/** "14 JANUARI 2027" → "2027-01-14"; format lain → null. */
export function parseIndonesianDate(s: string | null): string | null {
  if (!s) return null;
  const m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const month = MONTHS[m[2].toUpperCase()];
  const day = Number(m[1]);
  if (!month || day < 1 || day > 31) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

interface Field {
  value: string | null;
  note: string | null;
  background: string | null;
}

/** Peta judul label (huruf kecil) → isi kotak nilai di bawahnya. */
function extractFields(html: string): Map<string, Field> {
  const fields = new Map<string, Field>();
  const re =
    /<label[^>]*class="form-control-static"[^>]*>([\s\S]*?)<\/label>\s*<label([^>]*)class="form-control"([^>]*)>([\s\S]*?)<\/label>/gi;
  for (const m of html.matchAll(re)) {
    const title = clean(m[1]);
    if (!title) continue;
    const attrs = `${m[2]} ${m[3]}`;
    const body = m[4];
    const bg = /background\s*:\s*([^;!"]+)/i.exec(attrs);
    fields.set(title.toLowerCase(), {
      value: clean(/<b>([\s\S]*?)<\/b>/i.exec(body)?.[1] ?? body),
      note: clean(/<small[^>]*>([\s\S]*?)<\/small>/i.exec(body)?.[1]),
      background: bg ? bg[1].trim() : null,
    });
  }
  return fields;
}

export function parsePasHtml(html: string): PasParseResult {
  const fields = extractFields(html);
  const get = (title: string) => fields.get(title.toLowerCase());

  const name = get("Nama Lengkap")?.value ?? null;
  const pasNumber = get("Nomor Pas")?.value ?? null;
  if (!name && !pasNumber) {
    if (/alert-danger[\s\S]*?(FAILED|tidak ditemukan)/i.test(html)) {
      return { kind: "not_found" };
    }
    return { kind: "unrecognized" };
  }

  const color = get("Warna Kartu");
  const category = get("Kategori");
  const area = get("Kode Area")?.value ?? null;
  const photo = /<img[^>]*class="[^"]*ap-img__main[^"]*"[^>]*src="([^"]+)"/i.exec(html)?.[1]
    ?? /<img[^>]*src="([^"]+)"[^>]*class="[^"]*ap-img__main/i.exec(html)?.[1]
    ?? null;

  return {
    kind: "found",
    card: {
      name,
      position: get("Jabatan")?.value ?? null,
      company: get("Perusahaan / Instansi")?.value ?? null,
      category: category?.value ?? null,
      categoryNote: category?.note ?? null,
      pasNumber,
      cardColor: color?.value ?? null,
      cardColorCss: color?.background ?? null,
      passType: get("Jenis Pas Bandara")?.value ?? null,
      issuedAt: parseIndonesianDate(get("Tanggal Diterbitkan")?.value ?? null),
      validUntil: parseIndonesianDate(get("Masa Berlaku Sampai Dengan")?.value ?? null),
      areaCodes: area ? area.split(/[\s,]+/).filter(Boolean) : [],
      photoUrl: photo ? decodeEntities(photo) : null,
    },
  };
}
