import narration from "./narration.json";
import durations from "./vo-durations.json";
import vo from "./vo-words.json";

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
/** Panjang transisi antar-scene (frame). Transisi menumpuk akhir scene lama & awal scene baru. */
export const TRANSITION = 15;

export type SceneId = (typeof narration)[number]["id"];
export type Word = { text: string; start: number; end: number };

export const SCENES = narration.map((n) => n.id as SceneId);
export const sceneTitle = (id: SceneId) => narration.find((n) => n.id === id)!.title;
export const sceneText = (id: SceneId) => narration.find((n) => n.id === id)!.text;

/** Jeda sebelum narasi dimulai dalam tiap scene (frame). Intro diberi ruang untuk musik & logo. */
export const voDelay = (id: SceneId) => (id === "01-intro" ? 36 : 8);
/** Ekor setelah narasi selesai; outro diberi waktu fade-out. */
const tail = (id: SceneId) => (id === "09-penutup" ? 45 : 6);

export const sceneFrames = (id: SceneId) =>
  voDelay(id) + Math.ceil((durations as Record<string, number>)[id] * FPS) + tail(id);

/** Frame absolut awal tiap scene di komposisi utama (memperhitungkan tumpang tindih transisi). */
export const sceneStarts: Record<SceneId, number> = (() => {
  const out = {} as Record<SceneId, number>;
  let at = 0;
  for (const id of SCENES) {
    out[id] = at;
    at += sceneFrames(id) - TRANSITION;
  }
  return out;
})();

export const TOTAL_FRAMES = SCENES.reduce((sum, id) => sum + sceneFrames(id), 0) - TRANSITION * (SCENES.length - 1);

export const words = (id: SceneId): Word[] => (vo as Record<string, Word[]>)[id] ?? [];

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Frame (relatif terhadap awal scene) saat kata `query` mulai diucapkan.
 * `nth` memilih kemunculan ke-n. Dipakai untuk menyinkronkan animasi dengan narasi.
 */
export const at = (id: SceneId, query: string, nth = 0): number => {
  const q = norm(query);
  const hits = words(id).filter((w) => norm(w.text).startsWith(q));
  const w = hits[Math.min(nth, hits.length - 1)];
  if (!w) throw new Error(`Kata "${query}" tidak ditemukan di narasi ${id}`);
  return voDelay(id) + Math.round(w.start * FPS);
};

/** Rentang narasi aktif [awal, akhir] dalam frame absolut — untuk ducking musik. */
export const voRanges = SCENES.map((id) => {
  const ws = words(id);
  const s = sceneStarts[id] + voDelay(id);
  return [s + Math.round(ws[0].start * FPS), s + Math.round(ws[ws.length - 1].end * FPS)] as const;
});
