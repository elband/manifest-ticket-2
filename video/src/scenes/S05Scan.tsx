import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Keyboard } from "lucide-react";
import { FULL, ScreenClip, type Highlight } from "../components/ScreenClip";
import { alignClip, mark } from "../clipTiming";
import { C, fontFamily } from "../theme";
import { at, FPS } from "../timing";

const ID = "05-scan" as const;
const mono = "'JetBrains Mono', ui-monospace, Consolas, monospace";
// Sama dengan PASS.manual di scripts/capture.mjs (data contoh).
const MANUAL_CODE = "ID6273|P3LM8Z|9902412346|12B|BUDI SANTOSO";

/** Kode yang sedang diketik petugas — input kiosk tersembunyi, jadi ditampilkan sebagai overlay. */
const TypedCode: React.FC<{ start: number; end: number }> = ({ start, end }) => {
  const frame = useCurrentFrame();
  if (frame < start - 6) return null;
  const n = Math.max(0, Math.min(MANUAL_CODE.length, Math.round(((frame - start) / (end - start)) * MANUAL_CODE.length)));
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 790, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "14px 26px",
          borderRadius: 16,
          background: "rgba(4,10,20,0.88)",
          border: `1.5px solid ${C.brand2}`,
          boxShadow: `0 0 40px -10px ${C.brand2}`,
          fontFamily: mono,
          fontSize: 30,
          color: C.text,
        }}
      >
        <Keyboard size={30} color={C.brand2} />
        <span style={{ fontFamily, fontSize: 20, color: C.muted, fontWeight: 600 }}>KETIK MANUAL</span>
        <span>{MANUAL_CODE.slice(0, n)}</span>
        {n < MANUAL_CODE.length && frame % 14 < 8 ? <span style={{ color: C.brand2 }}>▍</span> : <span style={{ color: C.successLite }}>⏎</span>}
      </div>
    </div>
  );
};

/**
 * Scan boarding pass — (A) kiosk siap menerima scanner USB, (B) petugas mengetik
 * kode manual lalu Enter (badge "Mode input" berubah ke Manual).
 */
export const S05Scan: React.FC = () => {
  const startB = at(ID, "ketik") - 6;
  const fromB = alignClip(mark("manual", "type"), at(ID, "ketik") - startB);
  const enter = startB + Math.round((mark("manual", "enter") - fromB) * FPS);
  const typeStart = startB + Math.round((mark("manual", "type") - fromB) * FPS);
  const hlA: Highlight[] = [
    { from: at(ID, "scanner") - 6, to: startB, x: 924, y: 88, w: 972, h: 290, label: "Scanner USB — langsung scan", color: "#67E8F9" },
  ];
  const hlB: Highlight[] = [
    { from: enter - startB - 2, to: enter - startB + 60, x: 1497, y: 16, w: 168, h: 50, label: "Mode input", color: "#67E8F9", radius: 14 },
  ];
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={startB} layout="none">
        <ScreenClip clip="face" clipFrom={4} focus={[{ at: 0, ...FULL }, { at: at(ID, "scanner") + 10, x: 600, y: 0, w: 1320 }]} highlights={hlA} />
      </Sequence>
      <Sequence from={startB} layout="none">
        <ScreenClip clip="manual" clipFrom={fromB} focus={[{ at: 0, x: 600, y: 0, w: 1320 }, { at: enter - startB + 70, x: 600, y: 0, w: 1320 }, { at: enter - startB + 90, ...FULL }]} highlights={hlB} />
      </Sequence>
      <TypedCode start={typeStart} end={enter} />
      <Sequence from={enter} durationInFrames={10} layout="none">
        <Audio src={staticFile("audio/sfx-beep.wav")} volume={0.45} />
      </Sequence>
    </AbsoluteFill>
  );
};
