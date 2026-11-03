/**
 * Katalog tindakan yang dicatat ke log aktivitas. Kunci = "<METHOD> <pola rute>"
 * (pola dari Express, tanpa prefix /api), mis. "PATCH /operators/:id".
 *
 * Request yang TIDAK tercantum di sini tetap dicatat bila mengubah data
 * (POST/PUT/PATCH/DELETE) dengan kategori "system", kecuali yang ada di
 * `SKIPPED` — jalur bervolume tinggi yang sudah punya jejak sendiri.
 */

export type ActivityCategory =
  | "auth"
  | "operator"
  | "flight"
  | "settings"
  | "device"
  | "system";

export interface ActivityDef {
  action: string;
  category: ActivityCategory;
  /** Kalimat ringkas; `target` = nama/label objek bila diketahui. */
  describe: (ctx: { target: string | null; body: Record<string, unknown> }) => string;
  /** Entitas yang labelnya di-lookup dari `:id` sebelum handler jalan. */
  lookup?: "operator" | "flight" | "device";
}

const q = (s: string | null) => (s ? ` "${s}"` : "");

export const ACTIVITY_CATALOG: Record<string, ActivityDef> = {
  "POST /auth/login": {
    action: "auth.login",
    category: "auth",
    describe: () => "Login dengan email & kata sandi",
  },
  "POST /auth/login-pin": {
    action: "auth.login_pin",
    category: "auth",
    describe: () => "Login dengan PIN petugas",
  },
  "POST /flights": {
    action: "flight.create",
    category: "flight",
    describe: ({ body }) => `Menambah penerbangan${q(str(body.flightNumber))}`,
  },
  "PATCH /flights/:id": {
    action: "flight.update",
    category: "flight",
    lookup: "flight",
    describe: ({ target, body }) =>
      typeof body.status === "string"
        ? `Mengubah status penerbangan${q(target)} menjadi ${body.status}`
        : `Memperbarui penerbangan${q(target)}`,
  },
  "DELETE /flights/:id": {
    action: "flight.delete",
    category: "flight",
    lookup: "flight",
    describe: ({ target }) => `Menghapus penerbangan${q(target)}`,
  },
  "POST /flights/manifests/rebuild": {
    action: "flight.manifest_rebuild",
    category: "flight",
    describe: () => "Membangun ulang manifest penumpang",
  },
  "POST /operators": {
    action: "operator.create",
    category: "operator",
    describe: ({ body }) => `Menambah petugas${q(str(body.name))}`,
  },
  "PATCH /operators/:id": {
    action: "operator.update",
    category: "operator",
    lookup: "operator",
    describe: ({ target, body }) => {
      if (body.active === true) return `Mengaktifkan petugas${q(target)}`;
      if (body.active === false) return `Menonaktifkan petugas${q(target)}`;
      return `Memperbarui data petugas${q(target)}`;
    },
  },
  "POST /operators/:id/pin": {
    action: "operator.pin_reset",
    category: "operator",
    lookup: "operator",
    describe: ({ target }) => `Mengatur ulang PIN petugas${q(target)}`,
  },
  "POST /operators/:id/photo": {
    action: "operator.photo_upload",
    category: "operator",
    lookup: "operator",
    describe: ({ target }) => `Mengunggah foto petugas${q(target)}`,
  },
  "DELETE /operators/:id/photo": {
    action: "operator.photo_delete",
    category: "operator",
    lookup: "operator",
    describe: ({ target }) => `Menghapus foto petugas${q(target)}`,
  },
  "DELETE /operators/:id": {
    action: "operator.delete",
    category: "operator",
    lookup: "operator",
    describe: ({ target }) => `Menghapus petugas${q(target)}`,
  },
  "POST /devices/register": {
    action: "device.register",
    category: "device",
    describe: ({ body }) => `Perangkat baru meminta izin akses${q(str(body.name))}`,
  },
  "POST /devices/:id/approve": {
    action: "device.approve",
    category: "device",
    lookup: "device",
    describe: ({ target, body }) =>
      `Mengizinkan perangkat${q(target)}${str(body.station) ? ` di station ${str(body.station)}` : ""}`,
  },
  "PATCH /devices/:id": {
    action: "device.update",
    category: "device",
    lookup: "device",
    describe: ({ target }) => `Memperbarui data perangkat${q(target)}`,
  },
  "POST /devices/:id/revoke": {
    action: "device.revoke",
    category: "device",
    lookup: "device",
    describe: ({ target }) => `Mencabut izin perangkat${q(target)}`,
  },
  "DELETE /devices/:id": {
    action: "device.delete",
    category: "device",
    lookup: "device",
    describe: ({ target }) => `Menghapus perangkat${q(target)}`,
  },
  "PUT /settings": {
    action: "settings.update",
    category: "settings",
    describe: () => "Mengubah pengaturan global aplikasi",
  },
};

/**
 * Tidak dicatat: scan boarding pass & keputusan identitas (sudah tersimpan di
 * tabel ScanEvent, ribuan/hari), cek kartu PAS (tabel PasScan), sinkron FIDS
 * otomatis tiap perangkat, dan polling token perangkat (tiap 30 dtk selama
 * menunggu izin).
 */
export const SKIPPED = new Set([
  "POST /scan-events",
  "PATCH /scan-events/:eventId/identity",
  "POST /pas/verify",
  "POST /flights/sync",
  "POST /devices/token",
]);

/** Field body yang tak boleh ikut tersimpan, walau hanya namanya. */
const SECRET_FIELDS = new Set([
  "password",
  "pin",
  "passwordHash",
  "pinHash",
  "token",
  "secret",
]);

/** Daftar nama field yang diubah (tanpa nilai) — cukup untuk audit, aman dari bocor. */
export function changedFields(body: Record<string, unknown>): string[] {
  return Object.keys(body).filter((k) => !SECRET_FIELDS.has(k));
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
