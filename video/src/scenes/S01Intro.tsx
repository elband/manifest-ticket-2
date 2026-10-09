import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { MapPin } from "lucide-react";
import { fadeUp, popIn, tween, useEnter } from "../components/anim";
import { Plane, SplitFlap } from "../components/common";
import { C, fontFamily, gradText } from "../theme";
import { at } from "../timing";

const ID = "01-intro" as const;
const OFFICERS = ["Andi", "Budi", "Citra", "Dewi", "Eko"];

/** Lampu landasan yang mengalir ke arah penonton (perspektif). */
const Runway: React.FC = () => {
  const frame = useCurrentFrame();
  const rows = 14;
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
      {new Array(rows).fill(0).map((_, i) => {
        const z = ((i + (frame * 0.06) % 1) / rows) ** 2.2;
        const y = 620 + z * 460;
        const spread = 60 + z * 1100;
        const r = 2 + z * 9;
        return (
          <g key={i} opacity={0.25 + z * 0.75}>
            <circle cx={960 - spread} cy={y} r={r} fill="#FCD34D" />
            <circle cx={960 + spread} cy={y} r={r} fill="#FCD34D" />
            <rect x={960 - r * 0.5} y={y - r * 2} width={r} height={r * 4} fill="rgba(255,255,255,0.5)" />
          </g>
        );
      })}
    </svg>
  );
};

export const S01Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const fly = tween(frame, [6, 70], [0, 1]);
  const logo = useEnter(22, { damping: 11 });
  const title = useEnter(36);
  const sub = useEnter(58);
  const airport = useEnter(at(ID, "Bandara") - 6);
  const crew = (i: number) => tween(frame, [at(ID, "Ini") + i * 5, at(ID, "Ini") + i * 5 + 18], [0, 1]);
  const exit = tween(frame, [at(ID, "SIPANDAI") + 6, at(ID, "SIPANDAI") + 40], [1, 1.06]);

  return (
    <AbsoluteFill style={{ fontFamily, transform: `scale(${exit})` }}>
      <Runway />
      <div style={{ position: "absolute", left: -200 + fly * 2400, top: 760 - fly * 640, transform: "rotate(-15deg)", opacity: fly < 1 ? 1 : 0 }}>
        <div style={{ position: "absolute", right: 60, top: 38, width: 1000, height: 5, borderRadius: 4, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.7))" }} />
        <Plane size={110} color="#F8FAFC" style={{ filter: "drop-shadow(0 0 20px rgba(56,189,248,0.9))" }} />
      </div>

      <AbsoluteFill style={{ alignItems: "center", paddingTop: 120 }}>
        <div style={{ ...popIn(logo), filter: "drop-shadow(0 0 40px rgba(56,189,248,0.6))" }}>
          <Img src={staticFile("brand/icon.svg")} style={{ width: 150, height: 150 }} />
        </div>
        <div style={{ ...fadeUp(title, 60), fontSize: 168, fontWeight: 800, letterSpacing: 10, lineHeight: 1.05, marginTop: 14, ...gradText }}>SIPANDAI</div>
        <div style={{ ...fadeUp(sub), color: C.text, fontSize: 38, fontWeight: 500, letterSpacing: 2 }}>Sistem Validasi Boarding Pass</div>
        <div style={{ marginTop: 34 }}>
          <SplitFlap text="PANDUAN PETUGAS AVSEC" start={at(ID, "petugas") - 4} size={54} charDelay={1} />
        </div>
        <div style={{ ...fadeUp(airport), marginTop: 30, display: "flex", alignItems: "center", gap: 12, color: C.muted, fontSize: 30, fontWeight: 500 }}>
          <MapPin size={30} color={C.brand2} /> Bandar Udara Aji Pangeran Tumenggung Pranoto · Samarinda
        </div>
      </AbsoluteFill>

      <div style={{ position: "absolute", bottom: 250, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 26 }}>
        {OFFICERS.map((name, i) => (
          <div key={name} style={{ ...fadeUp(crew(i), 60), display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div style={{ width: 92, height: 92, borderRadius: 99, overflow: "hidden", border: `3px solid ${C.brand2}`, background: "white", boxShadow: "0 0 24px rgba(56,189,248,0.45)" }}>
              <Img src={staticFile(`brand/petugas${i + 1}.png`)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <div style={{ color: C.muted, fontSize: 18, fontWeight: 600 }}>{name}</div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
