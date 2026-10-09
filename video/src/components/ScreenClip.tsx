import type { ReactNode } from "react";
import { Easing, interpolate, OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import { C, fontFamily } from "../theme";
import { FPS } from "../timing";

/** Ukuran asli rekaman UI (scripts/capture.mjs). */
export const SRC_W = 1920;
export const SRC_H = 1080;

/** Area layar asli yang sedang "disorot kamera" (koordinat piksel rekaman 1920×1080). */
export type Focus = { at: number; x: number; y: number; w: number };
/** Sorotan kotak berlabel di atas UI asli (koordinat rekaman). */
export type Highlight = { from: number; to: number; x: number; y: number; w: number; h: number; label?: string; color?: string; radius?: number };

export const FULL: Omit<Focus, "at"> = { x: 0, y: 0, w: SRC_W };

const ease = Easing.bezier(0.45, 0, 0.2, 1);

const focusAt = (frame: number, keys: Focus[]) => {
  if (keys.length === 0) return FULL;
  if (frame <= keys[0].at) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (frame < b.at) {
      // Pindah fokus dalam 22 frame terakhir sebelum keyframe berikutnya.
      const start = Math.max(a.at, b.at - 22);
      const p = interpolate(frame, [start, b.at], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
      return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, w: a.w + (b.w - a.w) * p };
    }
  }
  return keys[keys.length - 1];
};

/**
 * Rekaman UI asli SIPANDAI dalam bingkai monitor, dengan zoom/pan per keyframe
 * dan sorotan berlabel. `clipFrom` = detik di klip yang tampil pada frame 0 scene.
 */
export const ScreenClip: React.FC<{
  clip: string;
  clipFrom: number;
  focus?: Focus[];
  highlights?: Highlight[];
  left?: number;
  top?: number;
  width?: number;
  playbackRate?: number;
  children?: ReactNode;
}> = ({ clip, clipFrom, focus = [], highlights = [], left = 280, top = 150, width = 1360, playbackRate = 1, children }) => {
  const frame = useCurrentFrame();
  const height = (width * SRC_H) / SRC_W;
  const f = focusAt(frame, focus);
  // Jaga rasio 16:9 — tinggi area mengikuti lebar.
  const scale = width / f.w;
  const fy = Math.min(Math.max(0, f.y), SRC_H - (f.w * SRC_H) / SRC_W);
  const fx = Math.min(Math.max(0, f.x), SRC_W - f.w);
  const toScreen = (x: number, y: number) => ({ x: (x - fx) * scale, y: (y - fy) * scale });

  return (
    <div style={{ position: "absolute", left, top, width, height }}>
      {/* Bezel monitor */}
      <div
        style={{
          position: "absolute",
          inset: -14,
          borderRadius: 30,
          background: "linear-gradient(160deg, #2A3A55, #0B1322)",
          boxShadow: "0 50px 120px -30px rgba(0,0,0,0.9), 0 0 0 1.5px rgba(148,197,255,0.18), 0 0 80px -30px rgba(56,189,248,0.5)",
        }}
      />
      <div style={{ position: "absolute", inset: 0, borderRadius: 18, overflow: "hidden", background: "#000" }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: SRC_W, height: SRC_H, transformOrigin: "0 0", transform: `scale(${scale}) translate(${-fx}px, ${-fy}px)` }}>
          <OffthreadVideo src={staticFile(`clips/${clip}.mp4`)} startFrom={Math.round(clipFrom * FPS)} playbackRate={playbackRate} muted style={{ width: SRC_W, height: SRC_H }} />
        </div>
        {highlights.map((h, i) => {
          if (frame < h.from - 8 || frame > h.to + 8) return null;
          const inP = interpolate(frame, [h.from - 8, h.from + 4, h.to - 4, h.to + 8], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const a = toScreen(h.x, h.y);
          const b = toScreen(h.x + h.w, h.y + h.h);
          const color = h.color ?? C.warningLite;
          const pulse = 0.5 + 0.5 * Math.sin((frame - h.from) / 5);
          return (
            <div key={i} style={{ position: "absolute", left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y, opacity: inP }}>
              <div
                style={{
                  position: "absolute",
                  inset: -8 - (1 - inP) * 20,
                  borderRadius: h.radius ?? 18,
                  border: `4px solid ${color}`,
                  boxShadow: `0 0 ${18 + pulse * 22}px ${color}, inset 0 0 ${10 + pulse * 10}px ${color}55`,
                }}
              />
              {h.label ? (
                <div
                  style={{
                    position: "absolute",
                    left: -8,
                    ...(a.y > 70 ? { bottom: "100%", marginBottom: 16 } : { top: "100%", marginTop: 16 }),
                    whiteSpace: "nowrap",
                    padding: "8px 18px",
                    borderRadius: 12,
                    background: color,
                    color: "#0B1220",
                    fontFamily,
                    fontWeight: 800,
                    fontSize: 26,
                    boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
                  }}
                >
                  {h.label}
                </div>
              ) : null}
            </div>
          );
        })}
        {children}
      </div>
    </div>
  );
};
