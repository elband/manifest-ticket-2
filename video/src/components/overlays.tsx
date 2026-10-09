import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, fontFamily } from "../theme";
import { FPS, SCENES, sceneText, sceneTitle, voDelay, words, type SceneId } from "../timing";
import { tween, useEnter } from "./anim";
import { Plane } from "./common";

type Token = { text: string; start: number; end: number };

/** Kata dari Edge TTS + tanda baca asli dari naskah. */
const tokensFor = (id: SceneId): Token[] => {
  const src = sceneText(id);
  const lower = src.toLowerCase();
  const ws = words(id);
  const idx: number[] = [];
  let cursor = 0;
  for (const w of ws) {
    const i = lower.indexOf(w.text.toLowerCase(), cursor);
    idx.push(i < 0 ? cursor : i);
    cursor = i < 0 ? cursor : i + w.text.length;
  }
  return ws.map((w, k) => ({
    text: src.slice(idx[k], k + 1 < ws.length ? idx[k + 1] : src.length).trim(),
    start: w.start,
    end: w.end,
  }));
};

const groupLines = (tokens: Token[]) => {
  const lines: Token[][] = [];
  let cur: Token[] = [];
  for (const t of tokens) {
    const len = cur.reduce((s, x) => s + x.text.length + 1, 0);
    const prev = cur[cur.length - 1];
    const sentenceEnd = prev && /[.!?:]$/.test(prev.text);
    if (cur.length && (len + t.text.length > 54 || sentenceEnd || t.start - prev.end > 0.35)) {
      lines.push(cur);
      cur = [];
    }
    cur.push(t);
  }
  if (cur.length) lines.push(cur);
  return lines;
};

