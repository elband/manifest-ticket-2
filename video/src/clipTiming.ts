import clips from "./clips.json";
import { FPS } from "./timing";

type ClipMeta = { duration: number; marks: Record<string, number> };
const C = clips as Record<string, ClipMeta>;

/** Detik penanda aksi `name` di klip (dicatat scripts/capture.mjs). */
export const mark = (clip: string, name: string): number => {
  const v = C[clip]?.marks[name];
  if (v === undefined) throw new Error(`Penanda ${clip}.${name} tidak ada — jalankan ulang npm run capture`);
  return v;
};

export const clipDuration = (clip: string) => C[clip].duration;

/** Jeda dari scan (Enter) sampai modal hasil tampil: aplikasi mengambil foto wajah dulu. */
export const MODAL_DELAY = 1.8;

/** `clipFrom` agar detik `t` di klip tampil tepat pada frame `frame` scene (dengan playbackRate `rate`). */
export const alignClip = (t: number, frame: number, rate = 1) => Math.max(0, t - (frame / FPS) * rate);
