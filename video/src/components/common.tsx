import type { CSSProperties } from "react";
import { AbsoluteFill, random, useCurrentFrame } from "remotion";
import { C } from "../theme";

/** Pesawat tampak atas, menghadap ke kanan. */
export const Plane: React.FC<{ size?: number; color?: string; style?: CSSProperties }> = ({ size = 48, color = C.white, style }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" style={style}>
    <path
      fill={color}
      d="M62 32c0-2.2-2-3.4-4.6-3.4H41.5L27.6 6.4C27.1 5.5 26.2 5 25.2 5h-4.1l7.6 23.6H14.6L9.5 21.8C9.1 21.3 8.5 21 7.8 21H4.5l3.4 11-3.4 11h3.3c.7 0 1.3-.3 1.7-.8l5.1-6.8h14.1L21.1 59h4.1c1 0 1.9-.5 2.4-1.4l13.9-22.2h15.9C60 35.4 62 34.2 62 32z"
    />
  </svg>
);

/** Latar global: gradien navy, grid HUD bergerak, partikel bintang & garis rute. */
export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = (frame * 0.4) % 80;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1200px 700px at 75% 15%, #12305C 0%, transparent 60%), radial-gradient(900px 600px at 10% 90%, #0C3A4F 0%, transparent 60%), linear-gradient(180deg, ${C.navy2}, ${C.navy})` }}>
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(125,211,252,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(125,211,252,0.06) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
          backgroundPosition: `${drift}px ${drift}px`,
          maskImage: "radial-gradient(circle at 50% 45%, black 20%, transparent 75%)",
        }}
      />
      {new Array(40).fill(0).map((_, i) => {
        const x = random(`x${i}`) * 1920;
        const y = random(`y${i}`) * 1080;
        const tw = 0.25 + 0.5 * Math.abs(Math.sin(frame / (20 + random(`t${i}`) * 30) + i));
        return (
          <div
            key={i}
            style={{ position: "absolute", left: (x + frame * (0.15 + random(`s${i}`) * 0.3)) % 1920, top: y, width: 3, height: 3, borderRadius: 9, background: C.brand2, opacity: tw * 0.6 }}
          />
        );
      })}
      <svg width={1920} height={1080} style={{ position: "absolute", opacity: 0.35 }}>
        {[0, 1, 2].map((i) => (
          <path
            key={i}
            d={`M ${-100 + i * 200} ${980 - i * 120} Q ${900} ${180 + i * 90} ${2020} ${520 + i * 150}`}
            fill="none"
            stroke={C.brand2}
            strokeWidth={1.5}
            strokeDasharray="4 14"
            strokeDashoffset={-frame * (0.6 + i * 0.2)}
          />
        ))}
      </svg>
    </AbsoluteFill>
  );
};

const FLAP_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Papan "split-flap" ala papan keberangkatan bandara. */
export const SplitFlap: React.FC<{ text: string; start: number; size?: number; charDelay?: number; color?: string }> = ({
  text,
  start,
  size = 56,
  charDelay = 2,
  color = C.warningLite,
}) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: "flex", gap: size * 0.1 }}>
      {text.split("").map((ch, i) => {
        const settle = start + i * charDelay + 14;
        const appear = start + i * charDelay;
        if (ch === " ") return <div key={i} style={{ width: size * 0.45 }} />;
        const flipping = frame < settle;
        const shown = frame < appear ? "" : flipping ? FLAP_CHARS[Math.floor(random(`${text}${i}${Math.floor(frame / 2)}`) * FLAP_CHARS.length)] : ch;
        const flipPhase = flipping ? (frame % 2) / 2 : 0;
        return (
          <div
            key={i}
            style={{
              width: size * 0.78,
              height: size * 1.15,
              borderRadius: size * 0.12,
              background: "linear-gradient(180deg, #1B2638 0%, #141D2B 49%, #0A0F18 51%, #121A27 100%)",
              boxShadow: "0 6px 14px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.07)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace",
              fontWeight: 800,
              fontSize: size * 0.82,
              color,
              opacity: frame < appear ? 0.35 : 1,
              transform: `scaleY(${1 - flipPhase * 0.25})`,
            }}
          >
            {shown}
            <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 2, background: "rgba(0,0,0,0.65)" }} />
          </div>
        );
      })}
    </div>
  );
};