/** Subtitle karaoke di bawah layar. Dirender dalam Sequence per scene. */
export const Captions: React.FC<{ id: SceneId }> = ({ id }) => {
  const frame = useCurrentFrame();
  const t = (frame - voDelay(id)) / FPS;
  const lines = groupLines(tokensFor(id));
  const active = lines.findIndex((l, i) => t >= l[0].start - 0.05 && (i === lines.length - 1 || t < lines[i + 1][0].start - 0.05));
  if (active < 0) return null;
  const line = lines[active];
  const lineEnd = line[line.length - 1].end;
  if (t > lineEnd + 1.2) return null;
  const inP = tween(t, [line[0].start - 0.05, line[0].start + 0.15], [0, 1]);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 78, pointerEvents: "none" }}>
      <div
        style={{
          fontFamily,
          fontSize: 34,
          fontWeight: 600,
          padding: "10px 30px",
          borderRadius: 18,
          background: "rgba(4, 10, 20, 0.72)",
          border: `1px solid ${C.line}`,
          backdropFilter: "blur(6px)",
          color: "rgba(232,241,255,0.55)",
          display: "flex",
          gap: 12,
          opacity: inP,
          transform: `translateY(${(1 - inP) * 14}px)`,
          maxWidth: 1500,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        {line.map((w, i) => {
          const spoken = t >= w.start;
          const speaking = t >= w.start && t < w.end + 0.05;
          return (
            <span key={i} style={{ color: spoken ? C.text : undefined, textShadow: speaking ? `0 0 18px ${C.brand2}` : undefined, transition: "none" }}>
              {speaking ? <span style={{ color: "#A5F3FC" }}>{w.text}</span> : w.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const STEP_SCENES = SCENES.filter((s) => s !== "01-intro" && s !== "09-penutup");

/** Tiket "langkah" bergaya potongan boarding pass di kiri atas. */
export const ChapterStub: React.FC<{ id: SceneId }> = ({ id }) => {
  const frame = useCurrentFrame();
  const step = STEP_SCENES.indexOf(id) + 1;
  const p = useEnter(4, { damping: 13 });
  const tear = tween(frame, [10, 26], [0, 1]);
  return (
    <div style={{ position: "absolute", left: 70, top: 52, display: "flex", fontFamily, transform: `translateX(${(1 - p) * -520}px) rotate(${(1 - p) * -6}deg)` }}>
      <div
        style={{
          background: "linear-gradient(135deg, #2563EB, #06B6D4)",
          borderRadius: "18px 0 0 18px",
          padding: "16px 24px",
          color: "white",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          minWidth: 132,
        }}
      >
        <div style={{ fontSize: 15, letterSpacing: 3, opacity: 0.85, fontWeight: 600 }}>LANGKAH</div>
        <div style={{ fontSize: 50, fontWeight: 800, lineHeight: 1 }}>{String(step).padStart(2, "0")}</div>
      </div>
      <div style={{ width: 0, borderLeft: "3px dashed rgba(255,255,255,0.55)", background: "#EAF4FF" }} />
      <div
        style={{
          background: "#EAF4FF",
          borderRadius: "0 18px 18px 0",
          padding: "14px 30px 14px 26px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          transform: `translateX(${tear * 8}px) rotate(${tear * 1.2}deg)`,
          transformOrigin: "left center",
          boxShadow: "0 18px 40px -16px rgba(0,0,0,0.7)",
        }}
      >
        <div style={{ fontSize: 15, letterSpacing: 3, color: "#64748B", fontWeight: 600 }}>
          GATE AVSEC · AAP · {String(step).padStart(2, "0")}/{STEP_SCENES.length}
        </div>
        <div style={{ fontSize: 38, fontWeight: 800, color: "#0F2547", lineHeight: 1.15 }}>{sceneTitle(id)}</div>
      </div>
    </div>
  );
};

/**
 * Bar perjalanan di bawah layar: rute bertitik dengan pesawat yang maju per langkah.
 * `progress` = posisi langkah (0 = Login … 6 = Tips), boleh pecahan saat transisi.
 */
export const JourneyBar: React.FC<{ progress: number; opacity: number }> = ({ progress, opacity }) => {
  const x0 = 260;
  const x1 = 1660;
  const n = STEP_SCENES.length;
  const xAt = (i: number) => x0 + ((x1 - x0) * i) / (n - 1);
  const planeX = xAt(progress);
  return (
    <AbsoluteFill style={{ opacity, pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 110, background: "linear-gradient(0deg, rgba(3,8,16,0.85), transparent)" }} />
      <div style={{ position: "absolute", left: x0, width: x1 - x0, bottom: 58, height: 0, borderTop: "3px dashed rgba(143,166,199,0.45)" }} />
      <div style={{ position: "absolute", left: x0, width: planeX - x0, bottom: 56, height: 6, borderRadius: 6, background: "linear-gradient(90deg, #2563EB, #38BDF8, #A5F3FC)", boxShadow: "0 0 16px rgba(56,189,248,0.6)" }} />
      {STEP_SCENES.map((id, i) => {
        const done = progress >= i - 0.01;
        const current = Math.abs(progress - i) < 0.5;
        return (
          <div key={id} style={{ position: "absolute", left: xAt(i), bottom: 24, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: current ? 22 : 16,
                height: current ? 22 : 16,
                borderRadius: 99,
                background: done ? C.brand2 : "#1E2E48",
                border: `3px solid ${done ? "#E0F2FE" : "#3B5378"}`,
                boxShadow: current ? `0 0 0 8px rgba(56,189,248,0.2)` : undefined,
              }}
            />
            <div style={{ fontFamily, fontSize: 17, fontWeight: current ? 700 : 500, color: current ? C.text : C.muted, letterSpacing: 0.5, whiteSpace: "nowrap" }}>
              {sceneTitle(id)}
            </div>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: planeX - 26, bottom: 64 }}>
        <Plane size={52} color="#F8FAFC" style={{ filter: "drop-shadow(0 0 10px rgba(56,189,248,0.9))" }} />
      </div>
    </AbsoluteFill>
  );
};

/** Pesawat melintas cepat menutupi pergantian scene. Dirender dalam Sequence pendek. */
export const PlaneSwoosh: React.FC<{ variant: number }> = ({ variant }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [0, 26], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const up = variant % 2 === 0;
  const y0 = up ? 820 : 260;
  const y1 = up ? 300 : 760;
  const x = -300 + p * 2500;
  const y = y0 + (y1 - y0) * p;
  const angle = (Math.atan2(y1 - y0, 2500) * 180) / Math.PI;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: x - 900,
          top: y + 30,
          width: 900,
          height: 6,
          borderRadius: 6,
          background: "linear-gradient(90deg, transparent, rgba(165,243,252,0.65))",
          transform: `rotate(${angle}deg)`,
          transformOrigin: "right center",
          opacity: 1 - p * 0.6,
        }}
      />
      <div style={{ position: "absolute", left: x - 40, top: y, transform: `rotate(${angle}deg)` }}>
        <Plane size={80} color="#F8FAFC" style={{ filter: "drop-shadow(0 0 16px rgba(56,189,248,0.95))" }} />
      </div>
    </AbsoluteFill>
  );
};
